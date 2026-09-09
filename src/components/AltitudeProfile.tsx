"use client";

import type { TrackPoint } from "@/lib/types";
import { formatPhoenix } from "@/lib/time";

type Props = {
  track: TrackPoint[];
  patternAltFt?: number;
};

export function AltitudeProfile({ track, patternAltFt = 2400 }: Props) {
  const points = track.filter((p) => p.altFt != null && !p.onGround);
  if (points.length < 2) {
    return (
      <p className="text-sm text-stone-500 px-1">No airborne altitude samples.</p>
    );
  }

  const alts = points.map((p) => p.altFt!);
  const minAlt = Math.min(...alts, patternAltFt) - 200;
  const maxAlt = Math.max(...alts, patternAltFt) + 200;
  const t0 = points[0].time;
  const t1 = points[points.length - 1].time;
  const w = 640;
  const h = 160;
  const pad = 12;

  const x = (t: number) =>
    pad + ((t - t0) / Math.max(t1 - t0, 1)) * (w - pad * 2);
  const y = (alt: number) =>
    h - pad - ((alt - minAlt) / Math.max(maxAlt - minAlt, 1)) * (h - pad * 2);

  const d = points
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.time).toFixed(1)},${y(p.altFt!).toFixed(1)}`)
    .join(" ");

  const patternY = y(patternAltFt);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-40" role="img" aria-label="Altitude profile">
        <line
          x1={pad}
          x2={w - pad}
          y1={patternY}
          y2={patternY}
          stroke="#b45309"
          strokeDasharray="4 4"
          strokeWidth="1.5"
        />
        <text x={pad + 4} y={patternY - 4} fill="#92400e" fontSize="10">
          Pattern {patternAltFt.toLocaleString()} ft
        </text>
        <path d={d} fill="none" stroke="#0f766e" strokeWidth="2.5" />
      </svg>
      <div className="flex justify-between text-[11px] text-stone-500 px-1">
        <span>{formatPhoenix(t0)}</span>
        <span>Altitude MSL (ft)</span>
        <span>{formatPhoenix(t1)}</span>
      </div>
    </div>
  );
}
