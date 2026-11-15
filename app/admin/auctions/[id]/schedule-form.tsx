"use client";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_AUCTION_DAYS, MAX_AUCTION_MS } from "@/lib/admin-schemas";
import { useTimeZone } from "@/hooks/use-time-zone";
import { addDays, formatDateTime, fromZonedInputs, toZonedInputs, zoneAbbreviation } from "@/lib/zoned-time";
import { saveSchedule } from "../../actions";
import { ActionMessage, FieldNote, useAdminAction } from "./action-feedback";

function durationLabel(ms: number): string {
  const totalHours = Math.round(ms / 3_600_000);
  const d = Math.floor(totalHours / 24);
  const h = totalHours % 24;
  return [d ? `${d} ${d === 1 ? "day" : "days"}` : "", h ? `${h} ${h === 1 ? "hour" : "hours"}` : ""].filter(Boolean).join(" ") || "under an hour";
}

export function ScheduleForm({ auctionId, startsAt, endsAt }: { auctionId: string; startsAt: string | null; endsAt: string | null }) {
  // The admin's own time zone ("UTC" until the page has loaded in the browser).
  const tz = useTimeZone();
  const s0 = toZonedInputs(startsAt, tz);
  const e0 = toZonedInputs(endsAt, tz);
  const [startDate, setStartDate] = useState(s0.date);
  const [startTime, setStartTime] = useState(s0.time);
  const [endDate, setEndDate] = useState(e0.date);
  const [endTime, setEndTime] = useState(e0.time);
  const edited = useRef(false);
  const { run, pending, result, fieldErrors: fe } = useAdminAction();

  // Once the browser's zone is known, show the saved times in it (unless already edited).
  useEffect(() => {
    if (edited.current) return;
    const s = toZonedInputs(startsAt, tz);
    const e = toZonedInputs(endsAt, tz);
    setStartDate(s.date);
    setStartTime(s.time);
    setEndDate(e.date);
    setEndTime(e.time);
  }, [tz, startsAt, endsAt]);

  const edit = (setter: (v: string) => void) => (v: string) => {
    edited.current = true;
    setter(v);
  };
  const zone = `${zoneAbbreviation(tz)}, your time zone`;

  const start = fromZonedInputs(startDate, startTime, tz);
  const end = fromZonedInputs(endDate, endTime, tz);
  const duration = start && end ? Date.parse(end) - Date.parse(start) : null;
  const tooLong = duration !== null && duration > MAX_AUCTION_MS;

  function presetNow() {
    // Next whole minute, so "now" isn't already in the past when saved.
    const startMs = Math.ceil(Date.now() / 60_000) * 60_000;
    edited.current = true;
    const s = toZonedInputs(startMs, tz);
    const e = toZonedInputs(startMs + MAX_AUCTION_MS, tz);
    setStartDate(s.date);
    setStartTime(s.time);
    setEndDate(e.date);
    setEndTime(e.time);
  }

  function presetTomorrow() {
    edited.current = true;
    const today = toZonedInputs(Date.now(), tz).date;
    setStartDate(addDays(today, 1));
    setStartTime("12:00");
    setEndDate(addDays(today, 7));
    setEndTime("20:00");
  }

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run(saveSchedule, { auctionId, startDate, startTime, endDate, endTime, tz });
      }}
    >
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={presetNow}>
          Start now, 7 days
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={presetTomorrow}>
          Start tomorrow 12:00, end in 7 days at 20:00
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-sm font-semibold">Start ({zone})</legend>
          <div className="flex flex-wrap gap-2">
            <Input aria-label="Start date" type="date" className="min-w-0 flex-1" value={startDate} onChange={(e) => edit(setStartDate)(e.target.value)} />
            <Input aria-label="Start time" type="time" value={startTime} onChange={(e) => edit(setStartTime)(e.target.value)} className="w-32" />
          </div>
          <FieldNote error={fe.start} />
        </fieldset>
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-sm font-semibold">End ({zone})</legend>
          <div className="flex flex-wrap gap-2">
            <Input aria-label="End date" type="date" className="min-w-0 flex-1" value={endDate} onChange={(e) => edit(setEndDate)(e.target.value)} />
            <Input aria-label="End time" type="time" value={endTime} onChange={(e) => edit(setEndTime)(e.target.value)} className="w-32" />
          </div>
          <FieldNote error={fe.end} />
        </fieldset>
      </div>

      {start && end && duration !== null && duration > 0 ? (
        <p className="text-sm text-mute">
          Runs {durationLabel(duration)}: {formatDateTime(start, tz)} to {formatDateTime(end, tz)}.
        </p>
      ) : null}

      <p className={tooLong ? "flex gap-2 text-sm text-signal" : "flex gap-2 text-xs text-mute"}>
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
        Card holds expire after about 7 days, so the end must be at most {MAX_AUCTION_DAYS} days after the start.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || tooLong}>
          {pending ? "Saving…" : "Save schedule"}
        </Button>
        <ActionMessage result={result} />
      </div>
    </form>
  );
}
