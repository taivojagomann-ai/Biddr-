"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ActionMessage, useAdminAction } from "./action-feedback";
import { approveContent, overrideChecks, rerunChecks } from "./checks-actions";
import { ConfirmButton } from "./confirm-button";

/** Approve content (asks the seller for their identity), override a yellow/red result with a reason, run the checks again. */
export function ChecksActions({
  auctionId,
  outcome,
  overridden,
  contentApproved,
  canRerun,
}: {
  auctionId: string;
  outcome: "pending" | "green" | "yellow" | "red";
  overridden: boolean;
  contentApproved: boolean;
  canRerun: boolean;
}) {
  const { run, pending, result } = useAdminAction();
  const [reason, setReason] = useState("");
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {contentApproved ? null : (
          <Button type="button" size="sm" disabled={pending} onClick={() => void run(approveContent, { auctionId })}>
            Approve content and ask for identity
          </Button>
        )}
        {outcome !== "green" && !overridden ? (
          <ConfirmButton
            label="Override with a reason"
            size="sm"
            variant="outline"
            disabled={pending}
            title={`Accept the ${outcome} result?`}
            description={
              <p>
                You accept this listing although the automated checks weren&apos;t green. The seller&apos;s identity is still needed
                to schedule it. Your reason is kept in the admin log.
              </p>
            }
            confirmLabel="Override"
            confirmDisabled={reason.trim().length < 10}
            onConfirm={async () => (await run(overrideChecks, { auctionId, reason })).ok}
          >
            <label htmlFor={`override-${auctionId}`} className="mt-4 block text-sm font-semibold">
              Reason (kept in the admin log)
            </label>
            <Textarea id={`override-${auctionId}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} className="mt-1.5" />
            {result && !result.ok ? <ActionMessage result={result} /> : null}
          </ConfirmButton>
        ) : null}
        {canRerun ? (
          <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => void run(rerunChecks, { auctionId })}>
            Run the checks again
          </Button>
        ) : null}
      </div>
      {result ? <ActionMessage result={result} /> : null}
    </div>
  );
}
