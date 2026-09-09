import { analyzeFlight } from "./analysis";
import {
  discoverFlightsViaAdsbLol,
  fetchDayTrace,
  filterTrackToWindow,
} from "./adsblol";
import { FFZ, OPENSKY } from "./constants";
import { fetchAirportFlights, fetchTrack } from "./opensky";
import type { AnalyzedFlight, ReportResponse, TrackPoint } from "./types";

const MAX_TRACKS_ANON = 18;
const MAX_TRACKS_AUTH = 40;
const TRACK_CONCURRENCY_ANON = 2;
const TRACK_CONCURRENCY_AUTH = 3;

async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length || 1) }, () =>
      worker()
    )
  );
  return results;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadTrackPreferred(
  icao24: string,
  begin: number,
  end: number,
  openskyHintTime: number
): Promise<{ track: TrackPoint[]; source: string; registration: string | null; type: string | null }> {
  // Prefer ADS-B.lol day traces (higher sample rate, altitudes already in feet)
  try {
    const day = await fetchDayTrace(icao24);
    const filtered = filterTrackToWindow(day.track, begin - 300, end + 300);
    if (filtered.length >= 3) {
      return {
        track: filtered,
        source: "ADS-B.lol day trace",
        registration: day.registration,
        type: day.aircraftType,
      };
    }
  } catch {
    // fall through
  }

  try {
    let track = await fetchTrack(icao24, openskyHintTime);
    if (!track.length) {
      track = await fetchTrack(icao24, begin + 60);
    }
    track = filterTrackToWindow(track, begin - 600, end + 600);
    return {
      track,
      source: "OpenSky Network track",
      registration: null,
      type: null,
    };
  } catch {
    return { track: [], source: "none", registration: null, type: null };
  }
}

