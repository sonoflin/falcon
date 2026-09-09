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
  /** Approximate runway heading for 4/22 (magnetic ~040°/220°). */
  runwayHeading: 40,
  /**
   * Approximate runway 4 departure / 22 arrival end (SW end of field).
   * Chart Supp quiet-pattern language references ~¾ mi from runway end.
   */
  rwy4Threshold: { lat: 33.4555, lon: -111.7335 },
  /** Approximate runway 22 departure / 4 arrival end (NE end). */
  rwy22Threshold: { lat: 33.4661, lon: -111.7231 },
} as const;

/**
 * Phoenix-Mesa Gateway (KIWA / IWA) — ~10 NM south of KFFZ.
 * Used only to exclude Gateway-centered traffic from FFZ screening lists.
 */
export const KIWA = {
  icao: "KIWA",
  iata: "IWA",
  name: "Phoenix-Mesa Gateway Airport",
  lat: 33.3078,
  lon: -111.6556,
} as const;

/**
 * Deterministic airport-identity filter (KFFZ vs KIWA).
 * Airports are ~9.9 NM apart — geo association is reliable at these thresholds.
 */
export const AIRPORT_FILTER = {
  /** Closest approach to KFFZ ARP must be ≤ this NM. */
  kffzAssociationNm: 4,
  /** Within this of KIWA ARP counts as Gateway-terminal activity. */
  kiwaTerminalNm: 3.5,
  /**
   * Reject when min(KIWA) + margin < min(KFFZ): track is Gateway-centered
   * even if it briefly drifted toward Falcon Field.
   */
  preferMarginNm: 1.5,
  /**
   * ADS-B.lol live nearby search radius. Kept below KFFZ–KIWA separation
   * so Gateway ARP traffic is not discovered as “near Falcon Field.”
   */
  adsbNearbyNm: 8,
} as const;

/** Pattern altitudes MSL (feet) from official FFZ noise abatement guidance (rev 11/04/2024). */
export const PATTERN_ALT_MSL = {
  turbine: 2900,
  piston: 2400,
  helicopter: 1900,
} as const;

/** Climb target after departure before leveling (piston pattern altitude). */
export const DEPARTURE_CLIMB_TARGET_MSL = PATTERN_ALT_MSL.piston;

/**
 * Quiet / avoid-repetitive window (local Arizona time).
 * Chart Supplement: 0500–1230Z ≡ 22:00–05:30 Arizona (no DST).
 */
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
  /**
   * Lateral offset from runway centerline (statute miles) for wide-pattern screen.
   * Chart: keep downwind ~¾–1 SM; buffer ~1.1 SM for ADS-B/FP variance.
   */
  widePatternSm: 1.1,
  climbCheckNm: 1.5,
  heliNearFieldNm: 2,
  mesaFocusNm: 12,
  /** Final/base exclusion: within this NM + descending / runway-aligned → not pattern-alt flag. */
  finalApproachNm: 1.0,
} as const;

/**
 * Bounding box for OpenSky states / regional focus (Mesa + north of field).
 * Southern edge stays north of KIWA ARP (~33.31°) to avoid Gateway-centric pulls.
 */
export const REGION_BBOX = {
  lamin: 33.36,
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
  maxBounds: [-112.05, 33.25, -111.45, 33.65] as [
    number,
    number,
    number,
    number,
  ],
} as const;

/**
 * Approximate Roosevelt Irrigation Canal west of the runways.
 * Helicopters are asked to remain east of the canal adjacent to the field
 * (not a blanket “anything west of HELI_WEST_LON” screen).
 * Lat band roughly covers runway latitudes ± a short buffer.
 */
export const HELI_CANAL = {
  /** Approximate canal longitude near field (west edge). */
  lon: -111.745,
  latMin: 33.448,
  latMax: 33.475,
} as const;

/** @deprecated Prefer HELI_CANAL — kept for evidence strings. */
export const HELI_WEST_LON = HELI_CANAL.lon;

/**
 * Approximate published heli inbound/outbound corridors (lite polylines).
 * Soft conformance only — ATC may vector off route.
 * Roughly: Snake (SE), Cactus (S), Gecko (NW), Yankee (NE).
 */
export const HELI_ROUTES: Array<{
  name: string;
  /** Waypoints [lat, lon] from outer fix toward field. */
  points: Array<[number, number]>;
  corridorNm: number;
}> = [
  {
    name: "Snake",
    points: [
      [33.42, -111.68],
      [33.44, -111.70],
      [33.455, -111.72],
    ],
    corridorNm: 0.6,
  },
  {
    name: "Cactus",
    points: [
      [33.41, -111.73],
      [33.43, -111.73],
      [33.45, -111.73],
    ],
    corridorNm: 0.6,
  },
  {
    name: "Gecko",
    points: [
      [33.50, -111.78],
      [33.48, -111.76],
      [33.47, -111.74],
    ],
    corridorNm: 0.6,
  },
  {
    name: "Yankee",
    points: [
      [33.51, -111.69],
      [33.49, -111.70],
      [33.475, -111.72],
    ],
    corridorNm: 0.6,
  },
];

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

/** ICAO type designators commonly seen as helicopters at FFZ. */
export const HELI_TYPE_CODES = new Set([
  "R22",
  "R44",
  "R66",
  "B06",
  "B407",
  "B206",
  "H500",
  "EC30",
  "EC35",
  "EC45",
  "AS50",
  "AS55",
  "S76",
  "A109",
  "UH1",
  "H60",
]);

/** Turbine / larger GA types often assigned 2,900 ft pattern. */
export const TURBINE_TYPE_CODES = new Set([
  "C525",
  "C510",
  "C25A",
  "C25B",
  "C25C",
  "C56X",
  "C680",
  "E50P",
  "E55P",
  "EA50",
  "BE40",
  "BE9L",
  "PC12",
  "TBM7",
  "TBM8",
  "TBM9",
  "PAY1",
  "PAY2",
  "PAY3",
  "C208",
  "C441",
  "LJ35",
  "LJ45",
  "FA50",
  "CL30",
]);
