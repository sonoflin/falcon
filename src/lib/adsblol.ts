import { ADSB_LOL, AIRPORT_FILTER, FFZ } from "./constants";
import { distFromFfzNm, isKffzLocalTrack } from "./geography";
import type { OpenSkyFlight, TrackPoint } from "./types";

type AdsbLolAircraft = {
  hex?: string;
  flight?: string;
  r?: string;
  t?: string;
  alt_baro?: number | string;
  lat?: number;
  lon?: number;
  gs?: number;
  track?: number;
  category?: string;
  dst?: number;
};

type TraceJson = {
  icao?: string;
  r?: string;
  t?: string;
  timestamp?: number;
  trace?: Array<unknown[]>;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

const UA =
  "FFZ-Ops-Review/1.0 (+https://github.com/sonoflin/falcon; mesa-airport-ops-screening)";

async function adsbFetch(url: string): Promise<Response> {
  return fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json, application/gzip, */*",
      "User-Agent": UA,
    },
  });
}

export async function fetchNearbyLive(
  distNm = AIRPORT_FILTER.adsbNearbyNm
): Promise<AdsbLolAircraft[]> {
  const url = `${ADSB_LOL.apiBase}/lat/${FFZ.lat}/lon/${FFZ.lon}/dist/${distNm}`;
  const res = await adsbFetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as { ac?: AdsbLolAircraft[] };
  return data.ac || [];
}

/**
 * Fetch today's (or recent) full trace for an ICAO24 from adsb.lol globe history.
 * Trace altitudes are barometric feet. Times = base timestamp + offset seconds.
 */
export async function fetchDayTrace(icao24: string): Promise<{
  track: TrackPoint[];
  registration: string | null;
  aircraftType: string | null;
  baseTimestamp: number | null;
}> {
  const hex = icao24.toLowerCase();
  const tail = hex.slice(-2);
  const url = `https://globe.adsb.lol/data/traces/${tail}/trace_full_${hex}.json`;
  const res = await adsbFetch(url);
  if (!res.ok) {
    return {
      track: [],
      registration: null,
      aircraftType: null,
      baseTimestamp: null,
    };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  let json: TraceJson;
  try {
    // Responses are typically gzip even when Content-Encoding varies
    const zlib = await import("zlib");
    const text = zlib.gunzipSync(buf).toString("utf8");
    json = JSON.parse(text) as TraceJson;
  } catch {
    try {
      json = JSON.parse(buf.toString("utf8")) as TraceJson;
    } catch {
      return {
        track: [],
        registration: null,
        aircraftType: null,
        baseTimestamp: null,
      };
    }
  }

  const base = Number(json.timestamp) || 0;
  const track: TrackPoint[] = [];
  for (const row of json.trace || []) {
    if (!Array.isArray(row) || row.length < 4) continue;
    const offset = Number(row[0]);
    const lat = Number(row[1]);
    const lon = Number(row[2]);
    const alt = row[3];
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    let altFt: number | null = null;
    if (typeof alt === "number" && Number.isFinite(alt)) altFt = Math.round(alt);
    else if (alt === "ground") altFt = null;
    const trackDeg =
      row[5] != null && Number.isFinite(Number(row[5])) ? Number(row[5]) : null;
    const onGround = alt === "ground" || (typeof altFt === "number" && altFt < FFZ.elevFt + 50);
    track.push({
      time: Math.floor(base + offset),
      lat,
      lon,
      altFt: onGround && alt === "ground" ? FFZ.elevFt : altFt,
      trackDeg,
      onGround: Boolean(onGround),
    });
  }

  return {
    track,
    registration: json.r || null,
    aircraftType: json.t || null,
    baseTimestamp: base || null,
  };
}

export function filterTrackToWindow(
  track: TrackPoint[],
  begin: number,
  end: number
): TrackPoint[] {
  return track.filter((p) => p.time >= begin && p.time <= end);
}

/** Aircraft from live snapshot that have operated near FFZ — used when OpenSky is unavailable. */
export async function discoverFlightsViaAdsbLol(
  begin: number,
  end: number
): Promise<{
  flights: OpenSkyFlight[];
  metaByIcao: Map<string, { registration: string | null; type: string | null }>;
}> {
  // Radius kept below KFFZ–KIWA separation so Gateway live traffic is not pulled in.
  const live = await fetchNearbyLive(AIRPORT_FILTER.adsbNearbyNm);
  const metaByIcao = new Map<
    string,
    { registration: string | null; type: string | null }
  >();
  const flights: OpenSkyFlight[] = [];

  const gaType = (t?: string) => {
    if (!t) return false;
    const u = t.toUpperCase();
    return /^(P28|C172|C152|C182|C206|DA40|DA42|SR2|BE36|BE35|M20|PA2|PA3|RV|H500|B06|R44|R22|EC3|AS5)/.test(
      u
    );
  };

  // Prefer light GA / helicopters near the field over airliner overflights
  const ranked = [...live]
    .filter((a) => a.hex && a.lat != null && a.lon != null)
    .sort((a, b) => {
      const score = (x: AdsbLolAircraft) =>
        (gaType(x.t) ? 50 : 0) +
        ((x.dst != null ? Math.max(0, 20 - x.dst) : 0) || 0) +
        ((typeof x.gs === "number" && x.gs < 150 ? 10 : 0));
      return score(b) - score(a);
    });

  const candidates = ranked.slice(0, 30);

  for (const ac of candidates) {
    const hex = ac.hex!.toLowerCase();
    metaByIcao.set(hex, {
      registration: ac.r || null,
      type: ac.t || null,
    });
    await sleep(120);
    const day = await fetchDayTrace(hex);
    if (day.registration) {
      metaByIcao.set(hex, {
        registration: day.registration,
        type: day.aircraftType || ac.t || null,
      });
    }
    const windowTrack = filterTrackToWindow(day.track, begin, end);
    const near = windowTrack.filter(
      (p) => distFromFfzNm(p.lat, p.lon) <= AIRPORT_FILTER.kffzAssociationNm
    );
    if (near.length < 2) continue;
    // Dual gate: near KFFZ and not primarily a KIWA/Gateway operation.
    if (!isKffzLocalTrack(windowTrack)) continue;

    flights.push({
      icao24: hex,
      firstSeen: near[0].time,
      lastSeen: near[near.length - 1].time,
      callsign: ac.flight?.trim() || ac.r || null,
      estDepartureAirport: "KFFZ",
      estArrivalAirport: null,
      estDepartureAirportHorizDistance: null,
      estArrivalAirportHorizDistance: null,
    });
  }

  return { flights, metaByIcao };
}