export async function buildReport(
  begin: number,
  end: number
): Promise<ReportResponse> {
  const limitations: string[] = [
    "Procedures are voluntary; findings are screening cues, not citations.",
    "ADS-B coverage gaps can miss or under-sample aircraft.",
    "Aircraft category (piston/turbine/helicopter) may be inferred when type is unknown.",
    `OpenSky REST airport lists are preferred; tracks prefer ADS-B.lol day traces when available.`,
    `OpenSky track lookback via REST is roughly ${OPENSKY.trackLookbackDays} days.`,
  ];

  const maxSpan = 36 * 3600;
  const cappedBegin = Math.max(begin, end - maxSpan);
  if (cappedBegin !== begin) {
    limitations.push(
      "Query window capped to the most recent 36 hours for API rate limits."
    );
  }

  let mode: "anonymous" | "oauth" | "demo" = "anonymous";
  let sourceNote =
    "OpenSky Network (KFFZ flights) + ADS-B.lol traces when available";
  let rawFlights;
  let metaByIcao = new Map<
    string,
    { registration: string | null; type: string | null }
  >();

  try {
    const result = await fetchAirportFlights(FFZ.icao, cappedBegin, end);
    rawFlights = result.flights;
    mode = result.mode;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "OpenSky unavailable";
    limitations.push(`OpenSky airport list failed (${msg}). Using ADS-B.lol nearby fallback.`);
    const fb = await discoverFlightsViaAdsbLol(cappedBegin, end);
    rawFlights = fb.flights;
    metaByIcao = fb.metaByIcao;
    sourceNote =
      "ADS-B.lol nearby aircraft + day traces (OpenSky unavailable — coverage limited to aircraft with traces)";
    mode = "anonymous";
  }

  if (!rawFlights.length) {
    // Always try ADS-B.lol fallback if OpenSky returned empty (or soft failure)
    try {
      const fb = await discoverFlightsViaAdsbLol(cappedBegin, end);
      if (fb.flights.length) {
        rawFlights = fb.flights;
        metaByIcao = fb.metaByIcao;
        limitations.push(
          "OpenSky returned no airport flights for this window; used ADS-B.lol nearby fallback."
        );
        sourceNote =
          "ADS-B.lol nearby aircraft + day traces (fallback — may miss aircraft no longer transmitting)";
      }
    } catch {
      // ignore
    }
  }

  const maxTracks = mode === "oauth" ? MAX_TRACKS_AUTH : MAX_TRACKS_ANON;
  const concurrency =
    mode === "oauth" ? TRACK_CONCURRENCY_AUTH : TRACK_CONCURRENCY_ANON;

  const sorted = [...rawFlights].sort((a, b) => b.lastSeen - a.lastSeen);
  const limited = sorted.slice(0, maxTracks);
  if (sorted.length > maxTracks) {
    limitations.push(
      `Analyzed ${maxTracks} of ${sorted.length} candidate flights (newest first).`
    );
  }

  const analyzed = await mapPool(limited, concurrency, async (flight) => {
    const hint = Math.floor((flight.firstSeen + flight.lastSeen) / 2);
    const loaded = await loadTrackPreferred(
      flight.icao24,
      cappedBegin,
      end,
      hint
    );
    await sleep(mode === "oauth" ? 80 : 200);
    const result = analyzeFlight(flight, loaded.track);
    const meta = metaByIcao.get(flight.icao24);
    return {
      ...result,
      registration:
        result.registration || loaded.registration || meta?.registration || null,
      aircraftType: result.aircraftType || loaded.type || meta?.type || null,
      source: loaded.source === "none" ? result.source : loaded.source,
      verifyUrl: `https://globe.adsb.lol/?icao=${flight.icao24}`,
    };
  });

  const withTracks = analyzed.filter((f) => f.track.length > 0);
  const flagged = withTracks
    .filter((f) => f.findings.length > 0)
    .sort((a, b) => {
      const rank = (s: string | null) =>
        s === "high" ? 3 : s === "medium" ? 2 : s === "low" ? 1 : 0;
      return rank(b.maxSeverity) - rank(a.maxSeverity) || b.lastSeen - a.lastSeen;
    });

  const unflaggedCount = withTracks.length - flagged.length;

  // Include a compact sample of unflagged ops so staff can see coverage
  const coverageSample = withTracks
    .filter((f) => f.findings.length === 0)
    .slice(0, 8)
    .map((f) => {
      const alts = f.track
        .filter((p) => p.altFt != null && !p.onGround)
        .map((p) => p.altFt!);
      return {
        id: f.id,
        callsign: f.callsign,
        icao24: f.icao24,
        registration: f.registration,
        category: f.category,
        firstSeen: f.firstSeen,
        lastSeen: f.lastSeen,
        trackPoints: f.track.length,
        minAltFt: alts.length ? Math.min(...alts) : -1,
        findingCount: f.findings.length,
      };
    });

  // Also sample flagged findings for completeness in meta when empty flagged list needs diagnosis
  const flaggedSample = withTracks
    .filter((f) => f.findings.length > 0)
    .slice(0, 5)
    .map((f) => ({
      id: f.id,
      callsign: f.callsign,
      codes: f.findings.map((x) => x.code),
      minAltFt: (() => {
        const alts = f.track
          .filter((p) => p.altFt != null && !p.onGround)
          .map((p) => p.altFt!);
        return alts.length ? Math.min(...alts) : -1;
      })(),
    }));

  return {
    meta: {
      begin: cappedBegin,
      end,
      timezone: "America/Phoenix",
      generatedAt: new Date().toISOString(),
      source: sourceNote,
      flightCount: withTracks.length,
      flaggedCount: flagged.length,
      limitations: [
        ...limitations,
        `${unflaggedCount} tracked operations in window had no screening flags.`,
      ],
      authMode: mode,
      coverageSample,
      flaggedSample,
    },
    flights: flagged,
  };
}

export function flightsToCsv(flights: AnalyzedFlight[]): string {
  const header = [
    "id",
    "icao24",
    "callsign",
    "registration",
    "category",
    "severity",
    "firstSeen_unix",
    "lastSeen_unix",
    "finding_codes",
    "summaries",
    "verifyUrl",
  ];
  const rows = flights.map((f) =>
    [
      f.id,
      f.icao24,
      f.callsign ?? "",
      f.registration ?? "",
      f.category,
      f.maxSeverity ?? "",
      f.firstSeen,
      f.lastSeen,
      f.findings.map((x) => x.code).join("|"),
      f.findings.map((x) => x.summary.replace(/"/g, "'")).join(" || "),
      f.verifyUrl,
    ]
      .map((v) => `"${String(v)}"`)
      .join(",")
  );
  return [header.join(","), ...rows].join("\n");
}
