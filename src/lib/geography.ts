import {
  booleanPointInPolygon,
  point,
  distance as turfDistance,
} from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import mesaBoundary from "@/data/mesa-boundary.json";
import {
  AIRPORT_FILTER,
  FFZ,
  HELI_CANAL,
  HELI_ROUTES,
  HELI_WEST_LON,
  KIWA,
} from "./constants";
import type { TrackPoint } from "./types";

const mesaFeature = mesaBoundary as Feature<Polygon | MultiPolygon>;

export function metersToFeet(m: number | null | undefined): number | null {
  if (m == null || Number.isNaN(m)) return null;
  return Math.round(m * 3.280839895);
}

export function nmBetween(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  return turfDistance(point([lon1, lat1]), point([lon2, lat2]), {
    units: "nauticalmiles",
  });
}

export function smBetween(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  return turfDistance(point([lon1, lat1]), point([lon2, lat2]), {
    units: "miles",
  });
}

export function distFromFfzNm(lat: number, lon: number): number {
  return nmBetween(lat, lon, FFZ.lat, FFZ.lon);
}

export function distFromKiwaNm(lat: number, lon: number): number {
  return nmBetween(lat, lon, KIWA.lat, KIWA.lon);
}

export function trackClosestApproaches(track: TrackPoint[]): {
  minFfzNm: number;
  minIwaNm: number;
} {
  let minFfzNm = Infinity;
  let minIwaNm = Infinity;
  for (const p of track) {
    minFfzNm = Math.min(minFfzNm, distFromFfzNm(p.lat, p.lon));
    minIwaNm = Math.min(minIwaNm, distFromKiwaNm(p.lat, p.lon));
  }
  return { minFfzNm, minIwaNm };
}

/**
 * Deterministic KFFZ-only association for screening lists.
 * Requires a close approach to Falcon Field and rejects tracks whose
 * closest activity is centered on Mesa Gateway (KIWA / IWA).
 */
export function isKffzLocalTrack(track: TrackPoint[]): boolean {
  if (track.length < 2) return false;
  const { minFfzNm, minIwaNm } = trackClosestApproaches(track);
  if (!Number.isFinite(minFfzNm)) return false;

  if (minFfzNm > AIRPORT_FILTER.kffzAssociationNm) return false;

  // Gateway-centered: came within KIWA terminal and stayed meaningfully closer
  // to Gateway than to Falcon Field.
  if (
    minIwaNm <= AIRPORT_FILTER.kiwaTerminalNm &&
    minIwaNm + AIRPORT_FILTER.preferMarginNm < minFfzNm
  ) {
    return false;
  }

  return true;
}

/** True when OpenSky (or fallback) airport codes clearly refer to Gateway. */
export function isKiwaAirportCode(code: string | null | undefined): boolean {
  if (!code) return false;
  const u = code.trim().toUpperCase();
  return u === "KIWA" || u === "IWA";
}

export function isInMesaCityLimits(lat: number, lon: number): boolean {
  try {
    return booleanPointInPolygon(point([lon, lat]), mesaFeature);
  } catch {
    return false;
  }
}

export function isNorthOfField(lat: number): boolean {
  return lat > FFZ.lat;
}

/** @deprecated Prefer isWestOfHeliCanalAdjacent */
export function isWestOfHeliCanal(lon: number): boolean {
  return lon < HELI_WEST_LON;
}

/**
 * West of Roosevelt Irrigation Canal and adjacent to runway latitudes
 * (not a blanket “west of HELI_WEST_LON anywhere near Mesa”).
 */
export function isWestOfHeliCanalAdjacent(lat: number, lon: number): boolean {
  return (
    lon < HELI_CANAL.lon &&
    lat >= HELI_CANAL.latMin &&
    lat <= HELI_CANAL.latMax
  );
}

