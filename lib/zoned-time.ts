// Dates and times in a given IANA time zone (DECISIONS.md, point 7). Absolute
// times are shown in the viewer's own zone with its abbreviation, e.g.
// "Fri, 13 Nov 2026, 20:00 CET"; admin date/time inputs use the admin's own zone;
// storage stays UTC. Pure functions, safe on the server and in the browser.

const partsCache = new Map<string, Intl.DateTimeFormat>();
const displayCache = new Map<string, Intl.DateTimeFormat>();
const dateCache = new Map<string, Intl.DateTimeFormat>();
const zoneCache = new Map<string, Intl.DateTimeFormat>();

/** True for a time zone the runtime knows, e.g. "Europe/Paris" or "UTC". */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== "string" || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function fmt(cache: Map<string, Intl.DateTimeFormat>, tz: string, options: Intl.DateTimeFormatOptions) {
  let f = cache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { ...options, timeZone: tz });
    cache.set(tz, f);
  }
  return f;
}

function parts(ms: number, tz: string) {
  const f = fmt(partsCache, tz, {
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const p: Record<string, number> = {};
  for (const { type, value } of f.formatToParts(ms)) if (type !== "literal") p[type] = Number(value);
  return { y: p.year ?? 0, mo: p.month ?? 1, d: p.day ?? 1, h: p.hour ?? 0, mi: p.minute ?? 0, s: p.second ?? 0 };
}

/** Offset of `tz` from UTC at instant `ms`, in ms. */
function offsetAt(ms: number, tz: string): number {
  const p = parts(ms, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** UTC instant -> { date: "YYYY-MM-DD", time: "HH:MM" } in `tz`, for <input type="date|time">. */
export function toZonedInputs(iso: string | number | null | undefined, tz: string): { date: string; time: string } {
  if (iso === null || iso === undefined || iso === "") return { date: "", time: "" };
  const ms = typeof iso === "number" ? iso : new Date(iso).getTime();
  if (Number.isNaN(ms)) return { date: "", time: "" };
  const p = parts(ms, tz);
  return { date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

/** Wall-clock date + time in `tz` -> UTC ISO string, or null if the input is not a valid date/time. */
export function fromZonedInputs(date: string, time: string, tz: string): string | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm || !isValidTimeZone(tz)) return null;
  const [y, mo, d, h, mi] = [dm[1], dm[2], dm[3], tm[1], tm[2]].map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes settle the offset across DST changes.
  let utc = wall - offsetAt(wall, tz);
  utc = wall - offsetAt(utc, tz);
  const check = parts(utc, tz);
  if (check.d !== d || check.mo !== mo) return null; // e.g. 31 February
  return new Date(utc).toISOString();
}

/** Adds whole days to a "YYYY-MM-DD" string. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** "Fri, 13 Nov 2026, 20:00 CET" in `tz`. */
export function formatDateTime(iso: string | null | undefined, tz: string): string {
  if (!iso) return "Not set";
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return "Not set";
  return fmt(displayCache, tz, {
    weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    timeZoneName: "short",
  }).format(ms);
}

/** "13 November 2026" in `tz` (no time, so no zone abbreviation). */
export function formatDate(iso: string | null | undefined, tz: string): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime();
  if (Number.isNaN(ms)) return "";
  return fmt(dateCache, tz, { day: "numeric", month: "long", year: "numeric" }).format(ms);
}

/** The zone's abbreviation right now, e.g. "CET" or "GMT+2", for labelling inputs. */
export function zoneAbbreviation(tz: string, at: number = Date.now()): string {
  const name = fmt(zoneCache, tz, { timeZoneName: "short" }).formatToParts(at).find((p) => p.type === "timeZoneName");
  return name?.value ?? tz;
}
