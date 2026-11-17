"use client";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmButton } from "../auctions/[id]/confirm-button";
import { ActionMessage, useAdminAction } from "../auctions/[id]/action-feedback";
import { cancelPayment, refundPremium, retryCharge } from "./actions";

/** Retry charge, Mark as cancelled (with reason) and Refund premium, each behind a confirmation dialog. */
export function PaymentActions({ paymentId, status, title, premium }: { paymentId: string; status: string; title: string; premium: string }) {
  const { run, pending, result } = useAdminAction();
  const [reason, setReason] = useState("");
  const ok = async (p: Promise<{ ok: boolean }>) => (await p).ok;
  const dialogError = result && !result.ok ? <ActionMessage result={result} /> : null;
  const canRetry = ["failed", "action_required", "pending"].includes(status);
  const canCancel = ["failed", "action_required", "pending"].includes(status);
  const canRefund = status === "paid";
  if (!canRetry && !canCancel && !canRefund) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canRetry ? (
        <ConfirmButton
          label="Retry charge"
          ariaLabel={`Retry charge: ${title}`}
          size="sm"
          disabled={pending}
          title="Charge the buyer's premium again now?"
          description={<p>Stripe tries the winner&apos;s saved card again for what&apos;s still owed. If their bank asks them to confirm, they&apos;re told on My purchases.</p>}
          confirmLabel="Retry charge"
          onConfirm={() => ok(run(retryCharge, { paymentId }))}
        >
          {dialogError}
        </ConfirmButton>
      ) : null}
      {canCancel ? (
        <ConfirmButton
          label="Mark as cancelled"
          ariaLabel={`Mark as cancelled: ${title}`}
          size="sm"
          disabled={pending}
          destructive
          title="Stop collecting the buyer's premium?"
          description={<p>Nothing more is charged for this car, and an uncaptured card hold is released. The winner and seller don&apos;t get each other&apos;s contact details.</p>}
          confirmLabel="Mark as cancelled"
          confirmDisabled={reason.trim().length < 10}
          onConfirm={() => ok(run(cancelPayment, { paymentId, reason }))}
        >
          <label htmlFor={`cancel-${paymentId}`} className="mt-4 block text-sm font-semibold">
            Reason (kept in the admin log)
          </label>
          <Textarea id={`cancel-${paymentId}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} className="mt-1.5" />
          {dialogError}
        </ConfirmButton>
      ) : null}
      {canRefund ? (
        <ConfirmButton
          label="Refund premium"
          ariaLabel={`Refund premium: ${title}`}
          size="sm"
          disabled={pending}
          destructive
          title={`Refund ${premium} to the winner?`}
          description={<p>Stripe returns the whole buyer&apos;s premium to the winner&apos;s card: the part taken from the hold and the rest. You can&apos;t undo a refund.</p>}
          confirmLabel="Refund premium"
          onConfirm={() => ok(run(refundPremium, { paymentId }))}
        >
          {dialogError}
        </ConfirmButton>
      ) : null}
      {result?.ok ? <ActionMessage result={result} /> : null}
    </div>
  );
}
