import type { AnalyzedFlight, Severity } from "@/lib/types";
import { formatPhoenix } from "@/lib/time";
import Link from "next/link";

function severityClass(s: Severity | null) {
  if (s === "high") return "bg-red-800 text-red-50";
  if (s === "medium") return "bg-orange-800 text-orange-50";
  return "bg-amber-800 text-amber-50";
}

type Props = {
  flights: AnalyzedFlight[];
  query?: string;
  severity?: Severity | "all";
  selectedId?: string | null;
  onSelect?: (flight: AnalyzedFlight) => void;
  /** Report window — passed through to detail so track filtering matches the list. */
  windowBegin?: number;
  windowEnd?: number;
};

export function FlightList({
  flights,
  query = "",
  severity = "all",
  selectedId = null,
  onSelect,
  windowBegin,
  windowEnd,
}: Props) {
  const q = query.trim().toLowerCase();
  const filtered = flights.filter((f) => {
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

  if (!filtered.length) {
    return (
      <div className="py-16 text-center text-stone-600">
        <p className="text-lg text-stone-800">No screening flags in this window</p>
        <p className="mt-2 text-sm max-w-md mx-auto">
          Either operations screened clean, coverage was thin, or try a wider preset.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-stone-200/80 border-t border-stone-200" role="listbox" aria-label="Flagged operations">
      {filtered.map((f) => {
        const selected = selectedId === f.id;
        return (
          <li key={f.id} role="option" aria-selected={selected}>
            <div
              className={`flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-4 px-1 transition-colors ${
                selected ? "bg-teal-950/[0.06]" : "hover:bg-amber-50/60"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect?.(f)}
                className="flex flex-1 flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 text-left min-w-0"
              >
                <div className="sm:w-28 shrink-0">
                  <span
                    className={`inline-block text-[11px] uppercase tracking-wide px-2 py-1 ${severityClass(f.maxSeverity)}`}
                  >
                    {f.maxSeverity}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-semibold text-stone-900 text-lg tracking-tight">
                      {f.callsign || f.registration || f.icao24.toUpperCase()}
                    </span>
                    <span className="text-xs text-stone-500 font-mono">
                      {f.icao24.toUpperCase()}
                      {f.aircraftType ? ` · ${f.aircraftType}` : ""}
                      {f.category !== "unknown" ? ` · ${f.category}` : ""}
                    </span>
                  </div>
                  <p className="text-sm text-stone-700 mt-1 truncate">
                    <span className="font-mono text-[11px] text-stone-500 mr-2">
                      {f.findings[0]?.code}
                    </span>
                    {f.findings[0]?.summary}
                    {f.findings.length > 1 ? ` · +${f.findings.length - 1} more` : ""}
                  </p>
                </div>
                <div className="text-xs text-stone-500 sm:text-right shrink-0 sm:w-40">
                  <div>{formatPhoenix(f.firstSeen)}</div>
                  <div className="text-stone-400">→ {formatPhoenix(f.lastSeen)}</div>
                </div>
              </button>
              <Link
                href={(() => {
                  const params = new URLSearchParams();
                  if (f.callsign) params.set("callsign", f.callsign);
                  if (windowBegin != null) params.set("begin", String(windowBegin));
                  if (windowEnd != null) params.set("end", String(windowEnd));
                  const qs = params.toString();
                  return `/flights/${encodeURIComponent(f.id)}${qs ? `?${qs}` : ""}`;
                })()}
                className="text-xs text-teal-900 hover:underline shrink-0 sm:w-24 sm:text-right px-1 py-1"
                onClick={(e) => e.stopPropagation()}
              >
                Full evidence →
              </Link>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
