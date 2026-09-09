/** Falcon Field (KFFZ) geography and measurable procedure thresholds. */

export const TZ = "America/Phoenix";

export const FFZ = {
  icao: "KFFZ",
  iata: "FFZ",
  name: "Falcon Field Airport",
  lat: 33.4608,
  lon: -111.7283,
  /** Field elevation MSL feet (derived from published pattern AGL/MSL pairs). */
  elevFt: 1394,
  /** Approximate runway heading for 4/22. */
  runwayHeading: 40,
} as const;

/** Pattern altitudes MSL (feet) from official FFZ noise abatement guidance (rev 11/04/2024). */
export const PATTERN_ALT_MSL = {
  turbine: 2900,
  piston: 2400,
  helicopter: 1900,
} as const;

/** Climb target after departure before leveling (piston pattern altitude). */
export const DEPARTURE_CLIMB_TARGET_MSL = PATTERN_ALT_MSL.piston;

/** Quiet / avoid-repetitive window (local Arizona time). */
export const QUIET_HOURS = {
  startHour: 22,
  startMinute: 0,
  endHour: 5,
  endMinute: 30,
} as const;

/** Airport staff typically not present. */
export const STAFF_OFF = {
  startHour: 18,
  startMinute: 0,
  endHour: 5,
  endMinute: 30,
} as const;

/** Preferred calm-wind runway family (4L/4R) — departure corridor NE toward Salt River / industrial. */
export const PREFERRED_DEPARTURE_HEADING_MIN = 10;
export const PREFERRED_DEPARTURE_HEADING_MAX = 80;

/** Analysis radii (nautical miles unless noted). */
export const RADII_NM = {
  terminal: 5,
  pattern: 2,
  widePatternSm: 1.25, // statute miles — guidance says 3/4–1 SM downwind
  climbCheckNm: 1.5,
  heliNearFieldNm: 2,
  mesaFocusNm: 12,
} as const;

/** Bounding box for OpenSky states / regional focus (Mesa + north of field). */
export const REGION_BBOX = {
  lamin: 33.3,
  lomin: -111.95,
  lamax: 33.75,
  lomax: -111.5,
} as const;

/**
 * Map camera limits — Phoenix East Valley (Falcon Field / Mesa / Gilbert / north Mesa).
 * Keeps the map from opening to a world view.
 */
export const MAP_VIEW = {
  center: [FFZ.lon, FFZ.lat] as [number, number],
  zoom: 12,
  minZoom: 10,
  maxZoom: 16,
  /** [west, south, east, north] */
  maxBounds: [-112.05, 33.25, -111.45, 33.65] as [number, number, number, number],
} as const;

/**
 * Approximate west edge of field / Roosevelt Irrigation Canal corridor.
 * Helicopters are asked to remain east of the canal west of the runways.
 */
export const HELI_WEST_LON = -111.745;

export const OPENSKY = {
  apiBase: "https://opensky-network.org/api",
  tokenUrl:
    "https://auth.opensky-network.org/auth/realms/opensky-network/protocol/openid-connect/token",
  /** Max seconds per flights/* request (OpenSky docs). */
  maxIntervalSec: 2 * 60 * 60,
  trackLookbackDays: 30,
} as const;

export const ADSB_LOL = {
  apiBase: "https://api.adsb.lol/v2",
} as const;
