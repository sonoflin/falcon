"use client";

import type { PresetId } from "@/lib/time";

const PRESETS: { id: PresetId; label: string; hint: string }[] = [
  { id: "staff_off", label: "Staff off", hint: "6:00 p.m.–5:30 a.m." },
  { id: "quiet_last_night", label: "Quiet hours", hint: "10:00 p.m.–5:30 a.m." },
  { id: "last24h", label: "Last 24h", hint: "Rolling day" },
  { id: "yesterday_overnight", label: "Yesterday overnight", hint: "Prior staff-off window" },
  { id: "last7nights", label: "Last 7 nights", hint: "Capped to 72h fetch" },
  { id: "custom", label: "Custom", hint: "Pick range" },
];

type Props = {
  value: PresetId;
  onChange: (id: PresetId) => void;
};

export function TimePresets({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Time presets">
      {PRESETS.map((p) => {
        const active = value === p.id;
        return (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(p.id)}
            className={`px-3 py-2 text-left transition-colors border ${
              active
                ? "bg-teal-900 text-amber-50 border-teal-900"
                : "bg-white/70 text-stone-800 border-stone-300 hover:border-teal-800"
            }`}
          >
            <div className="text-sm font-medium leading-tight">{p.label}</div>
            <div className={`text-[11px] ${active ? "text-teal-100" : "text-stone-500"}`}>
              {p.hint}
            </div>
          </button>
        );
      })}
    </div>
  );
}
