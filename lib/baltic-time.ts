// Converts between UTC instants and wall-clock date/time in Europe/Tallinn, i.e.
// Eastern European time (Helsinki, Riga and Vilnius follow the same rules). Pure functions,
// safe on the server and in the browser.

export const BALTIC_TZ = "Europe/Tallinn";

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: BALTIC_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function parts(ms: number) {
  const p: Record<string, number> = {};
  for (const { type, value } of partsFmt.formatToParts(ms)) if (type !== "literal") p[type] = Number(value);
  return { y: p.year ?? 0, mo: p.month ?? 1, d: p.day ?? 1, h: p.hour ?? 0, mi: p.minute ?? 0, s: p.second ?? 0 };
}

/** Offset of Baltic time from UTC at instant `ms`, in ms (e.g. +2h in winter, +3h in summer). */
function offsetAt(ms: number): number {
  const p = parts(ms);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** UTC instant -> { date: "YYYY-MM-DD", time: "HH:MM" } in Baltic time, for <input type="date|time">. */
export function toBalticInputs(iso: string | number | null | undefined): { date: string; time: string } {
  if (iso === null || iso === undefined || iso === "") return { date: "", time: "" };
  const ms = typeof iso === "number" ? iso : new Date(iso).getTime();
  if (Number.isNaN(ms)) return { date: "", time: "" };
  const p = parts(ms);
  return { date: `${p.y}-${pad(p.mo)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

/** Baltic wall-clock date + time -> UTC ISO string, or null if the input is not a valid date/time. */
export function fromBalticInputs(date: string, time: string): string | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return null;
  const [y, mo, d, h, mi] = [dm[1], dm[2], dm[3], tm[1], tm[2]].map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes settle the offset across DST changes.
  let utc = wall - offsetAt(wall);
  utc = wall - offsetAt(utc);
  const check = parts(utc);
  if (check.d !== d || check.mo !== mo) return null; // e.g. 31 February
  return new Date(utc).toISOString();
}

/** Adds whole days to a "YYYY-MM-DD" string. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

const displayFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: BALTIC_TZ,
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "Fri, 13 Nov 2026, 14:32" in Baltic time. */
export function formatBaltic(iso: string | null | undefined): string {
  if (!iso) return "Not set";
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? "Not set" : displayFmt.format(ms);
}
