"use client";
import { useId } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useTimeZone } from "@/hooks/use-time-zone";
import { VIEWING_MAX_SLOTS } from "@/lib/messages";
import { fromZonedInputs, zoneAbbreviation } from "@/lib/zoned-time";

export interface Slot {
  date: string;
  time: string;
}

export const EMPTY_SLOT: Slot = { date: "", time: "" };

/**
 * Turns the filled-in times into UTC ISO strings in the viewer's time zone. Returns an
 * error message instead when a time is half filled in, invalid or not in the future.
 */
export function slotsToIso(slots: Slot[], tz: string, now = Date.now()): { iso: string[] } | { error: string } {
  const iso: string[] = [];
  for (const [i, s] of slots.entries()) {
    if (!s.date && !s.time) continue;
    if (!s.date || !s.time) return { error: `Time ${i + 1}: fill in both the day and the time.` };
    const at = fromZonedInputs(s.date, s.time, tz);
    if (!at) return { error: `Time ${i + 1} isn't a valid date and time.` };
    if (Date.parse(at) <= now) return { error: `Time ${i + 1} is in the past. Choose a time in the next 90 days.` };
    if (Date.parse(at) > now + 90 * 86_400_000) return { error: `Time ${i + 1} is too far ahead. Choose a time in the next 90 days.` };
    iso.push(at);
  }
  return { iso };
}

/**
 * Up to 3 proposed times, each a day and a time in the viewer's own time zone (named
 * under the legend, DECISIONS.md point 7). Plain date and time inputs: they work with the
 * keyboard and every phone's own picker.
 */
export function SlotFields({
  slots,
  onChange,
  legend = "Suggested times",
  describedBy,
}: {
  slots: Slot[];
  onChange: (slots: Slot[]) => void;
  legend?: string;
  describedBy?: string;
}) {
  const tz = useTimeZone();
  const id = useId();
  const set = (i: number, patch: Partial<Slot>) => onChange(slots.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <fieldset className="space-y-3" aria-describedby={describedBy}>
      <legend className="text-sm font-semibold">{legend}</legend>
      <p className="text-xs text-mute">Times are in your time zone ({zoneAbbreviation(tz)}). Up to {VIEWING_MAX_SLOTS}.</p>
      {slots.map((s, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <div className="min-w-[9.5rem] flex-1">
            <label htmlFor={`${id}-d${i}`} className="mb-1 block text-xs text-mute">
              Time {i + 1}: day
            </label>
            <Input id={`${id}-d${i}`} type="date" value={s.date} onChange={(e) => set(i, { date: e.target.value })} className="h-11" />
          </div>
          <div className="w-[7.5rem]">
            <label htmlFor={`${id}-t${i}`} className="mb-1 block text-xs text-mute">
              Time {i + 1}: time
            </label>
            <Input id={`${id}-t${i}`} type="time" value={s.time} onChange={(e) => set(i, { time: e.target.value })} className="h-11" />
          </div>
          {slots.length > 1 ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label={`Remove time ${i + 1}`}
              onClick={() => onChange(slots.filter((_, j) => j !== i))}
            >
              <X aria-hidden />
            </Button>
          ) : null}
        </div>
      ))}
      {slots.length < VIEWING_MAX_SLOTS ? (
        <Button type="button" variant="outline" size="sm" className="min-h-11" onClick={() => onChange([...slots, EMPTY_SLOT])}>
          <Plus aria-hidden />
          Add another time
        </Button>
      ) : null}
    </fieldset>
  );
}
