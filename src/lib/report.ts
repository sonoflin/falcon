import { analyzeFlight } from "./analysis";
import {
  discoverFlightsViaAdsbLol,
  fetchDayTrace,
  filterTrackToWindow,
} from "./adsblol";
import { FFZ } from "./constants";
import { isKffzLocalTrack, isKiwaAirportCode } from "./geography";
import {
  fetchAirportFlights,
  fetchTrack,
  hasOpenskyCredentials,
} from "./opensky";
import type { AnalyzedFlight, ReportResponse, TrackPoint } from "./types";

const MAX_TRACKS_ANON = 24;
const MAX_TRACKS_AUTH = 48;
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
    "Fly Friendly / noise procedures are voluntary. Findings are screening flags and review candidates — not citations, violations, or regulatory determinations.",
    "ADS-B coverage gaps can miss or under-sample aircraft.",
    "Aircraft category prefers ADS-B type designator when available; otherwise inferred from flight path/callsign.",
    "Not detectable from ADS-B (non-goals): power/RPM/blade slap, Vy specifically, PAPI compliance, hover time, ATC clearances, or actual wind justifying runway choice.",
    "Track history for older operations may be limited.",
    "Airport identity: only KFFZ (Falcon Field) operations — tracks must approach KFFZ and are excluded when centered on KIWA (Mesa Gateway).",
  ];

  const maxSpan = 36 * 3600;
  const cappedBegin = Math.max(begin, end - maxSpan);
  if (cappedBegin !== begin) {
    limitations.push(
      "Query window capped to the most recent 36 hours."
    );
  }

  let mode: "anonymous" | "oauth" | "oauth_unreachable" | "demo" =
    "anonymous";
  let sourceNote = "KFFZ airport flights and ADS-B track traces";
  let rawFlights;
  let metaByIcao = new Map<
    string,
    { registration: string | null; type: string | null }
  >();
  const credsConfigured = hasOpenskyCredentials();

  try {
    const result = await fetchAirportFlights(FFZ.icao, cappedBegin, end);
    // Drop any OpenSky rows that already name Gateway as dep/arr.
    rawFlights = result.flights.filter(
      (f) =>
        !isKiwaAirportCode(f.estDepartureAirport) &&
        !isKiwaAirportCode(f.estArrivalAirport)
    );
    mode = result.mode;
    if (result.arrivalsIncomplete) {
      limitations.push(
        "OpenSky arrivals were incomplete for this window after retry — departure list may dominate; refresh once if results look thin."
      );
    }
    if (mode === "oauth_unreachable") {
      limitations.push(
        "Flight listing is using backup track data."
      );
    }
  } catch (err) {
    const authHint =
      err &&
      typeof err === "object" &&
      "authMode" in err &&
      (err as { authMode?: string }).authMode === "oauth_unreachable";
    if (credsConfigured || authHint) {
      mode = "oauth_unreachable";
      limitations.push(
        "Flight listing is using backup track data — overnight KFFZ arrival/departure lists may be incomplete."
      );
    } else {
      mode = "anonymous";
      limitations.push(
        "Flight listing is using backup track data."
      );
    }
    const fb = await discoverFlightsViaAdsbLol(cappedBegin, end);
    rawFlights = fb.flights;
    metaByIcao = fb.metaByIcao;
    sourceNote = "Backup track data (coverage may be limited)";
  }

  if (!rawFlights.length) {
    // Always try ADS-B.lol fallback if OpenSky returned empty (or soft failure)
    try {
      const fb = await discoverFlightsViaAdsbLol(cappedBegin, end);
      if (fb.flights.length) {
        rawFlights = fb.flights;
        metaByIcao = fb.metaByIcao;
        limitations.push(
          "No airport flights found for this window; using backup track data."
        );
        sourceNote = "Backup track data (coverage may be limited)";
      }
    } catch {
      // ignore
    }
  }

  const maxTracks = mode === "oauth" ? MAX_TRACKS_AUTH : MAX_TRACKS_ANON;
  const concurrency =
    mode === "oauth" ? TRACK_CONCURRENCY_AUTH : TRACK_CONCURRENCY_ANON;

  // Stable tie-breakers so the same candidate set truncates identically across runs.
  const sorted = [...rawFlights].sort(
    (a, b) =>
      b.lastSeen - a.lastSeen ||
      a.icao24.localeCompare(b.icao24) ||
      a.firstSeen - b.firstSeen
  );
  const limited = sorted.slice(0, maxTracks);
  if (sorted.length > maxTracks) {
    limitations.push(
      `Analyzed ${maxTracks} of ${sorted.length} candidate flights (newest first; raise OpenSky OAuth coverage for a larger sample).`
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

    // Post-filter: require KFFZ proximity; reject Gateway-centered tracks
    // (OpenSky mis-tags and ADS-B.lol nearby fallback can both leak KIWA).
    if (loaded.track.length >= 2 && !isKffzLocalTrack(loaded.track)) {
      return null;
    }

    const meta = metaByIcao.get(flight.icao24);
    const aircraftType = loaded.type || meta?.type || null;
    const result = analyzeFlight(flight, loaded.track, { aircraftType });
    return {
      ...result,
      registration:
        result.registration || loaded.registration || meta?.registration || null,
      aircraftType: result.aircraftType || aircraftType,
      source: loaded.source === "none" ? result.source : loaded.source,
      verifyUrl: `https://globe.adsb.lol/?icao=${flight.icao24}`,
    };
  });

  const kept = analyzed.filter((f): f is AnalyzedFlight => f != null);
  const droppedNonKffz = analyzed.length - kept.length;
  if (droppedNonKffz > 0) {
    limitations.push(
      `Excluded ${droppedNonKffz} candidate(s) that did not associate with KFFZ (e.g. Mesa Gateway / KIWA or distant transit).`
    );
  }

  const withTracks = kept.filter((f) => f.track.length > 0);
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
    "aircraftType",
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
      f.aircraftType ?? "",
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
