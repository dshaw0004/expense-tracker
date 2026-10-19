// Date and time utilities.
// Dates without time (expense date, period boundaries): ISO 8601 YYYY-MM-DD in local time.
// Timestamps: ISO 8601 with offset, e.g. 2026-10-19T14:30:00+05:30.
// Never store UTC-only timestamps for date-semantic fields.

export type IsoDate = string; // YYYY-MM-DD

export const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// True if a Gregorian year is a leap year.
export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

// Days in a given month (1-12), accounting for leap years.
export function daysInMonth(year: number, month1to12: number): number {
  if (month1to12 === 2) return isLeapYear(year) ? 29 : 28;
  return DAYS_IN_MONTH[month1to12 - 1];
}

// Clamp a cycle day (1-31) to the last day of the target month if the chosen
// day does not exist. The cycle returns to the configured day next month.
export function clampCycleDay(year: number, month1to12: number, cycleDay: number): number {
  const max = daysInMonth(year, month1to12);
  return Math.min(Math.max(1, cycleDay), max);
}

// Convert a Date to local YYYY-MM-DD (no timezone shift).
export function toIsoDate(d: Date): IsoDate {
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  return `${y}-${m.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

// Parse YYYY-MM-DD into a local Date at midnight.
export function fromIsoDate(iso: IsoDate): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

// Today, as local YYYY-MM-DD.
export function todayIso(): IsoDate {
  return toIsoDate(new Date());
}

// Add `days` to an ISO date, returning a new ISO date.
export function addDays(iso: IsoDate, days: number): IsoDate {
  const d = fromIsoDate(iso);
  d.setDate(d.getDate() + days);
  return toIsoDate(d);
}

// Whole-day difference: a - b (so addDays(b, diff(a,b)) === a).
export function dayDiff(a: IsoDate, b: IsoDate): number {
  const da = fromIsoDate(a);
  const db = fromIsoDate(b);
  return Math.round((da.getTime() - db.getTime()) / 86400000);
}

// Compare two ISO dates lexicographically — works for YYYY-MM-DD.
export function isoCompare(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// True if `target` is in [start, end] inclusive.
export function isoInRange(target: IsoDate, start: IsoDate, end: IsoDate): boolean {
  return isoCompare(target, start) >= 0 && isoCompare(target, end) <= 0;
}

// Compute the latest period start date that is <= today, given a cycle day.
// Walk back month-by-month from today, clamping the cycle day for short months.
export function latestPeriodStart(today: IsoDate, cycleDay: number): IsoDate {
  const d = fromIsoDate(today);
  let year = d.getFullYear();
  let month = d.getMonth() + 1;
  const day = d.getDate();

  // If today's day >= clamped cycle day, this month's cycle is the latest.
  const clamped = clampCycleDay(year, month, cycleDay);
  if (day >= clamped) {
    return `${year}-${month.toString().padStart(2, "0")}-${clamped.toString().padStart(2, "0")}`;
  }
  // Otherwise the latest start was in the previous month.
  if (month === 1) {
    year -= 1;
    month = 12;
  } else {
    month -= 1;
  }
  const clampedPrev = clampCycleDay(year, month, cycleDay);
  return `${year}-${month.toString().padStart(2, "0")}-${clampedPrev.toString().padStart(2, "0")}`;
}

// Compute the next period start date after a given start, following the cycle day.
export function nextPeriodStart(currentStart: IsoDate, cycleDay: number): IsoDate {
  const d = fromIsoDate(currentStart);
  // Move to first day of next month, then apply cycle day.
  let year = d.getFullYear();
  let month = d.getMonth() + 1 + 1; // next month
  if (month > 12) {
    year += 1;
    month = 1;
  }
  const clamped = clampCycleDay(year, month, cycleDay);
  return `${year}-${month.toString().padStart(2, "0")}-${clamped.toString().padStart(2, "0")}`;
}

// Previous period start before a given start.
export function previousPeriodStart(currentStart: IsoDate, cycleDay: number): IsoDate {
  const d = fromIsoDate(currentStart);
  let year = d.getFullYear();
  let month = d.getMonth() + 1 - 1;
  if (month < 1) {
    year -= 1;
    month = 12;
  }
  const clamped = clampCycleDay(year, month, cycleDay);
  return `${year}-${month.toString().padStart(2, "0")}-${clamped.toString().padStart(2, "0")}`;
}

// Real day count of a period, given [start, end] inclusive (YYYY-MM-DD).
export function periodLengthDays(start: IsoDate, end: IsoDate): number {
  return dayDiff(end, start) + 1;
}

// Days remaining in a period including today (clamped to >=0).
export function daysLeftInPeriod(start: IsoDate, end: IsoDate, today: IsoDate): number {
  const left = dayDiff(end, today) + 1;
  return Math.max(0, left);
}

// Format an ISO date for display: "19 Oct 2026".
export function formatDisplayDate(iso: IsoDate): string {
  const d = fromIsoDate(iso);
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// Format with full month name: "19 October 2026".
export function formatDisplayDateLong(iso: IsoDate): string {
  const d = fromIsoDate(iso);
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

// Current timestamp in ISO 8601 with local offset.
export function nowTimestamp(): string {
  const d = new Date();
  const tzOffset = -d.getTimezoneOffset();
  const offsetSign = tzOffset >= 0 ? "+" : "-";
  const offsetHours = Math.abs(Math.floor(tzOffset / 60)).toString().padStart(2, "0");
  const offsetMins = Math.abs(tzOffset % 60).toString().padStart(2, "0");
  const iso = d.toISOString().replace(/\.\d{3}Z$/, "");
  return `${iso}${offsetSign}${offsetHours}:${offsetMins}`;
}

// Generate a UUID v4. Uses crypto.randomUUID when available, falls back to manual.
export function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
