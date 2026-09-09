"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FlightList } from "@/components/FlightList";
import { TimePresets } from "@/components/TimePresets";
import { formatPhoenix, type PresetId } from "@/lib/time";
import type { AnalyzedFlight, ReportMeta, Severity } from "@/lib/types";

type ReportPayload = {
  meta: ReportMeta;
  flights: AnalyzedFlight[];
  window: { begin: number; end: number; label: string; preset: PresetId };
};

export function ReportDashboard() {
  const [preset, setPreset] = useState<PresetId>("staff_off");
  const [customBegin, setCustomBegin] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState<Severity | "all">("all");
  const [data, setData] = useState<ReportPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ preset });
      if (preset === "custom") {
        if (!customBegin || !customEnd) {
          throw new Error("Select both start and end for a custom range.");
        }
        const begin = Math.floor(new Date(customBegin).getTime() / 1000);
        const end = Math.floor(new Date(customEnd).getTime() / 1000);
        params.set("begin", String(begin));
        params.set("end", String(end));
      }
      const res = await fetch(`/api/report?${params.toString()}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load report");
      setData(json);
    } catch (e) {
      setData(null);
      setError(e instanceof Error ? e.message : "Failed to load report");
    } finally {
      setLoading(false);
    }
  }, [preset, customBegin, customEnd]);

  useEffect(() => {
    if (preset !== "custom") {
      void load();
    }
  }, [preset, load]);

  const exportHref = useMemo(() => {
    const params = new URLSearchParams({ preset, format: "csv" });
    if (preset === "custom" && customBegin && customEnd) {
      params.set("begin", String(Math.floor(new Date(customBegin).getTime() / 1000)));
      params.set("end", String(Math.floor(new Date(customEnd).getTime() / 1000)));
    }
    return `/api/export?${params.toString()}`;
  }, [preset, customBegin, customEnd]);

  return (
    <div className="flex flex-col gap-8">
      <aside
        className="border border-teal-900/20 bg-teal-950/[0.04] px-4 py-3 text-sm text-stone-700 leading-relaxed"
        role="note"
      >
        <p className="font-medium text-stone-900">
          Voluntary Fly Friendly screening — not enforcement
        </p>
        <p className="mt-1">
          Flags below are review candidates against Mesa / KFFZ noise-abatement
          guidance. Procedures are voluntary. This is screening only — not a
          regulatory determination, citation, or “violator” list. Wind, ATC, and
          coverage gaps can explain many tracks.
        </p>
        <p className="mt-2 text-xs text-stone-500">
          Not screened from ADS-B: power/RPM/blade slap, Vy, PAPI, hover time, or
          ATC/wind justification.
        </p>
      </aside>

      <section className="space-y-4">
        <TimePresets value={preset} onChange={setPreset} />
        {preset === "custom" && (
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
            <label className="flex flex-col gap-1 text-sm text-stone-600 flex-1">
              Start (local browser)
              <input
                type="datetime-local"
                value={customBegin}
                onChange={(e) => setCustomBegin(e.target.value)}
                className="border border-stone-300 bg-white/80 px-3 py-2 text-stone-900"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-stone-600 flex-1">
              End
              <input
                type="datetime-local"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="border border-stone-300 bg-white/80 px-3 py-2 text-stone-900"
              />
            </label>
            <button
              type="button"
              onClick={() => void load()}
              className="px-4 py-2 bg-teal-900 text-amber-50 text-sm font-medium hover:bg-teal-800"
            >
              Run report
            </button>
          </div>
        )}
      </section>

      <section className="flex flex-col sm:flex-row sm:items-end gap-4 justify-between">
        <div>
          {data ? (
            <>
              <p className="text-sm text-stone-600">
                {data.window.label} · {formatPhoenix(data.window.begin)} –{" "}
                {formatPhoenix(data.window.end)} MST
              </p>
              <p className="mt-1 text-2xl sm:text-3xl font-semibold tracking-tight text-stone-900">
                {data.meta.flaggedCount} screening{" "}
                {data.meta.flaggedCount === 1 ? "flag" : "flags"}
                <span className="text-base font-normal text-stone-500 ml-2">
                  from {data.meta.flightCount} tracked ops
                </span>
              </p>
            </>
          ) : (
            <p className="text-stone-600 text-sm">
              {loading
                ? "Pulling ADS-B tracks for KFFZ…"
                : "Select a window to review."}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="px-3 py-2 border border-stone-300 text-sm text-stone-800 hover:border-teal-800 disabled:opacity-50"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
          <a
            href={exportHref}
            className="px-3 py-2 border border-stone-300 text-sm text-stone-800 hover:border-teal-800"
          >
            Export CSV
          </a>
          <button
            type="button"
            onClick={() => window.print()}
            className="px-3 py-2 bg-stone-900 text-amber-50 text-sm hover:bg-stone-800 print:hidden"
          >
            Print report
          </button>
        </div>
      </section>

      {error && (
        <div
          className="border border-red-300 bg-red-50 text-red-900 px-4 py-3 text-sm"
          role="alert"
        >
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="py-20 text-center text-stone-500 animate-pulse">
          Fetching airport flights and tracks…
        </div>
      )}

      {data && (
        <>
          <section className="flex flex-col sm:flex-row gap-3 print:hidden">
            <input
              type="search"
              placeholder="Search callsign, ICAO24, registration, code…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 border border-stone-300 bg-white/80 px-3 py-2 text-sm"
            />
            <select
              value={severity}
              onChange={(e) => setSeverity(e.target.value as Severity | "all")}
              className="border border-stone-300 bg-white/80 px-3 py-2 text-sm"
              aria-label="Filter by severity"
            >
              <option value="all">All severities</option>
              <option value="high">High</option>
              <option value="medium">Medium</option>
              <option value="low">Low</option>
            </select>
          </section>

          <FlightList flights={data.flights} query={query} severity={severity} />

          <details className="text-xs text-stone-500 print:block">
            <summary className="cursor-pointer text-stone-600">Data notes</summary>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li>Source: {data.meta.source}</li>
              <li>Auth: {data.meta.authMode}</li>
              <li>Generated: {data.meta.generatedAt}</li>
              {data.meta.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </details>
        </>
      )}
    </div>
  );
}
