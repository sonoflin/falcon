"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FlightList } from "@/components/FlightList";
import { FlightMap } from "@/components/FlightMap";
import { TimePresets } from "@/components/TimePresets";
import {
  parsePhoenixDateTimeLocal,
  resolvePreset,
  type PresetId,
} from "@/lib/time";
import type { AnalyzedFlight, ReportMeta, Severity } from "@/lib/types";

type ReportPayload = {
  meta: ReportMeta;
  flights: AnalyzedFlight[];
  window: {
    begin: number;
    end: number;
    label: string;
    rangeLabel: string;
    preset: PresetId;
    partial?: boolean;
  };
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
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadFor = useCallback(
    async (nextPreset: PresetId) => {
      setLoading(true);
      setError(null);
      try {
        let begin: number;
        let end: number;

        if (nextPreset === "custom") {
          if (!customBegin || !customEnd) {
            throw new Error("Select both start and end for a custom range.");
          }
          begin = parsePhoenixDateTimeLocal(customBegin);
          end = parsePhoenixDateTimeLocal(customEnd);
        } else {
          // Resolve once on the client and pin begin/end on the request so the
          // server does not drift with a later "now".
          const w = resolvePreset(nextPreset);
          begin = w.begin;
          end = w.end;
        }

        const params = new URLSearchParams({
          preset: nextPreset,
          begin: String(begin),
          end: String(end),
        });
        const res = await fetch(`/api/report?${params.toString()}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to load report");
        setData(json);
        const firstId = (json.flights as AnalyzedFlight[])[0]?.id ?? null;
        setSelectedId((prev) => {
          if (
            prev &&
            (json.flights as AnalyzedFlight[]).some((f) => f.id === prev)
          ) {
            return prev;
          }
          return firstId;
        });
      } catch (e) {
        setData(null);
        setSelectedId(null);
        setError(e instanceof Error ? e.message : "Failed to load report");
      } finally {
        setLoading(false);
      }
    },
    [customBegin, customEnd]
  );

  const load = useCallback(() => loadFor(preset), [loadFor, preset]);

  const onPresetChange = (id: PresetId) => {
    setPreset(id);
    if (id !== "custom") {
      void loadFor(id);
    } else {
      setData(null);
      setSelectedId(null);
      setError(null);
    }
  };

  // Mount-only fetch for the default preset (chip changes call onPresetChange).
  useEffect(() => {
    const t = window.setTimeout(() => {
      void loadFor("staff_off");
    }, 0);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional mount-only
  }, []);
  const exportHref = useMemo(() => {
    const params = new URLSearchParams({ preset, format: "csv" });
    if (data?.window.begin != null && data?.window.end != null) {
      params.set("begin", String(data.window.begin));
      params.set("end", String(data.window.end));
    } else if (preset === "custom" && customBegin && customEnd) {
      try {
        params.set("begin", String(parsePhoenixDateTimeLocal(customBegin)));
        params.set("end", String(parsePhoenixDateTimeLocal(customEnd)));
      } catch {
        // leave unresolved; export will fall back to server resolve
      }
    }
    return `/api/export?${params.toString()}`;
  }, [preset, customBegin, customEnd, data]);

  const filteredFlights = useMemo(() => {
    if (!data) return [];
    const q = query.trim().toLowerCase();
    return data.flights.filter((f) => {
      if (severity !== "all" && f.maxSeverity !== severity) return false;
      if (!q) return true;
      return (
        f.callsign?.toLowerCase().includes(q) ||
        f.icao24.includes(q) ||
        f.registration?.toLowerCase().includes(q) ||
        f.findings.some(
          (x) =>
            x.summary.toLowerCase().includes(q) ||
            x.code.toLowerCase().includes(q)
        )
      );
    });
  }, [data, query, severity]);

  const selectedFlight = useMemo(() => {
    if (!filteredFlights.length) return null;
    return (
      filteredFlights.find((f) => f.id === selectedId) ?? filteredFlights[0]
    );
  }, [filteredFlights, selectedId]);

  const overviewFindings = useMemo(
    () => filteredFlights.flatMap((f) => f.findings),
    [filteredFlights]
  );

  const contextTracks = useMemo(() => {
    if (!selectedFlight) {
      return filteredFlights.map((f) => f.track);
    }
    return filteredFlights
      .filter((f) => f.id !== selectedFlight.id)
      .map((f) => f.track);
  }, [filteredFlights, selectedFlight]);
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
          Flags below are review candidates against Falcon Field (KFFZ)
          noise-abatement guidance. Procedures are voluntary. This is screening only — not a
          regulatory determination, citation, or “violator” list. Wind, ATC, and
          coverage gaps can explain many tracks.
        </p>
        <p className="mt-2 text-xs text-stone-500">
          Not screened from ADS-B: power/RPM/blade slap, Vy, PAPI, hover time, or
          ATC/wind justification.
        </p>
      </aside>

      <section className="space-y-4">
        <TimePresets value={preset} onChange={onPresetChange} />
        {preset === "custom" && (
          <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
            <label className="flex flex-col gap-1 text-sm text-stone-600 flex-1">
              Start (America/Phoenix)
              <input
                type="datetime-local"
                value={customBegin}
                onChange={(e) => setCustomBegin(e.target.value)}
                className="border border-stone-300 bg-white/80 px-3 py-2 text-stone-900"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm text-stone-600 flex-1">
              End (America/Phoenix)
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
              <p className="text-xs uppercase tracking-wide text-stone-500">
                Showing · America/Phoenix
                {data.window.partial ? " · window still open" : ""}
              </p>
              <p className="mt-0.5 text-base sm:text-lg font-medium text-stone-900">
                {data.window.rangeLabel ||
                  `${data.window.label}`}
              </p>
              <p className="text-sm text-stone-600">{data.window.label}</p>
              <p className="mt-2 text-2xl sm:text-3xl font-semibold tracking-tight text-stone-900">
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

          {filteredFlights.length > 0 && (
            <section className="space-y-2 print:break-inside-avoid">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-sm uppercase tracking-wider text-stone-500">
                  Spatial overview
                </h2>
                {selectedFlight && (
                  <p className="text-xs text-stone-500">
                    Highlighted:{" "}
                    <span className="font-medium text-stone-800">
                      {selectedFlight.callsign ||
                        selectedFlight.registration ||
                        selectedFlight.icao24.toUpperCase()}
                    </span>
                    <span className="text-stone-400">
                      {" "}
                      · muted paths = other flags in this list
                    </span>
                  </p>
                )}
              </div>
              <div className="min-h-[280px] h-[360px] sm:h-[420px] border border-stone-200/80 shadow-sm bg-stone-100">
                <FlightMap
                  track={selectedFlight?.track ?? []}
                  findings={overviewFindings}
                  contextTracks={contextTracks}
                  className="h-full w-full"
                />
              </div>
            </section>
          )}

          <FlightList
            flights={data.flights}
            query={query}
            severity={severity}
            selectedId={selectedFlight?.id ?? null}
            onSelect={(f) => setSelectedId(f.id)}
            windowBegin={data.window.begin}
            windowEnd={data.window.end}
          />

          <details className="text-xs text-stone-500 print:block">
            <summary className="cursor-pointer text-stone-600">Data notes</summary>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li>Source: {data.meta.source}</li>
              <li>
                Window: {data.meta.begin}–{data.meta.end} ({data.meta.timezone})
              </li>
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
