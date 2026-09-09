import { fromZonedTime, toZonedTime, formatInTimeZone } from "date-fns-tz";
import { TZ, QUIET_HOURS, STAFF_OFF } from "./constants";

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export function formatPhoenix(unixSec: number, pattern = "yyyy-MM-dd HH:mm"): string {
  return formatInTimeZone(new Date(unixSec * 1000), TZ, pattern);
}

/** Human range for Arizona wall clock, e.g. "Sun Sep 7, 10:00 PM – Mon Sep 8, 5:30 AM MST". */
export function formatPhoenixRange(begin: number, end: number): string {
  const beginDay = formatPhoenix(begin, "yyyy-MM-dd");
  const endDay = formatPhoenix(end, "yyyy-MM-dd");
  const left = formatPhoenix(begin, "EEE MMM d, h:mm a");
  const right =
    beginDay === endDay
      ? formatPhoenix(end, "h:mm a")
      : formatPhoenix(end, "EEE MMM d, h:mm a");
  return `${left} – ${right} MST`;
}

export function phoenixParts(unixSec: number) {
  const z = toZonedTime(new Date(unixSec * 1000), TZ);
  return {
    year: z.getFullYear(),
    month: z.getMonth(),
    day: z.getDate(),
    hour: z.getHours(),
    minute: z.getMinutes(),
    second: z.getSeconds(),
    weekday: z.getDay(), // 0 Sun
  };
}

/** Local Arizona wall-clock → unix seconds. */
export function phoenixLocalToUnix(
  year: number,
  monthIndex: number,
  day: number,
  hour: number,
  minute: number,
  second = 0
): number {
  const local = new Date(year, monthIndex, day, hour, minute, second, 0);
  return Math.floor(fromZonedTime(local, TZ).getTime() / 1000);
}

export function isInQuietHours(unixSec: number): boolean {
  const { hour, minute } = phoenixParts(unixSec);
  const mins = hour * 60 + minute;
  const start = QUIET_HOURS.startHour * 60 + QUIET_HOURS.startMinute;
  const end = QUIET_HOURS.endHour * 60 + QUIET_HOURS.endMinute;
  return mins >= start || mins < end;
}

export function isInStaffOffWindow(unixSec: number): boolean {
  const { hour, minute } = phoenixParts(unixSec);
  const mins = hour * 60 + minute;
  const start = STAFF_OFF.startHour * 60 + STAFF_OFF.startMinute;
  const end = STAFF_OFF.endHour * 60 + STAFF_OFF.endMinute;
  return mins >= start || mins < end;
}

export type PresetId =
  | "last24h"
  | "staff_off"
  | "yesterday_overnight"
  | "last7nights"
  | "quiet_last_night"
  | "custom";

export interface TimeWindow {
  begin: number;
  end: number;
  /** Short chip title, e.g. "Quiet hours — last night" */
  label: string;
  /** Full AZ bounds for the results header */
  rangeLabel: string;
  preset: PresetId;
  /** True when the window is still open and ends at "now" */
  partial: boolean;
}

type OvernightKind = "quiet" | "staff";

function overnightBounds(kind: OvernightKind) {
  return kind === "quiet" ? QUIET_HOURS : STAFF_OFF;
}

/**
 * Most recent overnight window for quiet (22:00–05:30) or staff-off (18:00–05:30).
 * Before tonight's start: always the completed prior night (never a future/empty tonight).
 * After tonight's start (or before morning end): in-progress window ending at now.
 */
function mostRecentOvernightWindow(
  kind: OvernightKind,
  ref = new Date()
): { begin: number; end: number; partial: boolean } {
  const bounds = overnightBounds(kind);
  const z = toZonedTime(ref, TZ);
  let end = phoenixLocalToUnix(
    z.getFullYear(),
    z.getMonth(),
    z.getDate(),
    bounds.endHour,
    bounds.endMinute
  );
  const now = Math.floor(ref.getTime() / 1000);
  if (now < end) {
    // Still inside overnight ending this morning — begin was yesterday at startHour
  } else {
    const startToday = phoenixLocalToUnix(
      z.getFullYear(),
      z.getMonth(),
      z.getDate(),
      bounds.startHour,
      bounds.startMinute
    );
    if (now >= startToday) {
      // Tonight has begun — partial window to now (not a future empty span)
      return { begin: startToday, end: now, partial: true };
    }
    // Daytime: last completed overnight ending this morning
  }

  const endLocal = toZonedTime(new Date(end * 1000), TZ);
  const beginDate = new Date(
    endLocal.getFullYear(),
    endLocal.getMonth(),
    endLocal.getDate() - 1,
    bounds.startHour,
    bounds.startMinute,
    0,
    0
  );
  const begin = Math.floor(fromZonedTime(beginDate, TZ).getTime() / 1000);
  const cappedEnd = Math.min(end, now);
  return { begin, end: cappedEnd, partial: cappedEnd < end };
}

