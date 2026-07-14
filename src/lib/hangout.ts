export type DateOption = string; // ISO date YYYY-MM-DD
export const ALL_DAY_DURATION = -1;

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

export interface ComputedResult {
  date: DateOption;
  start: number;
  end: number;
  attendees: number;
}

/**
 * Find the best time slot across all responses that fits duration.
 * For each date, intersect availability intervals across attendees and find
 * the largest window ≥ duration that maximises attendee count.
 */
export function computeBestSlot(
  dateOptions: DateOption[],
  duration: number,
  responses: { name: string; availability: Slot[] }[],
  dayStart: number,
  dayEnd: number,
): ComputedResult | null {
  if (responses.length === 0) return null;

  const step = 15;
  let best: ComputedResult | null = null;

  for (const date of dateOptions) {
    // For each 15-min slot, count attendees available for the full duration
    for (let start = dayStart; start + duration <= dayEnd; start += step) {
      const end = start + duration;
      let count = 0;
      for (const resp of responses) {
        const covers = resp.availability.some(
          (a) => a.date === date && a.start <= start && a.end >= end,
        );
        if (covers) count++;
      }
      if (count === 0) continue;
      if (!best || count > best.attendees) {
        best = { date, start, end, attendees: count };
      }
    }
  }
  return best;
}
