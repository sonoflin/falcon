import {
  DEPARTURE_CLIMB_TARGET_MSL,
  FFZ,
  HELI_CANAL,
  HELI_TYPE_CODES,
  HELI_WEST_LON,
  PATTERN_ALT_MSL,
  PREFERRED_DEPARTURE_HEADING_MAX,
  PREFERRED_DEPARTURE_HEADING_MIN,
  RADII_NM,
  TURBINE_TYPE_CODES,
} from "./constants";
import {
  alongRunwaySm,
  bearingDeg,
  distFromFfzNm,
  headingDiff,
  heliRouteSoftMiss,
  isInMesaCityLimits,
  isLikelyDownwindAbeam,
  isLikelyFinalOrBase,
  isNorthOfField,
  isWestOfHeliCanalAdjacent,
  lateralOffsetFromRunwaySm,
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

function categoryFromTypeDesignator(
  type: string | null | undefined
): AnalyzedFlight["category"] | null {
  if (!type) return null;
  const t = type.trim().toUpperCase();
  if (!t) return null;
  if (HELI_TYPE_CODES.has(t) || /^[RH]\d|^EC|^AS5|^UH|^B0[46]/.test(t)) {
    return "helicopter";
  }
  if (TURBINE_TYPE_CODES.has(t) || /^(C25|C56|LJ|CL3|FA5|E5)/.test(t)) {
    return "turbine";
  }
  // Common piston trainers / singles
  if (
    /^(P28|C172|C152|C182|C206|DA40|DA42|SR2|BE36|BE35|M20|PA2|PA3|RV)/.test(t)
  ) {
    return "piston";
  }
  return null;
}

function inferCategory(
  callsign: string | null,
  track: TrackPoint[],
  aircraftType?: string | null
): AnalyzedFlight["category"] {
  const fromType = categoryFromTypeDesignator(aircraftType);
  if (fromType) return fromType;

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
    // Require a real dip (not flat cruise) so quiet-hour transit ≠ circuit count
    if (b <= a - 80 && b <= c - 80 && b < DEPARTURE_CLIMB_TARGET_MSL + 200) {
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

export type AnalyzeOptions = {
  aircraftType?: string | null;
};

export function analyzeFlight(
  flight: OpenSkyFlight,
  track: TrackPoint[],
  options?: AnalyzeOptions
): AnalyzedFlight {
  const aircraftType = options?.aircraftType ?? null;
  const category = inferCategory(flight.callsign, track, aircraftType);
  const patternAlt = expectedPatternAlt(category);
  const findings: Finding[] = [];
  const callsign = flight.callsign;
  const registration = registrationFromCallsign(callsign);

  const inMesaOrNorth = track.some(
    (p) => isInMesaCityLimits(p.lat, p.lon) || isNorthOfField(p.lat)
  );

  // Index track for previous-altitude lookups
  const prevAltByTime = new Map<number, number | null>();
  for (let i = 1; i < track.length; i++) {
    prevAltByTime.set(track[i].time, track[i - 1].altFt);
  }

  // --- BELOW_PATTERN_ALT: downwind/abeam only (exclude final/base) ---
  const lowPatternPoints = track.filter((p) => {
    if (p.onGround || p.altFt == null) return false;
    const d = distFromFfzNm(p.lat, p.lon);
    if (d > RADII_NM.pattern || d < 0.2) return false;
    if (p.altFt >= patternAlt - 150 || p.altFt <= FFZ.elevFt + 200) return false;
    if (
      isLikelyFinalOrBase(
        p.lat,
        p.lon,
        p.trackDeg,
        p.altFt,
        prevAltByTime.get(p.time) ?? null
      )
    ) {
      return false;
    }
    // Prefer downwind/abeam geometry; still allow other off-final low pattern points
    if (!isLikelyDownwindAbeam(p.lat, p.lon) && d < RADII_NM.finalApproachNm) {
      return false;
    }
    return true;
  });
  if (lowPatternPoints.length >= 2) {
    const worst = lowPatternPoints.reduce((a, b) =>
      (a.altFt ?? 99999) < (b.altFt ?? 99999) ? a : b
    );
    findings.push({
      code: "BELOW_PATTERN_ALT",
      severity:
        worst.altFt != null && worst.altFt < patternAlt - 400 ? "high" : "medium",
      summary: `Below expected pattern altitude on downwind/abeam (${patternAlt.toLocaleString()} ft MSL)`,
      evidence: [
        `Lowest observed ${worst.altFt?.toLocaleString()} ft MSL at ${formatPhoenix(worst.time)} MST`,
        `Distance from KFFZ ≈ ${distFromFfzNm(worst.lat, worst.lon).toFixed(2)} NM · lateral offset ${lateralOffsetFromRunwaySm(worst.lat, worst.lon).toFixed(2)} SM`,
        `${lowPatternPoints.length} track points below ${patternAlt - 150} ft MSL (final/base excluded)`,
      ],
      lat: worst.lat,
      lon: worst.lon,
      time: worst.time,
      altFt: worst.altFt,
    });
  }

  // --- SLOW_DEPARTURE_CLIMB ---
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
            `Climb target used for screening: ${DEPARTURE_CLIMB_TARGET_MSL.toLocaleString()} ft MSL (Vy / best-rate not measurable from ADS-B)`,
          ],
          lat: atClimbCheck.lat,
          lon: atClimbCheck.lon,
          time: atClimbCheck.time,
          altFt: atClimbCheck.altFt,
        });
      }
    }
  }

  // --- WIDE_PATTERN: lateral offset from runway centerline ---
  const patternPts = track.filter((p) => {
    if (p.onGround || p.altFt == null) return false;
    if (!isLikelyDownwindAbeam(p.lat, p.lon)) return false;
    return (
      p.altFt < patternAlt + 500 &&
      p.altFt > FFZ.elevFt + 300
    );
  });
  const wide = patternPts.filter(
    (p) => lateralOffsetFromRunwaySm(p.lat, p.lon) > RADII_NM.widePatternSm
  );
  if (wide.length >= 4) {
    const farthest = wide.reduce((a, b) =>
      lateralOffsetFromRunwaySm(a.lat, a.lon) >
      lateralOffsetFromRunwaySm(b.lat, b.lon)
        ? a
        : b
    );
    const offset = lateralOffsetFromRunwaySm(farthest.lat, farthest.lon);
    const fromEnd = Math.min(
      smBetween(
        farthest.lat,
        farthest.lon,
        FFZ.rwy4Threshold.lat,
        FFZ.rwy4Threshold.lon
      ),
      smBetween(
        farthest.lat,
        farthest.lon,
        FFZ.rwy22Threshold.lat,
        FFZ.rwy22Threshold.lon
      )
    );
    findings.push({
      code: "WIDE_PATTERN",
      severity: "low",
      summary: `Pattern flown wider than ~${RADII_NM.widePatternSm} SM from runway centerline`,
      evidence: [
        `Largest lateral offset ${offset.toFixed(2)} SM from 4/22 centerline`,
        `≈ ${fromEnd.toFixed(2)} SM from nearest runway end (Chart Supp ~¾ mi intent)`,
        `Altitude ${farthest.altFt?.toLocaleString()} ft MSL at ${formatPhoenix(farthest.time)} MST`,
        `Expected downwind roughly 0.75–1.0 SM`,
      ],
      lat: farthest.lat,
      lon: farthest.lon,
      time: farthest.time,
      altFt: farthest.altFt,
    });
  }

  // --- Quiet hours: NIGHT_REPETITIVE vs QUIET_HOUR_ACTIVITY ---
  const circuits = countQuietHourCircuits(track);
  if (circuits.count >= 2) {
    findings.push({
      code: "NIGHT_REPETITIVE",
      severity: circuits.count >= 4 ? "high" : "medium",
      summary: `Repetitive circuit/approach cycles in quiet hours (${circuits.count}) — T&G/training discouraged 22:00–05:30`,
      evidence: [
        `Detected ≈ ${circuits.count} quiet-hour circuit/approach cycles near KFFZ`,
        `Quiet window 22:00–05:30 Arizona (0500–1230Z Chart Supp)`,
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
        code: "QUIET_HOUR_ACTIVITY",
        severity: "low",
        summary:
          "Quiet-hour presence near field (not clearly repetitive) — T&G/training N/A 22:00–05:30",
        evidence: [
          `${quietNear.length} track points within 3 NM during quiet hours`,
          `Lowest ${worst.altFt?.toLocaleString()} ft MSL at ${formatPhoenix(worst.time)} MST`,
          `Distance ${distFromFfzNm(worst.lat, worst.lon).toFixed(2)} NM from KFFZ`,
          `Screening cue only — single transit/approach is not “repetitive ops”`,
        ],
        lat: worst.lat,
        lon: worst.lon,
        time: worst.time,
        altFt: worst.altFt,
      });
    }
  }

  // --- LOW_OVER_MESA ---
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
        "Low altitude inside the city-limits boundary, outside the preferred departure corridor",
      evidence: [
        `${worst.altFt?.toLocaleString()} ft MSL at ${formatPhoenix(worst.time)} MST`,
        `Inside the city-limits boundary, ${distFromFfzNm(worst.lat, worst.lon).toFixed(2)} NM from KFFZ`,
        `Bearing from field ${bearingDeg(FFZ.lat, FFZ.lon, worst.lat, worst.lon).toFixed(0)}°`,
      ],
      lat: worst.lat,
      lon: worst.lon,
      time: worst.time,
      altFt: worst.altFt,
    });
  }

  // --- NON_PREFERRED_DEPARTURE (calm-wind preference assumed; wind/ATC may justify) ---
  if (category !== "helicopter") {
    let liftoffIdx = -1;
    for (let i = 1; i < track.length; i++) {
      const prev = track[i - 1];
      const p = track[i];
      if (
        prev.onGround &&
        !p.onGround &&
        distFromFfzNm(p.lat, p.lon) < 1.2
      ) {
        liftoffIdx = i;
        break;
      }
    }
    if (liftoffIdx < 0) {
      // Fallback: first airborne near field climbing
      for (let i = 0; i < track.length; i++) {
        const p = track[i];
        if (
          !p.onGround &&
          p.altFt != null &&
          p.altFt > FFZ.elevFt + 80 &&
          p.altFt < FFZ.elevFt + 600 &&
          distFromFfzNm(p.lat, p.lon) < 0.8
        ) {
          liftoffIdx = i;
          break;
        }
      }
    }

    if (liftoffIdx >= 0) {
      const depSlice = track
        .slice(liftoffIdx, liftoffIdx + 40)
        .filter((p) => !p.onGround && distFromFfzNm(p.lat, p.lon) < 2.5);
      const sample = depSlice.find(
        (p) =>
          distFromFfzNm(p.lat, p.lon) >= 0.4 &&
          distFromFfzNm(p.lat, p.lon) <= 1.6
      );
      if (sample) {
        const brg = bearingDeg(FFZ.lat, FFZ.lon, sample.lat, sample.lon);
        const heading =
          sample.trackDeg ??
          (depSlice.length > 1
            ? bearingDeg(
                depSlice[0].lat,
                depSlice[0].lon,
                sample.lat,
                sample.lon
              )
            : brg);
        const onPreferred =
          brg >= PREFERRED_DEPARTURE_HEADING_MIN &&
          brg <= PREFERRED_DEPARTURE_HEADING_MAX;
        // SW / runway 22 family: heading ~200–250 or along-track negative
        const towardSw =
          headingDiff(heading, 220) < 45 || alongRunwaySm(sample.lat, sample.lon) < -0.2;
        const earlyTurnout =
          !onPreferred &&
          isInMesaCityLimits(sample.lat, sample.lon) &&
          distFromFfzNm(sample.lat, sample.lon) < 1.2 &&
          sample.altFt != null &&
          sample.altFt < patternAlt;

        if ((towardSw && !onPreferred) || earlyTurnout) {
          findings.push({
            code: "NON_PREFERRED_DEPARTURE",
            severity: "low",
            summary:
              "Non-preferred SW / early residential-side departure (calm-wind preference assumed)",
            evidence: [
              `Sample bearing ${brg.toFixed(0)}° / track ~${heading.toFixed(0)}° at ${distFromFfzNm(sample.lat, sample.lon).toFixed(2)} NM`,
              `${sample.altFt?.toLocaleString() ?? "—"} ft MSL at ${formatPhoenix(sample.time)} MST`,
              `Calm-wind preference is 4L/4R (NE). Wind, ATC, or runway in use may fully justify SW (22) or early turnout — not detectable from ADS-B.`,
            ],
            lat: sample.lat,
            lon: sample.lon,
            time: sample.time,
            altFt: sample.altFt,
          });
        }
      }
    }
  }

  // --- Helicopter-specific ---
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
        isWestOfHeliCanalAdjacent(p.lat, p.lon) &&
        distFromFfzNm(p.lat, p.lon) < 3
    );
    if (west.length >= 3) {
      const sample = west[Math.floor(west.length / 2)];
      findings.push({
        code: "HELI_WEST_OF_FIELD",
        severity: "low",
        summary:
          "Helicopter west of Roosevelt Irrigation Canal adjacent to runway latitudes",
        evidence: [
          `Sample ${formatPhoenix(sample.time)} MST — ${sample.altFt?.toLocaleString()} ft MSL`,
          `Lon ${sample.lon.toFixed(4)} west of canal ≈ ${HELI_WEST_LON} · lat ${sample.lat.toFixed(4)} (band ${HELI_CANAL.latMin}–${HELI_CANAL.latMax})`,
          `Guidance: remain east of canal west of runways (heli PDF 49031)`,
        ],
        lat: sample.lat,
        lon: sample.lon,
        time: sample.time,
        altFt: sample.altFt,
      });
    }

    // Soft route conformance — only when maneuvering near field but not on a corridor
    const nearFieldAir = track.filter(
      (p) =>
        !p.onGround &&
        p.altFt != null &&
        p.altFt < 2800 &&
        distFromFfzNm(p.lat, p.lon) >= 0.6 &&
        distFromFfzNm(p.lat, p.lon) <= 3.5
    );
    const softMisses = nearFieldAir.filter((p) => {
      const m = heliRouteSoftMiss(p.lat, p.lon);
      return m.miss;
    });
    if (nearFieldAir.length >= 6 && softMisses.length >= Math.ceil(nearFieldAir.length * 0.7)) {
      const sample = softMisses[Math.floor(softMisses.length / 2)];
      const miss = heliRouteSoftMiss(sample.lat, sample.lon);
      findings.push({
        code: "HELI_ROUTE_SOFT",
        severity: "low",
        summary:
          "Helicopter path soft-miss vs approximate Snake/Cactus/Gecko/Yankee corridors",
        evidence: [
          `Nearest approx corridor: ${miss.nearest} (~${miss.distNm.toFixed(2)} NM away)`,
          `Sample ${formatPhoenix(sample.time)} MST — ${sample.altFt?.toLocaleString()} ft MSL`,
          `ATC may vector off published routes — soft screening cue only`,
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
    aircraftType,
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