function overnightTitle(
  kind: OvernightKind,
  begin: number,
  end: number,
  partial: boolean
): string {
  const noun = kind === "quiet" ? "Quiet hours" : "Staff off";
  const now = nowUnix();
  const z = toZonedTime(new Date(), TZ);
  const bounds = overnightBounds(kind);
  const startTonight = phoenixLocalToUnix(
    z.getFullYear(),
    z.getMonth(),
    z.getDate(),
    bounds.startHour,
    bounds.startMinute
  );

  if (partial && Math.abs(begin - startTonight) < 120) {
    return `${noun} — tonight so far`;
  }
  if (partial && isInQuietHours(now) && kind === "quiet") {
    return `${noun} — overnight (in progress)`;
  }
  if (partial && isInStaffOffWindow(now) && kind === "staff") {
    return `${noun} — overnight (in progress)`;
  }
  // Completed prior night (typical daytime / early evening click)
  const beginDay = formatPhoenix(begin, "EEE MMM d");
  const endDay = formatPhoenix(end, "EEE MMM d");
  if (beginDay === endDay) {
    return `${noun} — ${beginDay}`;
  }
  return `${noun} — last night`;
}

function overnightChipHint(begin: number, end: number): string {
  // Compact for preset chips: "Sun 10:00 PM – Mon 5:30 AM"
  const beginDay = formatPhoenix(begin, "yyyy-MM-dd");
  const endDay = formatPhoenix(end, "yyyy-MM-dd");
  const left = formatPhoenix(begin, "EEE h:mm a");
  const right =
    beginDay === endDay
      ? formatPhoenix(end, "h:mm a")
      : formatPhoenix(end, "EEE h:mm a");
  return `${left} – ${right}`;
}

/**
 * Parse `<input type="datetime-local">` as America/Phoenix wall clock.
 * Browser local TZ must not shift the intended Mesa/FFZ review window.
 */
export function parsePhoenixDateTimeLocal(value: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    value.trim()
  );
  if (!m) {
    throw new Error(`Invalid Phoenix datetime: ${value}`);
  }
  return phoenixLocalToUnix(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    m[6] ? Number(m[6]) : 0
  );
}

function labelForPinnedWindow(
  preset: PresetId,
  begin: number,
  end: number,
  partial: boolean
): string {
  switch (preset) {
    case "last24h":
      return "Last 24 hours";
    case "last7nights":
      return "Last 7 nights";
    case "yesterday_overnight":
      return "Yesterday overnight";
    case "staff_off":
      return overnightTitle("staff", begin, end, partial);
    case "quiet_last_night":
      return overnightTitle("quiet", begin, end, partial);
    case "custom":
    default:
      return "Custom range";
  }
}

/**
 * When both begin/end are provided, honor them (pinned client/API window).
 * Otherwise compute from "now" for the preset.
 */
