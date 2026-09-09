import {
  DEPARTURE_CLIMB_TARGET_MSL,
  FFZ,
  HELI_WEST_LON,
  PATTERN_ALT_MSL,
  PREFERRED_DEPARTURE_HEADING_MAX,
  PREFERRED_DEPARTURE_HEADING_MIN,
  RADII_NM,
} from "./constants";
import {
  bearingDeg,
  distFromFfzNm,
  isInMesaCityLimits,
  isNorthOfField,
  isWestOfHeliCanal,
  smBetween,
} from "./geography";
import { formatPhoenix, isInQuietHours } from "./time";
import type {
  AnalyzedFlight,
  Finding,
  OpenSkyFlight,
  Severity,
  TrackPoint,
} from "./types";

function severityRank(s: Severity): number {
  return s === "high" ? 3 : s === "medium" ? 2 : 1;
}

function maxSeverity(findings: Finding[]): Severity | null {
  if (!findings.length) return null;
  return findings.reduce<Severity>((acc, f) => {
    return severityRank(f.severity) > severityRank(acc) ? f.severity : acc;
  }, "low");
}

function inferCategory(
  callsign: string | null,
  track: TrackPoint[]
): AnalyzedFlight["category"] {
  let maxGs = 0;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    const dt = b.time - a.time;
    if (dt <= 0 || dt > 90) continue;
    const dNm = smBetween(a.lat, a.lon, b.lat, b.lon) / 1.15078;
    const gs = (dNm / dt) * 3600;
    if (gs > maxGs) maxGs = gs;
  }
  const airborne = track.filter((p) => !p.onGround && p.altFt != null);
  if (!airborne.length) return "unknown";
  const alts = airborne.map((p) => p.altFt!).sort((a, b) => a - b);
  const median = alts[Math.floor(alts.length / 2)];
  const c = (callsign || "").toUpperCase();
  if (c.includes("HEL")) return "helicopter";
  if (maxGs > 0 && maxGs < 110 && median < 2200) return "helicopter";
  if (maxGs > 200 || median > 3500) return "turbine";
  return "piston";
}

function expectedPatternAlt(cat: AnalyzedFlight["category"]): number {
  if (cat === "helicopter") return PATTERN_ALT_MSL.helicopter;
  if (cat === "turbine") return PATTERN_ALT_MSL.turbine;
  return PATTERN_ALT_MSL.piston;
}

function registrationFromCallsign(callsign: string | null): string | null {
  if (!callsign) return null;
  const c = callsign.trim().toUpperCase();
  if (/^N[A-Z0-9]+$/.test(c)) return c;
  return null;
}

function countQuietHourCircuits(track: TrackPoint[]): {
  count: number;
  samples: TrackPoint[];
} {
  const near = track.filter(
    (p) =>
      !p.onGround &&
      p.altFt != null &&
      p.altFt < 3500 &&
      distFromFfzNm(p.lat, p.lon) <= RADII_NM.pattern &&
      isInQuietHours(p.time)
  );

  const samples: TrackPoint[] = [];
  let lastValleyTime = 0;
  for (let i = 2; i < near.length - 2; i++) {
    const a = near[i - 2].altFt!;
    const b = near[i].altFt!;
    const c = near[i + 2].altFt!;
    if (b <= a && b <= c && b < DEPARTURE_CLIMB_TARGET_MSL + 200) {
      if (near[i].time - lastValleyTime > 90) {
        samples.push(near[i]);
        lastValleyTime = near[i].time;
      }
    }
  }

  let approaches = 0;
  let wasClose = false;
  let lastApproach = 0;
  for (const p of track) {
    const d = distFromFfzNm(p.lat, p.lon);
    const close = d < 0.5 && !p.onGround;
    if (
      close &&
      !wasClose &&
      isInQuietHours(p.time) &&
      p.time - lastApproach > 120
    ) {
      approaches++;
      lastApproach = p.time;
    }
    wasClose = close;
  }

  return { count: Math.max(samples.length, approaches), samples };
}

