"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Clock, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { MAX_AUCTION_MS } from "@/lib/admin-schemas";
import { useTimeZone } from "@/hooks/use-time-zone";
import { formatDateTime, fromZonedInputs, toZonedInputs, zoneAbbreviation } from "@/lib/zoned-time";
import { formatEur } from "@/lib/format";
import type { AuctionStatus } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  approveAuction,
  extendAuction,
  moveBackToReview,
  rejectAuction,
  withdrawAuction,
} from "../../actions";
import { ActionMessage, useAdminAction } from "./action-feedback";
import { ConfirmButton } from "./confirm-button";

export interface ApprovalCheck {
  label: string;
  done: boolean;
}

export function StatusActions({
  auctionId,
  status,
  startsAt,
  endsAt,
  checks,
  bidCount,
  currentBid,
  holdCount,
  rejectionReason,
  waitingForSeller = null,
}: {
  auctionId: string;
  status: AuctionStatus;
  startsAt: string | null;
  endsAt: string | null;
  checks: ApprovalCheck[];
  bidCount: number;
  currentBid: number | null;
  holdCount: number;
  rejectionReason: string | null;
  /** Deadline (ISO) while the seller chooses after a rejected inspection report; null otherwise. */
  waitingForSeller?: string | null;
}) {
  const { run, pending, result } = useAdminAction();
  const [reason, setReason] = useState("");
  // The admin's own time zone ("UTC" until the page has loaded in the browser).
  const tz = useTimeZone();
  const at = (iso: string | null) => formatDateTime(iso, tz);
  const [customDate, setCustomDate] = useState(() => toZonedInputs(endsAt, tz).date);
  const [customTime, setCustomTime] = useState(() => toZonedInputs(endsAt, tz).time);
  const customEdited = useRef(false);
  useEffect(() => {
    if (customEdited.current) return;
    setCustomDate(toZonedInputs(endsAt, tz).date);
    setCustomTime(toZonedInputs(endsAt, tz).time);
  }, [tz, endsAt]);

  const ready = checks.every((c) => c.done) && !waitingForSeller;
  const ok = async (p: Promise<{ ok: boolean }>) => (await p).ok;
  const dialogError = result && !result.ok ? <ActionMessage result={result} /> : null;

  const extendTo = (ms: number | null) => {
    if (!ms || !startsAt) return null;
    const long = ms - Date.parse(startsAt) > MAX_AUCTION_MS;
    return (
      <>
        <p>
          The auction will end <span className="text-chalk">{at(new Date(ms).toISOString())}</span>
          instead of {at(endsAt)}. Bidders see the new time straight away.
        </p>
        {long ? (
          <p className="text-signal">
            It will then run more than 7 days. Card holds expire after about 7 days, so some bidders&apos; holds may lapse
            before it closes.
          </p>
        ) : null}
      </>
    );
  };
  const endMs = endsAt ? Date.parse(endsAt) : null;
  const customIso = fromZonedInputs(customDate, customTime, tz);

  return (
    <div className="space-y-4">
      {status === "draft" ? (
        <>
          <ul className="space-y-1.5 text-sm">
            {checks.map((c) => (
              <li key={c.label} className={cn("flex items-start gap-2", c.done ? "text-chalk" : "text-mute")}>
                {c.done ? (
                  <Check aria-hidden className="mt-0.5 size-4 shrink-0 text-verified" />
                ) : (
                  <X aria-hidden className="mt-0.5 size-4 shrink-0 text-signal" />
                )}
                <span>
                  <span className="sr-only">{c.done ? "Done: " : "Missing: "}</span>
                  {c.label}
                </span>
              </li>
            ))}
          </ul>
          {waitingForSeller ? (
            <p className="flex items-start gap-2 rounded-md border border-signal/60 px-3 py-2 text-sm">
              <Clock aria-hidden className="mt-0.5 size-4 shrink-0 text-status-neutral" />
              <span>
                Waiting for the seller to choose: new report or list without an inspection.{" "}
                <span className="text-mute">
                  Deadline {at(waitingForSeller)}. If they don&apos;t choose, the listing is
                  withdrawn automatically.
                </span>
              </span>
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <ConfirmButton
              label="Approve and schedule"
              variant="default"
              disabled={!ready || pending}
              title="Approve and schedule this auction?"
              description={
                <>
                  <p>The listing becomes public as a scheduled auction.</p>
                  <p>
                    Bidding opens <span className="text-chalk">{at(startsAt)}</span> and ends{" "}
                    <span className="text-chalk">{at(endsAt)}</span>. If the start has already
                    passed, bidding opens within a minute.
                  </p>
                </>
              }
              confirmLabel="Approve and schedule"
              onConfirm={() => ok(run(approveAuction, { auctionId, tz }))}
            >
              {dialogError}
            </ConfirmButton>
            <ConfirmButton
              label="Reject"
              disabled={pending}
              title="Reject this listing?"
              description={
                <p>
                  The listing won&apos;t be published. The seller sees it as “Not accepted” with your reason under My
                  listings. They can submit the car again.
                </p>
              }
              confirmLabel="Reject listing"
              destructive
              confirmDisabled={reason.trim().length < 10}
              onConfirm={() => ok(run(rejectAuction, { auctionId, reason }))}
            >
              <label htmlFor="reject-reason" className="mb-1.5 block text-sm font-semibold">
                Reason (the seller sees this)
              </label>
              <Textarea
                id="reject-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                maxLength={1000}
                placeholder="e.g. The photos don't show the car's underside. Add them and submit again."
              />
              <p className="mt-1 text-xs text-mute">At least 10 characters.</p>
              {dialogError}
            </ConfirmButton>
          </div>
          {!ready && !waitingForSeller ? <p className="text-xs text-mute">Fix the missing items above to approve.</p> : null}
        </>
      ) : null}

      {status === "upcoming" ? (
        <>
          <p className="text-sm text-mute">
            Bidding opens {at(startsAt)} and ends {at(endsAt)}.
          </p>
          <div className="flex flex-wrap gap-2">
            <ConfirmButton
              label="Move back to review"
              disabled={pending}
              title="Move this auction back to review?"
              description={
                <p>
                  It disappears from the public site and won&apos;t open for bidding until you approve it again. The
                  schedule, pricing and inspection stay as they are.
                </p>
              }
              confirmLabel="Move back to review"
              onConfirm={() => ok(run(moveBackToReview, { auctionId }))}
            >
              {dialogError}
            </ConfirmButton>
            <ConfirmButton
              label="Withdraw"
              disabled={pending}
              title="Withdraw this auction?"
              description={
                <>
                  <p>The auction is cancelled before bidding opens and marked “Withdrawn” on the public page.</p>
                  <p>
                    {holdCount > 0
                      ? `${holdCount} card ${holdCount === 1 ? "hold is" : "holds are"} released straight away.`
                      : "No card holds need releasing."}{" "}
                    You can&apos;t undo this; the seller would need to submit the car again.
                  </p>
                </>
              }
              confirmLabel="Withdraw auction"
              destructive
              onConfirm={() => ok(run(withdrawAuction, { auctionId }))}
            >
              {dialogError}
            </ConfirmButton>
          </div>
        </>
      ) : null}

      {status === "live" ? (
        <>
          <p className="text-sm text-mute">
            Ends {at(endsAt)}. {bidCount} {bidCount === 1 ? "bid" : "bids"}
            {currentBid ? `, high bid ${formatEur(currentBid)}` : ""}.
          </p>
          <div>
            <h3 className="text-sm font-semibold">Extend end time</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {(
                [
                  ["1h", "+1 hour", 3_600_000],
                  ["1d", "+1 day", 86_400_000],
                ] as const
              ).map(([mode, label, add]) => (
                <ConfirmButton
                  key={mode}
                  label={label}
                  size="sm"
                  disabled={pending || !endMs}
                  title={`Extend by ${label.slice(1)}?`}
                  description={extendTo(endMs ? endMs + add : null)}
                  confirmLabel="Extend"
                  onConfirm={() => ok(run(extendAuction, { auctionId, mode, tz }))}
                >
                  {dialogError}
                </ConfirmButton>
              ))}
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <div>
                <label htmlFor="extend-date" className="mb-1 block text-xs text-mute">
                  New end ({zoneAbbreviation(tz)}, your time zone)
                </label>
                <div className="flex flex-wrap gap-2">
                  <Input id="extend-date" type="date" className="min-w-0 flex-1" value={customDate} onChange={(e) => { customEdited.current = true; setCustomDate(e.target.value); }} />
                  <Input aria-label="New end time" type="time" value={customTime} onChange={(e) => { customEdited.current = true; setCustomTime(e.target.value); }} className="w-32" />
                </div>
              </div>
              <ConfirmButton
                label="Set new end"
                size="sm"
                className="h-10"
                disabled={pending || !customIso || !endMs || Date.parse(customIso) <= endMs}
                title="Change the end time?"
                description={extendTo(customIso ? Date.parse(customIso) : null)}
                confirmLabel="Change end time"
                onConfirm={() => ok(run(extendAuction, { auctionId, mode: "custom", date: customDate, time: customTime, tz }))}
              >
                {dialogError}
              </ConfirmButton>
            </div>
            {customIso && endMs && Date.parse(customIso) <= endMs ? (
              <p className="mt-1 text-xs text-mute">The new end must be later than the current end.</p>
            ) : null}
          </div>
          <div className="border-t border-line pt-4">
            <ConfirmButton
              label="Withdraw auction"
              disabled={pending}
              title="Withdraw this live auction?"
              description={
                <>
                  <p>Bidding stops now and the auction is marked “Withdrawn”.</p>
                  <p className="text-chalk">
                    {bidCount > 0
                      ? `All ${bidCount} ${bidCount === 1 ? "bid is" : "bids are"} cancelled: no one wins the car, including the current high bidder.`
                      : "There are no bids yet."}
                  </p>
                  <p>
                    {holdCount > 0
                      ? `${holdCount} card ${holdCount === 1 ? "hold is" : "holds are"} released straight away.`
                      : "No card holds need releasing."}{" "}
                    You can&apos;t undo this.
                  </p>
                </>
              }
              confirmLabel="Withdraw and cancel bids"
              destructive
              onConfirm={() => ok(run(withdrawAuction, { auctionId }))}
            >
              {dialogError}
            </ConfirmButton>
          </div>
        </>
      ) : null}

      {status === "rejected" ? (
        <p className="text-sm text-mute">
          Rejected. Reason shown to the seller: <span className="text-chalk">{rejectionReason ?? "No reason saved."}</span>
        </p>
      ) : null}
      {status === "withdrawn" ? <p className="text-sm text-mute">Withdrawn. Nothing else to do here.</p> : null}
      {status === "ended" || status === "sold" || status === "reserve_not_met" ? (
        <p className="text-sm text-mute">Bidding has closed.</p>
      ) : null}

      <ActionMessage result={result} />
    </div>
  );
}