export function resolvePreset(
  preset: PresetId,
  customBegin?: number,
  customEnd?: number
): TimeWindow {
  const end = nowUnix();

  // Explicit windows win — same query + timeframe must not drift with server "now".
  if (
    customBegin != null &&
    customEnd != null &&
    Number.isFinite(customBegin) &&
    Number.isFinite(customEnd) &&
    customEnd > customBegin
  ) {
    const partial =
      preset === "last24h" ||
      preset === "last7nights" ||
      (preset !== "custom" &&
        preset !== "yesterday_overnight" &&
        customEnd >= end - 180);
    return {
      begin: customBegin,
      end: customEnd,
      label: labelForPinnedWindow(preset, customBegin, customEnd, partial),
      rangeLabel: formatPhoenixRange(customBegin, customEnd),
      preset: preset === "custom" ? "custom" : preset,
      partial,
    };
  }

  switch (preset) {
    case "last24h": {
      // Bucket end to the minute so rapid refreshes share one window/cache key.
      const bucketedEnd = Math.floor(end / 60) * 60;
      const begin = bucketedEnd - 24 * 3600;
      return {
        begin,
        end: bucketedEnd,
        label: "Last 24 hours",
        rangeLabel: formatPhoenixRange(begin, bucketedEnd),
        preset,
        partial: true,
      };
    }
    case "staff_off": {
      const w = mostRecentOvernightWindow("staff");
      const bucketedEnd = w.partial ? Math.floor(w.end / 60) * 60 : w.end;
      return {
        begin: w.begin,
        end: bucketedEnd,
        label: overnightTitle("staff", w.begin, bucketedEnd, w.partial),
        rangeLabel: formatPhoenixRange(w.begin, bucketedEnd),
        preset,
        partial: w.partial,
      };
    }
    case "quiet_last_night": {
      const w = mostRecentOvernightWindow("quiet");
      const bucketedEnd = w.partial ? Math.floor(w.end / 60) * 60 : w.end;
      return {
        begin: w.begin,
        end: bucketedEnd,
        label: overnightTitle("quiet", w.begin, bucketedEnd, w.partial),
        rangeLabel: formatPhoenixRange(w.begin, bucketedEnd),
        preset,
        partial: w.partial,
      };
    }
    case "yesterday_overnight": {
      const z = toZonedTime(new Date(), TZ);
      // Overnight that ended yesterday morning (prior staff-off window)
      const endY = phoenixLocalToUnix(
        z.getFullYear(),
        z.getMonth(),
        z.getDate() - 1,
        STAFF_OFF.endHour,
        STAFF_OFF.endMinute
      );
      const endLocal = toZonedTime(new Date(endY * 1000), TZ);
      const beginDate = new Date(
        endLocal.getFullYear(),
        endLocal.getMonth(),
        endLocal.getDate() - 1,
        STAFF_OFF.startHour,
        STAFF_OFF.startMinute,
        0,
        0
      );
      const begin = Math.floor(fromZonedTime(beginDate, TZ).getTime() / 1000);
      return {
        begin,
        end: endY,
        label: "Yesterday overnight",
        rangeLabel: formatPhoenixRange(begin, endY),
        preset,
        partial: false,
      };
    }
    case "last7nights": {
      const z = toZonedTime(new Date(), TZ);
      const bucketedEnd = Math.floor(end / 60) * 60;
      const beginDate = new Date(
        z.getFullYear(),
        z.getMonth(),
        z.getDate() - 7,
        STAFF_OFF.startHour,
        STAFF_OFF.startMinute,
        0,
        0
      );
      const begin = Math.floor(fromZonedTime(beginDate, TZ).getTime() / 1000);
      return {
        begin,
        end: bucketedEnd,
        label: "Last 7 nights",
        rangeLabel: formatPhoenixRange(begin, bucketedEnd),
        preset,
        partial: true,
      };
    }
    case "custom":
    default: {
      const b = customBegin ?? end - 24 * 3600;
      const e = customEnd ?? end;
      return {
        begin: b,
        end: e,
        label: "Custom range",
        rangeLabel: formatPhoenixRange(b, e),
        preset: "custom",
        partial: false,
      };
    }
  }
}

/** Live chip copy for the preset bar (client-safe). */
export function presetChipCopy(id: PresetId): { label: string; hint: string } {
  if (id === "custom") {
    return { label: "Custom", hint: "Pick range" };
  }
  if (id === "last24h") {
    return { label: "Last 24h", hint: "Rolling day" };
  }
  if (id === "last7nights") {
    return { label: "Last 7 nights", hint: "Fetch capped to 36h" };
  }
  const w = resolvePreset(id);
  if (id === "quiet_last_night") {
    return {
      label: w.partial ? w.label.replace("Quiet hours — ", "Quiet · ") : "Quiet hours",
      hint: overnightChipHint(w.begin, w.end),
    };
  }
  if (id === "staff_off") {
    return {
      label: w.partial ? w.label.replace("Staff off — ", "Staff · ") : "Staff off",
      hint: overnightChipHint(w.begin, w.end),
    };
  }
  if (id === "yesterday_overnight") {
    return {
      label: "Yesterday overnight",
      hint: overnightChipHint(w.begin, w.end),
    };
  }
  return { label: w.label, hint: overnightChipHint(w.begin, w.end) };
}
