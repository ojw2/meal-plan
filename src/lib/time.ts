/** True if `tz` is an IANA timezone this runtime knows. */
export function isValidTimezone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Local calendar date (YYYY-MM-DD) in `tz` at instant `now`. */
export function localDate(tz: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

// Calendar-date math on YYYY-MM-DD strings. Dates are plain local dates, so
// we do the arithmetic in UTC where no DST shift can move a day.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function toUtc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

/** True for a real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value) && toUtc(value).toISOString().slice(0, 10) === value;
}

export function addDays(date: string, days: number): string {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOf(date: string): number {
  return toUtc(date).getUTCDay();
}

/** First day of the planning week containing `date`. */
export function weekStartOf(date: string, weekStartDay: number): string {
  return addDays(date, -((weekdayOf(date) - weekStartDay + 7) % 7));
}

export function weekDates(weekStart: string): string[] {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

/** A week is past once its last day is before today (SPEC §4.9). */
export function isPastWeek(weekStart: string, today: string): boolean {
  return addDays(weekStart, 6) < today;
}

/** Formats a YYYY-MM-DD date for display, e.g. { weekday: "long" } → "Monday". */
export function formatDate(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-US", { ...options, timeZone: "UTC" }).format(toUtc(date));
}

/** "Oct 11 – 17", or "Oct 25 – Nov 1" across months. */
export function weekLabel(start: string) {
  const end = addDays(start, 6);
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  return `${formatDate(start, { month: "short", day: "numeric" })} – ${formatDate(
    end,
    sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" },
  )}`;
}