export function bearingDeg(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

function headingDiff(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Approximate cross-track distance (statute miles) from the 4/22 centerline
 * through the field reference point.
 */
export function lateralOffsetFromRunwaySm(lat: number, lon: number): number {
  const brg = bearingDeg(FFZ.lat, FFZ.lon, lat, lon);
  const rangeSm = smBetween(lat, lon, FFZ.lat, FFZ.lon);
  const delta = ((brg - FFZ.runwayHeading) * Math.PI) / 180;
  return Math.abs(Math.sin(delta) * rangeSm);
}

/**
 * Along-track distance (statute miles) from field center along runway axis.
 * Positive toward runway 4 heading (NE).
 */
export function alongRunwaySm(lat: number, lon: number): number {
  const brg = bearingDeg(FFZ.lat, FFZ.lon, lat, lon);
  const rangeSm = smBetween(lat, lon, FFZ.lat, FFZ.lon);
  const delta = ((brg - FFZ.runwayHeading) * Math.PI) / 180;
  return Math.cos(delta) * rangeSm;
}

/**
 * True when the point looks like final/base rather than downwind/abeam:
 * runway-aligned corridor within ~1 NM, or toward runway + descending.
 */
export function isLikelyFinalOrBase(
  lat: number,
  lon: number,
  trackDeg: number | null,
  altFt: number | null,
  prevAltFt: number | null
): boolean {
  const dNm = distFromFfzNm(lat, lon);
  if (dNm > 1.2) return false;

  const lateralSm = lateralOffsetFromRunwaySm(lat, lon);
  const alongSm = alongRunwaySm(lat, lon);
  const onExtendedCenterline =
    lateralSm < 0.35 && Math.abs(alongSm) > 0.15 && dNm < 1.0;

  const rwy = FFZ.runwayHeading;
  const aligned =
    trackDeg != null &&
    (headingDiff(trackDeg, rwy) < 35 || headingDiff(trackDeg, (rwy + 180) % 360) < 35);

  const descending =
    altFt != null &&
    prevAltFt != null &&
    altFt < prevAltFt - 20;

  // Toward field on runway heading within ~1 NM while descending
  const towardRunwayDescending =
    dNm < 1.0 && aligned && descending && lateralSm < 0.5;

  // Base: closer-in turn toward final (moderate lateral, descending, near field)
  const baseTurn =
    dNm < 0.85 &&
    descending &&
    lateralSm >= 0.25 &&
    lateralSm < 0.9 &&
    trackDeg != null &&
    headingDiff(trackDeg, rwy) > 40 &&
    headingDiff(trackDeg, (rwy + 180) % 360) > 40;

  return onExtendedCenterline || towardRunwayDescending || baseTurn;
}

/** True for downwind / abeam geometry (lateral offset, not on final). */
export function isLikelyDownwindAbeam(lat: number, lon: number): boolean {
  const dNm = distFromFfzNm(lat, lon);
  if (dNm < 0.25 || dNm > 2.2) return false;
  const lateralSm = lateralOffsetFromRunwaySm(lat, lon);
  const alongSm = Math.abs(alongRunwaySm(lat, lon));
  // Abeam/downwind: meaningfully offset from centerline, not far beyond runway ends
  return lateralSm >= 0.35 && alongSm < 1.4;
}

/** Distance in NM from point to nearest segment of a polyline. */
function distToPolylineNm(
  lat: number,
  lon: number,
  points: Array<[number, number]>
): number {
  let best = Infinity;
  for (let i = 0; i < points.length - 1; i++) {
    const [lat1, lon1] = points[i];
    const [lat2, lon2] = points[i + 1];
    // Sample midpoint + endpoints (lite — good enough for soft corridors)
    const midLat = (lat1 + lat2) / 2;
    const midLon = (lon1 + lon2) / 2;
    best = Math.min(
      best,
      nmBetween(lat, lon, lat1, lon1),
      nmBetween(lat, lon, lat2, lon2),
      nmBetween(lat, lon, midLat, midLon)
    );
  }
  return best;
}

/**
 * Soft heli-route conformance: if operating near field inbound/outbound
 * but consistently outside all published corridor approximations.
 */
export function heliRouteSoftMiss(
  lat: number,
  lon: number
): { miss: boolean; nearest: string; distNm: number } {
  let nearest = HELI_ROUTES[0]?.name ?? "unknown";
  let best = Infinity;
  for (const route of HELI_ROUTES) {
    const d = distToPolylineNm(lat, lon, route.points);
    if (d < best) {
      best = d;
      nearest = route.name;
    }
  }
  const corridor = HELI_ROUTES.find((r) => r.name === nearest)?.corridorNm ?? 0.6;
  return { miss: best > corridor, nearest, distNm: best };
}

export { mesaFeature, headingDiff };
