"use client";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_AUCTION_DAYS, MAX_AUCTION_MS } from "@/lib/admin-schemas";
import { addDays, formatBaltic, fromBalticInputs, toBalticInputs } from "@/lib/baltic-time";
import { saveSchedule } from "../../actions";
import { ActionMessage, FieldNote, useAdminAction } from "./action-feedback";

function durationLabel(ms: number): string {
  const totalHours = Math.round(ms / 3_600_000);
  const d = Math.floor(totalHours / 24);
  const h = totalHours % 24;
  return [d ? `${d} ${d === 1 ? "day" : "days"}` : "", h ? `${h} ${h === 1 ? "hour" : "hours"}` : ""].filter(Boolean).join(" ") || "under an hour";
}

export function ScheduleForm({ auctionId, startsAt, endsAt }: { auctionId: string; startsAt: string | null; endsAt: string | null }) {
  const s0 = toBalticInputs(startsAt);
  const e0 = toBalticInputs(endsAt);
  const [startDate, setStartDate] = useState(s0.date);
  const [startTime, setStartTime] = useState(s0.time);
  const [endDate, setEndDate] = useState(e0.date);
  const [endTime, setEndTime] = useState(e0.time);
  const { run, pending, result, fieldErrors: fe } = useAdminAction();

  const start = fromBalticInputs(startDate, startTime);
  const end = fromBalticInputs(endDate, endTime);
  const duration = start && end ? Date.parse(end) - Date.parse(start) : null;
  const tooLong = duration !== null && duration > MAX_AUCTION_MS;

  function presetNow() {
    // Next whole minute, so "now" isn't already in the past when saved.
    const startMs = Math.ceil(Date.now() / 60_000) * 60_000;
    const s = toBalticInputs(startMs);
    const e = toBalticInputs(startMs + MAX_AUCTION_MS);
    setStartDate(s.date);
    setStartTime(s.time);
    setEndDate(e.date);
    setEndTime(e.time);
  }

  function presetTomorrow() {
    const today = toBalticInputs(Date.now()).date;
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
        void run(saveSchedule, { auctionId, startDate, startTime, endDate, endTime });
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
          <legend className="mb-1.5 text-sm font-semibold">Start (Eastern European time)</legend>
          <div className="flex flex-wrap gap-2">
            <Input aria-label="Start date" type="date" className="min-w-0 flex-1" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            <Input aria-label="Start time" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-32" />
          </div>
          <FieldNote error={fe.start} />
        </fieldset>
        <fieldset className="min-w-0">
          <legend className="mb-1.5 text-sm font-semibold">End (Eastern European time)</legend>
          <div className="flex flex-wrap gap-2">
            <Input aria-label="End date" type="date" className="min-w-0 flex-1" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            <Input aria-label="End time" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="w-32" />
          </div>
          <FieldNote error={fe.end} />
        </fieldset>
      </div>

      {start && end && duration !== null && duration > 0 ? (
        <p className="text-sm text-mute">
          Runs {durationLabel(duration)}: {formatBaltic(start)} to {formatBaltic(end)}.
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
