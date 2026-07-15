export type DateOption = string; // ISO date YYYY-MM-DD
export const ALL_DAY_DURATION = -1;

/** Bounds for the availability slider - 6:30 AM to 11:00 PM, matching a realistic day. */
export const DAY_SLIDER_MIN = 6 * 60 + 30;
export const DAY_SLIDER_MAX = 23 * 60;

export const AVAILABILITY_SHORTCUTS = {
  "All day": { start: DAY_SLIDER_MIN, end: DAY_SLIDER_MAX },
  Morning: { start: 6 * 60 + 30, end: 12 * 60 },
  Afternoon: { start: 12 * 60, end: 17 * 60 },
  Evening: { start: 17 * 60, end: DAY_SLIDER_MAX },
} as const;

export const DURATION_PRESETS = [30, 60, 120, 180, 240];

export interface Slot {
  date: DateOption;
  start: number; // minute of day
  end: number; // minute of day (exclusive)
}

export function generateCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}

export function generateToken(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function minutesToLabel(m: number): string {
  const h = Math.floor(m / 60);
  const mm = m % 60;
  const period = h >= 12 ? "PM" : "AM";
  const h12 = ((h + 11) % 12) + 1;
  return `${h12}:${mm.toString().padStart(2, "0")} ${period}`;
}

/** Convert a "HH:MM" string (as produced by <input type="time">) to minutes since midnight. */
export function timeStringToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 24 || m < 0 || m >= 60) {
    return null;
  }
  const total = h * 60 + m;
  return total > 1440 ? null : total;
}

/** Convert minutes since midnight back to a "HH:MM" string for <input type="time">. */
export function minutesToTimeString(minutes: number): string {
  const clamped = Math.max(0, Math.min(1440, minutes));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;
}

export function durationToLabel(duration: number): string {
  if (duration === ALL_DAY_DURATION) return "All day";
  if (duration < 60) return `${duration}m`;
  const hours = duration / 60;
  return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** Merge overlapping or touching intervals (e.g. so one person's own windows aren't double-counted). */
function mergeIntervals(
  windows: { start: number; end: number }[],
): { start: number; end: number }[] {
  const sorted = [...windows].sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const w of sorted) {
    const last = merged[merged.length - 1];
    if (last && w.start <= last.end) {
      last.end = Math.max(last.end, w.end);
    } else {
      merged.push({ ...w });
    }
  }
  return merged;
}

export interface ComputedResult {
  date: DateOption;
  start: number;
  end: number;
  attendees: number;
}

/**
 * Find the time window with the most overlapping attendees, across every date
 * anyone has offered availability for. Attendees can each submit any number of
 * arbitrary start/end windows (not restricted to a fixed grid or day bounds).
 * When minDuration is provided, windows that meet it are preferred over
 * shorter ones with the same attendee count.
 */
export function computeBestSlot(
  responses: { name: string; availability: Slot[] }[],
  minDuration = 0,
): ComputedResult | null {
  const withAvailability = responses.filter((r) => r.availability.length > 0);
  if (withAvailability.length === 0) return null;

  const dates = Array.from(
    new Set(withAvailability.flatMap((r) => r.availability.map((s) => s.date))),
  ).sort((a, b) => a.localeCompare(b));

  let best: ComputedResult | null = null;
  let bestMeetsDuration = false;

  for (const date of dates) {
    const perPersonWindows = withAvailability
      .map((r) => mergeIntervals(r.availability.filter((s) => s.date === date)))
      .filter((w) => w.length > 0);
    if (perPersonWindows.length === 0) continue;

    const points: { t: number; delta: number }[] = [];
    for (const windows of perPersonWindows) {
      for (const w of windows) {
        points.push({ t: w.start, delta: 1 });
        points.push({ t: w.end, delta: -1 });
      }
    }
    points.sort((a, b) => a.t - b.t || a.delta - b.delta);

    let count = 0;
    for (let i = 0; i < points.length; i++) {
      count += points[i].delta;
      const t = points[i].t;
      const next = points[i + 1]?.t;
      if (next === undefined || next <= t || count <= 0) continue;

      const meetsDuration = next - t >= minDuration;
      const better =
        !best ||
        (meetsDuration && !bestMeetsDuration) ||
        (meetsDuration === bestMeetsDuration &&
          (count > best.attendees ||
            (count === best.attendees && next - t > best.end - best.start)));

      if (better) {
        best = { date, start: t, end: next, attendees: count };
        bestMeetsDuration = meetsDuration;
      }
    }
  }

  return best;
}
