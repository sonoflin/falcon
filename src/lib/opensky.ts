import { OPENSKY } from "./constants";
import { metersToFeet } from "./geography";
import type { OpenSkyFlight, TrackPoint } from "./types";

export type AuthMode = "anonymous" | "oauth";

let cachedToken: { value: string; expiresAt: number } | null = null;

type CacheEntry<T> = { expires: number; value: T };
const responseCache = new Map<string, CacheEntry<unknown>>();

function cacheGet<T>(key: string): T | null {
  const hit = responseCache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) {
    responseCache.delete(key);
    return null;
  }
  return hit.value as T;
}

function cacheSet<T>(key: string, value: T, ttlMs: number) {
  responseCache.set(key, { value, expires: Date.now() + ttlMs });
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export function getCredentials() {
  const clientId = process.env.OPENSKY_CLIENT_ID?.trim();
  const clientSecret = process.env.OPENSKY_CLIENT_SECRET?.trim();
  if (clientId && clientSecret) return { clientId, clientSecret };
  return null;
}

export function hasOpenskyCredentials(): boolean {
  return getCredentials() != null;
}

function formatFetchFailure(context: string, err: unknown): Error {
  const base = err instanceof Error ? err : new Error(String(err));
  const cause =
    base.cause instanceof Error
      ? base.cause.message
      : typeof base.cause === "string"
        ? base.cause
        : "";
  const detail = [base.message, cause].filter(Boolean).join(" — ");
  if (/fetch failed|network|ENOTFOUND|ECONNREFUSED|ETIMEDOUT|cert/i.test(detail)) {
    return new Error(
      `${context} network failure (${detail}). OpenSky may be unreachable from this host.`
    );
  }
  return new Error(`${context}: ${detail}`);
}

async function safeFetch(
  url: string,
  init: RequestInit,
  context: string
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    throw formatFetchFailure(context, err);
  }
}

