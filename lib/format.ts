
const eur = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const km = new Intl.NumberFormat("en-IE");

export const formatEur = (n: number): string => eur.format(n);
export const formatKm = (n: number): string => `${km.format(n)} km`;

export { COUNTRY_NAMES } from "./countries";

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "0:00";
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/**
 * Time left in whole minutes, for places that tick once a minute (My listings):
 * "2d 4h" over a day, "5h 12m" under a day, "42m" under an hour. Rounds up, so the last
 * minute reads "1m", never "0m".
 */
export function formatTimeLeft(ms: number): string {
  const { d, h, m } = minuteParts(ms);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

/** The same, spelled out for screen readers: "2 days 4 hours", "5 hours 12 minutes", "42 minutes". */
export function formatTimeLeftSpoken(ms: number): string {
  const { d, h, m } = minuteParts(ms);
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (d > 0) return `${unit(d, "day")} ${unit(h, "hour")}`;
  if (h > 0) return `${unit(h, "hour")} ${unit(m, "minute")}`;
  return unit(m, "minute");
}

function minuteParts(ms: number): { d: number; h: number; m: number } {
  const total = Math.max(1, Math.ceil(ms / 60_000));
  return { d: Math.floor(total / 1440), h: Math.floor((total % 1440) / 60), m: total % 60 };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// Intl formatters are expensive to build; cache one per time zone ("" = the user's own).
const shortDateFmt = new Map<string, Intl.DateTimeFormat>();
const shortDateYearFmt = new Map<string, Intl.DateTimeFormat>();
const yearFmt = new Map<string, Intl.DateTimeFormat>();
const exactFmt = new Map<string, Intl.DateTimeFormat>();

function cached(cache: Map<string, Intl.DateTimeFormat>, timeZone: string | undefined, options: Intl.DateTimeFormatOptions) {
  const key = timeZone ?? "";
  let fmt = cache.get(key);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-GB", { ...options, timeZone });
    cache.set(key, fmt);
  }
  return fmt;
}

/**
 * Relative time in minute steps: "just now", "5m ago", "3h ago", "2d ago",
 * then "12 Nov" (or "12 Nov 2025" outside the current year). Never shows seconds;
 * future times (clock skew) read "just now".
 *
 * `timeZone` only affects the date form. Leave it unset for the user's own zone;
 * pass "UTC" when server and client must render identical text.
 */
export function timeAgo(iso: string, now: number = Date.now(), timeZone?: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const elapsed = Math.max(0, now - then);
  if (elapsed < MINUTE) return "just now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m ago`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h ago`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d ago`;

  const yearOf = cached(yearFmt, timeZone, { year: "numeric" });
  const sameYear = yearOf.format(then) === yearOf.format(now);
  return sameYear
    ? cached(shortDateFmt, timeZone, { day: "numeric", month: "short" }).format(then)
    : cached(shortDateYearFmt, timeZone, { day: "numeric", month: "short", year: "numeric" }).format(then);
}

/** Exact date and 24-hour time with the zone, e.g. "13 Nov 2026, 14:32 CET". Defaults to the user's own time zone. */
export function formatExactTime(iso: string, timeZone?: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  return cached(exactFmt, timeZone, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZoneName: "short",
  }).format(then);
}
