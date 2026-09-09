"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AltitudeProfile } from "@/components/AltitudeProfile";
import { FlightMap } from "@/components/FlightMap";
import { PATTERN_ALT_MSL } from "@/lib/constants";
import { formatPhoenix } from "@/lib/time";
import type { AnalyzedFlight } from "@/lib/types";

function patternFor(cat: AnalyzedFlight["category"]) {
  if (cat === "helicopter") return PATTERN_ALT_MSL.helicopter;
  if (cat === "turbine") return PATTERN_ALT_MSL.turbine;
  return PATTERN_ALT_MSL.piston;
}

export function FlightDetailClient({
  id,
  callsign,
}: {
  id: string;
  callsign?: string;
}) {
  const [flight, setFlight] = useState<AnalyzedFlight | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (callsign) params.set("callsign", callsign);
        const res = await fetch(
          `/api/flights/${encodeURIComponent(id)}?${params.toString()}`,
          { cache: "no-store" }
        );
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load flight");
        if (!cancelled) setFlight(json);
      } catch (e) {
        if (!cancelled) {
          setFlight(null);
          setError(e instanceof Error ? e.message : "Failed to load flight");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, [id, callsign]);

  if (loading) {
    return (
      <p className="text-stone-500 py-16 text-center animate-pulse">
        Loading track evidence…
      </p>
    );
  }

  if (error || !flight) {
    return (
      <div className="py-12 space-y-4">
        <p className="text-red-800">{error || "Flight not found"}</p>
        <Link href="/" className="text-teal-900 underline text-sm">
          Back to report
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <Link href="/" className="text-sm text-teal-900 hover:underline">
            ← Report
          </Link>
          <h1 className="mt-2 text-3xl sm:text-4xl font-semibold tracking-tight text-stone-900">
            {flight.callsign || flight.registration || flight.icao24.toUpperCase()}
          </h1>
          <p className="mt-1 text-sm text-stone-600 font-mono">
            {flight.icao24.toUpperCase()}
            {flight.registration ? ` · ${flight.registration}` : ""}
            {flight.aircraftType ? ` · ${flight.aircraftType}` : ""}
            {` · ${flight.category}`}
          </p>
          <p className="text-sm text-stone-500 mt-1">
            {formatPhoenix(flight.firstSeen)} – {formatPhoenix(flight.lastSeen)} MST
          </p>
          <p className="mt-2 text-xs text-stone-500 max-w-lg">
            Screening flags / review candidates only — voluntary Fly Friendly guidance,
            not a regulatory determination.
          </p>
        </div>
        <a
          href={flight.verifyUrl}
          target="_blank"
          rel="noreferrer"
          className="text-sm px-3 py-2 border border-stone-300 hover:border-teal-800 text-stone-800"
        >
          Verify on OpenSky ↗
        </a>
      </div>

      <div className="grid lg:grid-cols-[1.4fr_1fr] gap-6 items-stretch">
        <div className="min-h-[320px] h-[420px] border border-stone-200/80 shadow-sm bg-stone-100">
          <FlightMap track={flight.track} findings={flight.findings} className="h-full w-full" />
        </div>
        <div className="space-y-4">
          <h2 className="text-sm uppercase tracking-wider text-stone-500">Altitude</h2>
          <AltitudeProfile
            track={flight.track}
            patternAltFt={patternFor(flight.category)}
          />
          <h2 className="text-sm uppercase tracking-wider text-stone-500 pt-2">
            Screening flags
          </h2>
          {flight.findings.length === 0 ? (
            <p className="text-sm text-stone-600">No screening flags on this track.</p>
          ) : (
            <ul className="space-y-4">
              {flight.findings.map((f) => (
                <li key={f.code + (f.time || 0)} className="border-l-2 border-teal-800 pl-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[11px] uppercase tracking-wide text-stone-500">
                      {f.severity}
                    </span>
                    <span className="text-[11px] font-mono text-teal-900/80">
                      {f.code}
                    </span>
                    <span className="text-sm font-medium text-stone-900">{f.summary}</span>
                  </div>
                  <ul className="mt-2 text-sm text-stone-600 space-y-1">
                    {f.evidence.map((e) => (
                      <li key={e}>• {e}</li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p className="text-xs text-stone-500">
        {flight.track.length >= 2
          ? `${flight.track.length} track points from ${flight.source}.`
          : `No usable track polyline (${flight.source}).`}{" "}
        Voluntary Fly Friendly screening only — not a regulatory determination.
        Non-goals from ADS-B: power/RPM, Vy, PAPI, hover time, ATC/wind justification.
      </p>
    </div>
  );
}
