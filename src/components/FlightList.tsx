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
};

export function FlightList({ flights, query = "", severity = "all" }: Props) {
  const q = query.trim().toLowerCase();
  const filtered = flights.filter((f) => {
    if (severity !== "all" && f.maxSeverity !== severity) return false;
    if (!q) return true;
    return (
      f.callsign?.toLowerCase().includes(q) ||
      f.icao24.includes(q) ||
      f.registration?.toLowerCase().includes(q) ||
      f.findings.some((x) => x.summary.toLowerCase().includes(q))
    );
  });

  if (!filtered.length) {
    return (
      <div className="py-16 text-center text-stone-600">
        <p className="text-lg text-stone-800">No flagged flights in this window</p>
        <p className="mt-2 text-sm max-w-md mx-auto">
          Either operations screened clean, coverage was thin, or try a wider preset.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-stone-200/80 border-t border-stone-200">
      {filtered.map((f) => (
        <li key={f.id}>
          <Link
            href={`/flights/${encodeURIComponent(f.id)}?callsign=${encodeURIComponent(f.callsign || "")}`}
            className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 py-4 px-1 hover:bg-amber-50/60 transition-colors"
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
                {f.findings[0]?.summary}
                {f.findings.length > 1 ? ` · +${f.findings.length - 1} more` : ""}
              </p>
            </div>
            <div className="text-xs text-stone-500 sm:text-right shrink-0 sm:w-40">
              <div>{formatPhoenix(f.firstSeen)}</div>
              <div className="text-stone-400">→ {formatPhoenix(f.lastSeen)}</div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
