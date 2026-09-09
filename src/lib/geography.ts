import {
  booleanPointInPolygon,
  point,
  distance as turfDistance,
} from "@turf/turf";
import type { Feature, MultiPolygon, Polygon } from "geojson";
import mesaBoundary from "@/data/mesa-boundary.json";
import { FFZ, HELI_WEST_LON } from "./constants";

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

export function isWestOfHeliCanal(lon: number): boolean {
  return lon < HELI_WEST_LON;
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

export { mesaFeature };
