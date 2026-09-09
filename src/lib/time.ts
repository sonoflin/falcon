import { fromZonedTime, toZonedTime, formatInTimeZone } from "date-fns-tz";
import { TZ, QUIET_HOURS, STAFF_OFF } from "./constants";

export function nowUnix(): number {
  return Math.floor(Date.now() / 1000);
}

export function formatPhoenix(unixSec: number, pattern = "yyyy-MM-dd HH:mm"): string {
  return formatInTimeZone(new Date(unixSec * 1000), TZ, pattern);
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
  label: string;
  preset: PresetId;
}

function mostRecentStaffOffEnd(ref = new Date()): { begin: number; end: number } {
  const z = toZonedTime(ref, TZ);
  let end = phoenixLocalToUnix(
    z.getFullYear(),
    z.getMonth(),
    z.getDate(),
    STAFF_OFF.endHour,
    STAFF_OFF.endMinute
  );
  // If we're before 5:30am, the overnight window ends today; begin was yesterday 6pm.
  // If we're after 5:30am, still use last completed overnight ending today 5:30am —
  // unless it's still before today's 6pm and we want "current/ongoing"? For preset
  // "overnight/staff-off", use the most recent completed or in-progress window.
  const now = Math.floor(ref.getTime() / 1000);
  if (now < end) {
    // Currently inside overnight ending today — begin yesterday 18:00
  } else {
    // After 5:30am: if before 18:00, last window ended today; if after 18:00, window window started today
    const startToday = phoenixLocalToUnix(
      z.getFullYear(),
      z.getMonth(),
      z.getDate(),
      STAFF_OFF.startHour,
      STAFF_OFF.startMinute
    );
    if (now >= startToday) {
      // In progress overnight starting today
      return { begin: startToday, end: now };
    }
    // Between 5:30 and 18:00 — last completed overnight
  }

  // begin = previous calendar day 18:00 relative to `end`'s local date
  const endLocal = toZonedTime(new Date(end * 1000), TZ);
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
  return { begin, end: Math.min(end, now) };
}

function yesterdayQuietWindow(ref = new Date()): { begin: number; end: number } {
  const z = toZonedTime(ref, TZ);
  // Prefer last completed quiet window (22:00 → 05:30)
  let end = phoenixLocalToUnix(
    z.getFullYear(),
    z.getMonth(),
    z.getDate(),
    QUIET_HOURS.endHour,
    QUIET_HOURS.endMinute
  );
  const now = Math.floor(ref.getTime() / 1000);
  if (now < end) {
    // still in quiet hours ending today — start was yesterday 22:00
  } else {
    const startToday = phoenixLocalToUnix(
      z.getFullYear(),
      z.getMonth(),
      z.getDate(),
      QUIET_HOURS.startHour,
      QUIET_HOURS.startMinute
    );
    if (now >= startToday) {
      return { begin: startToday, end: now };
    }
  }
  const endLocal = toZonedTime(new Date(end * 1000), TZ);
  const beginDate = new Date(
    endLocal.getFullYear(),
    endLocal.getMonth(),
    endLocal.getDate() - 1,
    QUIET_HOURS.startHour,
    QUIET_HOURS.startMinute,
    0,
    0
  );
  const begin = Math.floor(fromZonedTime(beginDate, TZ).getTime() / 1000);
  return { begin, end: Math.min(end, now) };
}

export function resolvePreset(preset: PresetId, customBegin?: number, customEnd?: number): TimeWindow {
  const end = nowUnix();
  switch (preset) {
    case "last24h":
      return { begin: end - 24 * 3600, end, label: "Last 24 hours", preset };
    case "staff_off": {
      const w = mostRecentStaffOffEnd();
      return {
        begin: w.begin,
        end: w.end,
        label: "Staff off (6:00 p.m.–5:30 a.m.)",
        preset,
      };
    }
    case "quiet_last_night": {
      const w = yesterdayQuietWindow();
      return {
        begin: w.begin,
        end: w.end,
        label: "Quiet hours (10:00 p.m.–5:30 a.m.)",
        preset,
      };
    }
    case "yesterday_overnight": {
      const z = toZonedTime(new Date(), TZ);
      // Overnight that ended yesterday morning? Or "yesterday's overnight" = night before last morning?
      // Interpret as: the overnight window for the previous calendar night (ended yesterday 5:30am)
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
      return { begin, end: endY, label: "Yesterday overnight", preset };
    }
    case "last7nights": {
      // Aggregate span covering last 7 staff-off windows (approx 7*11.5h but as continuous range from 7 nights ago 18:00)
      const z = toZonedTime(new Date(), TZ);
      const beginDate = new Date(
        z.getFullYear(),
        z.getMonth(),
        z.getDate() - 7,
        STAFF_OFF.startHour,
        STAFF_OFF.startMinute,
        0,
        0
      );
      return {
        begin: Math.floor(fromZonedTime(beginDate, TZ).getTime() / 1000),
        end,
        label: "Last 7 nights",
        preset,
      };
    }
    case "custom":
    default: {
      const b = customBegin ?? end - 24 * 3600;
      const e = customEnd ?? end;
      return { begin: b, end: e, label: "Custom range", preset: "custom" };
    }
  }
}
