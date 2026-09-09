export type Severity = "high" | "medium" | "low";

export type ReasonCode =
  | "BELOW_PATTERN_ALT"
  | "SLOW_DEPARTURE_CLIMB"
  | "WIDE_PATTERN"
  | "NIGHT_REPETITIVE"
  | "QUIET_HOUR_ACTIVITY"
  | "LOW_OVER_MESA"
  | "NON_PREFERRED_DEPARTURE"
  | "HELI_LOW_NEAR_FIELD"
  | "HELI_WEST_OF_FIELD"
  | "HELI_ROUTE_SOFT";

export interface TrackPoint {
  time: number; // unix seconds
  lat: number;
  lon: number;
  altFt: number | null; // barometric MSL feet
  trackDeg: number | null;
  onGround: boolean;
}

export interface OpenSkyFlight {
  icao24: string;
  firstSeen: number;
  lastSeen: number;
  callsign: string | null;
  estDepartureAirport: string | null;
  estArrivalAirport: string | null;
  estDepartureAirportHorizDistance: number | null;
  estArrivalAirportHorizDistance: number | null;
}

export interface Finding {
  code: ReasonCode;
  severity: Severity;
  summary: string;
  evidence: string[];
  /** Representative point for map highlight */
  lat?: number;
  lon?: number;
  time?: number;
  altFt?: number | null;
}

export interface AnalyzedFlight {
  id: string;
  icao24: string;
  callsign: string | null;
  registration: string | null;
  aircraftType: string | null;
  category: "piston" | "turbine" | "helicopter" | "unknown";
  firstSeen: number;
  lastSeen: number;
  estDepartureAirport: string | null;
  estArrivalAirport: string | null;
  track: TrackPoint[];
  findings: Finding[];
  maxSeverity: Severity | null;
  inMesaOrNorth: boolean;
  source: string;
  verifyUrl: string;
}

export interface ReportMeta {
  begin: number;
  end: number;
  timezone: string;
  generatedAt: string;
  source: string;
  flightCount: number;
  flaggedCount: number;
  limitations: string[];
  authMode: "anonymous" | "oauth" | "demo";
  coverageSample?: Array<{
    id: string;
    callsign: string | null;
    icao24: string;
    registration: string | null;
    category: string;
    firstSeen: number;
    lastSeen: number;
    trackPoints: number;
    minAltFt: number;
    findingCount?: number;
  }>;
  flaggedSample?: Array<{
    id: string;
    callsign: string | null;
    codes: string[];
    minAltFt: number;
  }>;
}

export interface ReportResponse {
  meta: ReportMeta;
  flights: AnalyzedFlight[];
}
