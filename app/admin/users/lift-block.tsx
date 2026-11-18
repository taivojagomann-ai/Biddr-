"use client";
import { useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { ActionMessage, useAdminAction } from "../auctions/[id]/action-feedback";
import { ConfirmButton } from "../auctions/[id]/confirm-button";
import { liftBiddingBlock } from "./actions";

export function LiftBlock({ userId, name }: { userId: string; name: string }) {
  const { run, pending, result } = useAdminAction();
  const [reason, setReason] = useState("");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ConfirmButton
        label="Lift block"
        ariaLabel={`Lift block: ${name}`}
        size="sm"
        disabled={pending}
        title={`Let ${name} bid again?`}
        description={<p>They can place card holds and bids again, and get a notification.</p>}
        confirmLabel="Lift block"
        confirmDisabled={reason.trim().length < 10}
        onConfirm={async () => (await run(liftBiddingBlock, { userId, reason })).ok}
      >
        <label htmlFor={`lift-${userId}`} className="mt-4 block text-sm font-semibold">
          Reason (kept in the admin log)
        </label>
        <Textarea id={`lift-${userId}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} className="mt-1.5" />
        {result && !result.ok ? <ActionMessage result={result} /> : null}
      </ConfirmButton>
      {result?.ok ? <ActionMessage result={result} /> : null}
    </div>
  );
}
