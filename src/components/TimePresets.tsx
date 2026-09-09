"use client";

import { presetChipCopy, type PresetId } from "@/lib/time";

const PRESET_IDS: PresetId[] = [
  "staff_off",
  "quiet_last_night",
  "last24h",
  "yesterday_overnight",
  "last7nights",
  "custom",
];

type Props = {
  value: PresetId;
  onChange: (id: PresetId) => void;
};

export function TimePresets({ value, onChange }: Props) {
  return (
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Time presets">
      {PRESET_IDS.map((id) => {
        const p = presetChipCopy(id);
        const active = value === id;
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(id)}
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
