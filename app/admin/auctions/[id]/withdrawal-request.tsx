"use client";
import { useEffect, useRef, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { useTimeZone } from "@/hooks/use-time-zone";
import { formatDateTime } from "@/lib/zoned-time";
import { approveWithdrawalRequest, declineWithdrawalRequest } from "../../actions";
import { ActionMessage, useAdminAction } from "./action-feedback";
import { ConfirmButton } from "./confirm-button";
import { Label } from "./section";

/**
 * A seller's withdrawal request, shown at the top of the admin page. Pending: the
 * reason and the two decisions. Decided: the outcome (kept on screen, with focus,
 * so the admin sees what happened).
 */
export function WithdrawalRequest({
  auctionId,
  status,
  reason,
  requestedAt,
  bidCount,
  holdCount,
}: {
  auctionId: string;
  status: "pending" | "approved" | "declined";
  reason: string | null;
  requestedAt: string | null;
  bidCount: number;
  holdCount: number;
}) {
  const approve = useAdminAction();
  const tz = useTimeZone();
  const decline = useAdminAction();
  const [note, setNote] = useState("");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstStatus = useRef(status);
  useEffect(() => {
    // Decided on this page: the buttons are gone, so put focus on the outcome.
    if (status !== firstStatus.current) {
      const t = window.setTimeout(() => headingRef.current?.focus(), 50);
      return () => window.clearTimeout(t);
    }
  }, [status]);

  return (
    <section aria-labelledby="withdraw-request-heading" className={`mt-4 rounded-lg border bg-panel p-4 ${status === "pending" ? "border-signal/60" : "border-field"}`}>
      <h2 id="withdraw-request-heading" ref={headingRef} tabIndex={-1} className="font-bold outline-none">
        {status === "pending"
          ? "The seller asked to withdraw this auction"
          : status === "approved"
            ? "Withdrawal request approved: the auction is withdrawn"
            : "Withdrawal request declined: the auction keeps running"}
      </h2>
      <p className="mt-1 text-xs text-mute">
        {requestedAt
          ? `Requested ${formatDateTime(requestedAt, tz)}`
          : "Requested"}
      </p>
      <blockquote className="mt-3 whitespace-pre-line border-l-2 border-line pl-3 text-sm">{reason ?? "No reason given."}</blockquote>

      {status === "pending" ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <ConfirmButton
            label="Approve and withdraw"
            variant="default"
            size="sm"
            destructive
            title="Approve the request and withdraw this auction?"
            confirmLabel="Approve and withdraw"
            description={
              <>
                <p>The auction ends now and no one wins the car.</p>
                <p>
                  {bidCount > 0
                    ? `All ${bidCount} ${bidCount === 1 ? "bid is" : "bids are"} cancelled`
                    : "There are no bids to cancel"}
                  {holdCount > 0 ? ` and ${holdCount} card ${holdCount === 1 ? "hold is" : "holds are"} released.` : "."}
                </p>
                <p>The seller is notified. This can&apos;t be undone.</p>
              </>
            }
            onConfirm={async () => (await approve.run(approveWithdrawalRequest, { auctionId })).ok}
          />
          <ConfirmButton
            label="Decline"
            size="sm"
            title="Decline the withdrawal request?"
            confirmLabel="Decline request"
            description={<p>The auction keeps running. The seller is notified, with your note if you add one.</p>}
            onConfirm={async () => (await decline.run(declineWithdrawalRequest, { auctionId, note })).ok}
          >
            <Label htmlFor="decline-note" optional>
              Note to the seller
            </Label>
            <Textarea
              id="decline-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={500}
              rows={3}
              className="min-h-0 p-3"
              placeholder="e.g. Bidders are relying on this auction. Contact us if the car is damaged."
            />
          </ConfirmButton>
        </div>
      ) : null}
      <ActionMessage result={approve.result ?? decline.result} className="mt-3" />
    </section>
  );
}
