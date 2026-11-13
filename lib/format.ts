import type { Country } from "./types";

const eur = new Intl.NumberFormat("en-IE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const km = new Intl.NumberFormat("en-IE");

export const formatEur = (n: number): string => eur.format(n);
export const formatKm = (n: number): string => `${km.format(n)} km`;

export const COUNTRY_NAMES: Record<Country, string> = { EE: "Estonia", LV: "Latvia", LT: "Lithuania" };

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

/** Exact date and 24-hour time, e.g. "13 Nov 2026, 14:32". Defaults to the user's own time zone. */
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
  }).format(then);
}