export async function getAccessToken(): Promise<{
  token: string | null;
  mode: AuthMode;
}> {
  const creds = getCredentials();
  if (!creds) return { token: null, mode: "anonymous" };

  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return { token: cachedToken.value, mode: "oauth" };
  }

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
  });

  const res = await safeFetch(
    OPENSKY.tokenUrl,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      cache: "no-store",
    },
    "OpenSky OAuth token"
  );

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `OpenSky OAuth rejected credentials (${res.status}). Check OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET.`
      );
    }
    throw new Error(`OpenSky token error ${res.status}: ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
  };
  cachedToken = {
    value: json.access_token,
    expiresAt: Date.now() + (json.expires_in || 1800) * 1000,
  };
  return { token: cachedToken.value, mode: "oauth" };
}

async function openskyFetch(
  path: string,
  token: string | null,
  attempt = 0
): Promise<Response> {
  const headers: HeadersInit = { Accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await safeFetch(
    `${OPENSKY.apiBase}${path}`,
    {
      headers,
      cache: "no-store",
    },
    `OpenSky API ${path.split("?")[0]}`
  );
  if (res.status === 429 && attempt < 2) {
    const wait = 800 * Math.pow(2, attempt) + Math.floor(Math.random() * 200);
    await sleep(wait);
    return openskyFetch(path, token, attempt + 1);
  }
  return res;
}

function normalizeFlight(raw: Record<string, unknown>): OpenSkyFlight {
  return {
    icao24: String(raw.icao24 || "").toLowerCase(),
    firstSeen: Number(raw.firstSeen),
    lastSeen: Number(raw.lastSeen),
    callsign: raw.callsign ? String(raw.callsign).trim() || null : null,
    estDepartureAirport: raw.estDepartureAirport
      ? String(raw.estDepartureAirport)
      : null,
    estArrivalAirport: raw.estArrivalAirport
      ? String(raw.estArrivalAirport)
      : null,
    estDepartureAirportHorizDistance:
      raw.estDepartureAirportHorizDistance != null
        ? Number(raw.estDepartureAirportHorizDistance)
        : null,
    estArrivalAirportHorizDistance:
      raw.estArrivalAirportHorizDistance != null
        ? Number(raw.estArrivalAirportHorizDistance)
        : null,
  };
}

export function chunkInterval(
  begin: number,
  end: number,
  maxSec = OPENSKY.maxIntervalSec
): Array<{ begin: number; end: number }> {
  const out: Array<{ begin: number; end: number }> = [];
  let t = begin;
  while (t < end) {
    const e = Math.min(t + maxSec, end);
    out.push({ begin: t, end: e });
    t = e;
  }
  return out;
}

async function fetchFlightsEndpoint(
  kind: "departure" | "arrival",
  airport: string,
  begin: number,
  end: number,
  token: string | null,
  paceMs: number
): Promise<OpenSkyFlight[]> {
  const flights: OpenSkyFlight[] = [];
  const windows = chunkInterval(begin, end);
  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    const path = `/flights/${kind}?airport=${encodeURIComponent(airport)}&begin=${w.begin}&end=${w.end}`;
    const cacheKey = `flights:${path}`;
    const cached = cacheGet<OpenSkyFlight[]>(cacheKey);
    if (cached) {
      flights.push(...cached);
      continue;
    }

    const res = await openskyFetch(path, token);
    if (res.status === 404 || res.status === 204) {
      cacheSet(cacheKey, [], 120_000);
      continue;
    }
    if (res.status === 429) {
      throw new Error(
        "OpenSky rate limit reached. Wait a minute or ensure OPENSKY_CLIENT_ID / OPENSKY_CLIENT_SECRET are set on this deployment and redeployed."
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `OpenSky ${kind} unauthorized (${res.status}). Token may be invalid — re-check API client credentials.`
      );
    }
    if (!res.ok) {
      const text = await res.text();
      if (res.status === 404) continue;
      throw new Error(`OpenSky ${kind} ${res.status}: ${text.slice(0, 180)}`);
    }
    const data = await res.json();
    const rows: OpenSkyFlight[] = Array.isArray(data)
      ? data.map((row) => normalizeFlight(row))
      : [];
    cacheSet(cacheKey, rows, 180_000);
    flights.push(...rows);
    if (i < windows.length - 1) await sleep(paceMs);
  }
  return flights;
}

export async function fetchAirportFlights(
  airport: string,
  begin: number,
  end: number
): Promise<{ flights: OpenSkyFlight[]; mode: AuthMode }> {
  const { token, mode } = await getAccessToken();
  const paceMs = mode === "oauth" ? 250 : 1200;

  // Departures first (most relevant for noise screening), then arrivals.
  const deps = await fetchFlightsEndpoint(
    "departure",
    airport,
    begin,
    end,
    token,
    paceMs
  );
  await sleep(paceMs);
  const arrs = await fetchFlightsEndpoint(
    "arrival",
    airport,
    begin,
    end,
    token,
    paceMs
  ).catch(() => [] as OpenSkyFlight[]);

  const byKey = new Map<string, OpenSkyFlight>();
  for (const f of [...deps, ...arrs]) {
    const key = `${f.icao24}:${f.firstSeen}`;
    if (!byKey.has(key)) byKey.set(key, f);
  }
  return { flights: [...byKey.values()], mode };
}

export async function fetchTrack(
  icao24: string,
  time: number
): Promise<TrackPoint[]> {
  const hex = icao24.toLowerCase();
  const path = `/tracks/all?icao24=${encodeURIComponent(hex)}&time=${time}`;
  const cacheKey = `track:${hex}:${Math.floor(time / 60)}`;
  const cached = cacheGet<TrackPoint[]>(cacheKey);
  if (cached) return cached;

  const { token } = await getAccessToken();
  const res = await openskyFetch(path, token);
  if (res.status === 404 || res.status === 204) {
    cacheSet(cacheKey, [], 120_000);
    return [];
  }
  if (res.status === 429) {
    throw new Error(
      "OpenSky track rate limit reached. Wait briefly or configure OpenSky OAuth credentials."
    );
  }
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenSky track ${res.status}: ${text.slice(0, 180)}`);
  }
  const data = (await res.json()) as {
    path?: Array<
      [number, number, number, number | null, number | null, boolean]
    >;
  };
  if (!data.path?.length) {
    cacheSet(cacheKey, [], 120_000);
    return [];
  }
  const points = data.path
    .filter((p) => p[1] != null && p[2] != null)
    .map((p) => ({
      time: p[0],
      lat: p[1],
      lon: p[2],
      altFt: metersToFeet(p[3]),
      trackDeg: p[4],
      onGround: Boolean(p[5]),
    }));
  cacheSet(cacheKey, points, 300_000);
  return points;
}

export function verifyOpenskyUrl(icao24: string): string {
  return `https://opensky-network.org/aircraft/${icao24.toLowerCase()}`;
}