export function analyzeFlight(
  flight: OpenSkyFlight,
  track: TrackPoint[]
): AnalyzedFlight {
  const category = inferCategory(flight.callsign, track);
  const patternAlt = expectedPatternAlt(category);
  const findings: Finding[] = [];
  const callsign = flight.callsign;
  const registration = registrationFromCallsign(callsign);

  const inMesaOrNorth = track.some(
    (p) => isInMesaCityLimits(p.lat, p.lon) || isNorthOfField(p.lat)
  );

  const lowPatternPoints = track.filter((p) => {
    if (p.onGround || p.altFt == null) return false;
    const d = distFromFfzNm(p.lat, p.lon);
    if (d > RADII_NM.pattern || d < 0.15) return false;
    return p.altFt < patternAlt - 150 && p.altFt > FFZ.elevFt + 200;
  });
  if (lowPatternPoints.length >= 2) {
    const worst = lowPatternPoints.reduce((a, b) =>
      (a.altFt ?? 99999) < (b.altFt ?? 99999) ? a : b
    );
    findings.push({
      code: "BELOW_PATTERN_ALT",
      severity:
        worst.altFt != null && worst.altFt < patternAlt - 400 ? "high" : "medium",
      summary: `Below expected pattern altitude near field (${patternAlt.toLocaleString()} ft MSL)`,
      evidence: [
        `Lowest observed ${worst.altFt?.toLocaleString()} ft MSL at ${formatPhoenix(worst.time)} MST`,
        `Distance from KFFZ ≈ ${distFromFfzNm(worst.lat, worst.lon).toFixed(2)} NM`,
        `${lowPatternPoints.length} track points below ${patternAlt - 150} ft MSL within ${RADII_NM.pattern} NM`,
      ],
      lat: worst.lat,
      lon: worst.lon,
      time: worst.time,
      altFt: worst.altFt,
    });
  }

  if (track.filter((p) => !p.onGround).length >= 3) {
    let depIdx = -1;
    for (let i = 0; i < track.length; i++) {
      const p = track[i];
      if (
        !p.onGround &&
        p.altFt != null &&
        p.altFt > FFZ.elevFt + 100 &&
        distFromFfzNm(p.lat, p.lon) < 1.0
      ) {
        depIdx = i;
        break;
      }
    }
    if (depIdx >= 0 && category !== "helicopter") {
      const after = track
        .slice(depIdx)
        .filter((p) => !p.onGround && p.altFt != null);
      const atClimbCheck = after.find(
        (p) => distFromFfzNm(p.lat, p.lon) >= RADII_NM.climbCheckNm
      );
      if (
        atClimbCheck &&
        atClimbCheck.altFt != null &&
        atClimbCheck.altFt < DEPARTURE_CLIMB_TARGET_MSL - 100
      ) {
        findings.push({
          code: "SLOW_DEPARTURE_CLIMB",
          severity:
            atClimbCheck.altFt < DEPARTURE_CLIMB_TARGET_MSL - 500
              ? "high"
              : "medium",
          summary: `Departure still below ${DEPARTURE_CLIMB_TARGET_MSL.toLocaleString()} ft MSL beyond ${RADII_NM.climbCheckNm} NM`,
          evidence: [
            `Altitude ${atClimbCheck.altFt.toLocaleString()} ft MSL at ${distFromFfzNm(atClimbCheck.lat, atClimbCheck.lon).toFixed(2)} NM from KFFZ`,
            `Time ${formatPhoenix(atClimbCheck.time)} MST`,
            `Climb target used for screening: ${DEPARTURE_CLIMB_TARGET_MSL.toLocaleString()} ft MSL`,
          ],
          lat: atClimbCheck.lat,
          lon: atClimbCheck.lon,
          time: atClimbCheck.time,
          altFt: atClimbCheck.altFt,
        });
      }
    }
  }

  const patternPts = track.filter((p) => {
    if (p.onGround || p.altFt == null) return false;
    const d = distFromFfzNm(p.lat, p.lon);
    return (
      d >= 0.4 &&
      d <= 3 &&
      p.altFt < patternAlt + 500 &&
      p.altFt > FFZ.elevFt + 300
    );
  });
  const wide = patternPts.filter(
    (p) => smBetween(p.lat, p.lon, FFZ.lat, FFZ.lon) > RADII_NM.widePatternSm
  );
  if (wide.length >= 4) {
    const farthest = wide.reduce((a, b) =>
      smBetween(a.lat, a.lon, FFZ.lat, FFZ.lon) >
      smBetween(b.lat, b.lon, FFZ.lat, FFZ.lon)
        ? a
        : b
    );
    findings.push({
      code: "WIDE_PATTERN",
      severity: "low",
      summary: `Pattern flown wider than ~${RADII_NM.widePatternSm} SM from field`,
      evidence: [
        `Farthest pattern point ${smBetween(farthest.lat, farthest.lon, FFZ.lat, FFZ.lon).toFixed(2)} SM from KFFZ`,
        `Altitude ${farthest.altFt?.toLocaleString()} ft MSL at ${formatPhoenix(farthest.time)} MST`,
        `Expected downwind roughly 0.75–1.0 SM`,
      ],
      lat: farthest.lat,
      lon: farthest.lon,
      time: farthest.time,
      altFt: farthest.altFt,
    });
  }

  const circuits = countQuietHourCircuits(track);
  if (circuits.count >= 2) {
    findings.push({
      code: "NIGHT_REPETITIVE",
      severity: circuits.count >= 4 ? "high" : "medium",
      summary: `Repetitive low operations during 10:00 p.m.–5:30 a.m. (${circuits.count} circuits/approaches)`,
      evidence: [
        `Detected ≈ ${circuits.count} quiet-hour circuit/approach cycles near KFFZ`,
        ...circuits.samples.slice(0, 3).map(
          (p) =>
            `${formatPhoenix(p.time)} MST — ${p.altFt?.toLocaleString()} ft MSL @ ${distFromFfzNm(p.lat, p.lon).toFixed(2)} NM`
        ),
      ],
      lat: circuits.samples[0]?.lat,
      lon: circuits.samples[0]?.lon,
      time: circuits.samples[0]?.time,
      altFt: circuits.samples[0]?.altFt,
    });
  } else {
    // Surface quiet-hour presence near the field for overnight review (not necessarily repetitive)
    const quietNear = track.filter(
      (p) =>
        !p.onGround &&
        isInQuietHours(p.time) &&
        distFromFfzNm(p.lat, p.lon) <= 3 &&
        p.altFt != null &&
        p.altFt < 4000
    );
    if (quietNear.length >= 8) {
      const worst = quietNear.reduce((a, b) =>
        (a.altFt ?? 99999) < (b.altFt ?? 99999) ? a : b
      );
      findings.push({
        code: "NIGHT_REPETITIVE",
        severity: "low",
        summary: "Quiet-hour activity near the field (10:00 p.m.–5:30 a.m.)",
        evidence: [
          `${quietNear.length} track points within 3 NM during quiet hours`,
          `Lowest ${worst.altFt?.toLocaleString()} ft MSL at ${formatPhoenix(worst.time)} MST`,
          `Distance ${distFromFfzNm(worst.lat, worst.lon).toFixed(2)} NM from KFFZ`,
        ],
        lat: worst.lat,
        lon: worst.lon,
        time: worst.time,
        altFt: worst.altFt,
      });
    }
  }

  const mesaLow = track.filter((p) => {
    if (p.onGround || p.altFt == null) return false;
    if (!isInMesaCityLimits(p.lat, p.lon)) return false;
    if (p.altFt >= patternAlt - 100) return false;
    if (p.altFt <= FFZ.elevFt + 150) return false;
    const d = distFromFfzNm(p.lat, p.lon);
    if (d < 0.3 || d > RADII_NM.mesaFocusNm) return false;
    const brg = bearingDeg(FFZ.lat, FFZ.lon, p.lat, p.lon);
    const onPreferred =
      brg >= PREFERRED_DEPARTURE_HEADING_MIN &&
      brg <= PREFERRED_DEPARTURE_HEADING_MAX;
    if (onPreferred && isNorthOfField(p.lat)) return false;
    return true;
  });
  if (mesaLow.length >= 2) {
    const worst = mesaLow.reduce((a, b) =>
      (a.altFt ?? 99999) < (b.altFt ?? 99999) ? a : b
    );
    findings.push({
      code: "LOW_OVER_MESA",
      severity:
        worst.altFt != null && worst.altFt < patternAlt - 500 ? "high" : "medium",
      summary:
        "Low altitude over Mesa city limits outside preferred departure corridor",
      evidence: [
        `${worst.altFt?.toLocaleString()} ft MSL at ${formatPhoenix(worst.time)} MST`,
        `Inside City of Mesa boundary, ${distFromFfzNm(worst.lat, worst.lon).toFixed(2)} NM from KFFZ`,
        `Bearing from field ${bearingDeg(FFZ.lat, FFZ.lon, worst.lat, worst.lon).toFixed(0)}°`,
      ],
      lat: worst.lat,
      lon: worst.lon,
      time: worst.time,
      altFt: worst.altFt,
    });
  }

  if (category === "helicopter") {
    const heliLow = track.filter((p) => {
      if (p.onGround || p.altFt == null) return false;
      return (
        distFromFfzNm(p.lat, p.lon) <= RADII_NM.heliNearFieldNm &&
        p.altFt < PATTERN_ALT_MSL.helicopter - 100 &&
        p.altFt > FFZ.elevFt + 100
      );
    });
    if (heliLow.length >= 3) {
      const worst = heliLow.reduce((a, b) =>
        (a.altFt ?? 99999) < (b.altFt ?? 99999) ? a : b
      );
      findings.push({
        code: "HELI_LOW_NEAR_FIELD",
        severity: "medium",
        summary: `Helicopter below ${PATTERN_ALT_MSL.helicopter.toLocaleString()} ft MSL within ${RADII_NM.heliNearFieldNm} NM`,
        evidence: [
          `Lowest ${worst.altFt?.toLocaleString()} ft MSL at ${formatPhoenix(worst.time)} MST`,
          `Distance ${distFromFfzNm(worst.lat, worst.lon).toFixed(2)} NM from KFFZ`,
        ],
        lat: worst.lat,
        lon: worst.lon,
        time: worst.time,
        altFt: worst.altFt,
      });
    }

    const west = track.filter(
      (p) =>
        !p.onGround &&
        p.altFt != null &&
        p.altFt < 2500 &&
        isWestOfHeliCanal(p.lon) &&
        distFromFfzNm(p.lat, p.lon) < 3
    );
    if (west.length >= 3) {
      const sample = west[Math.floor(west.length / 2)];
      findings.push({
        code: "HELI_WEST_OF_FIELD",
        severity: "low",
        summary: "Helicopter track west of field (west-side corridor)",
        evidence: [
          `Sample ${formatPhoenix(sample.time)} MST — ${sample.altFt?.toLocaleString()} ft MSL`,
          `Longitude ${sample.lon.toFixed(4)} (west of ${HELI_WEST_LON})`,
        ],
        lat: sample.lat,
        lon: sample.lon,
        time: sample.time,
        altFt: sample.altFt,
      });
    }
  }

  return {
    id: `${flight.icao24}-${flight.firstSeen}`,
    icao24: flight.icao24,
    callsign,
    registration,
    aircraftType: null,
    category,
    firstSeen: flight.firstSeen,
    lastSeen: flight.lastSeen,
    estDepartureAirport: flight.estDepartureAirport,
    estArrivalAirport: flight.estArrivalAirport,
    track,
    findings,
    maxSeverity: maxSeverity(findings),
    inMesaOrNorth,
    source: "OpenSky Network",
    verifyUrl: `https://opensky-network.org/aircraft/${flight.icao24}`,
  };
}
