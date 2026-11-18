"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ActionMessage, FieldNote, useAdminAction } from "../../auctions/[id]/action-feedback";
import { ConfirmButton } from "../../auctions/[id]/confirm-button";
import { blockParty, markInReview, resolveReport, sendSupportMessage } from "../actions";

/** Mark in review, write as Biddr support, block a party, and resolve with a decision. */
export function ReportActions({ reportId, status, buyer, seller }: { reportId: string; status: string; buyer: string; seller: string }) {
  const review = useAdminAction();
  const message = useAdminAction();
  const resolve = useAdminAction();
  const block = useAdminAction();
  const [body, setBody] = useState("");
  const [outcome, setOutcome] = useState<"resolved" | "sale_failed" | "">("");
  const [resolution, setResolution] = useState("");
  const [blockReason, setBlockReason] = useState("");
  if (status === "resolved") return null;
  return (
    <div className="space-y-8">
      {status === "open" ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" disabled={review.pending} onClick={() => void review.run(markInReview, { reportId })}>
            Mark as in review
          </Button>
          <ActionMessage result={review.result} />
        </div>
      ) : null}

      <form
        className="space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          const r = await message.run(sendSupportMessage, { reportId, body });
          if (r.ok) setBody("");
        }}
      >
        <h3 className="font-bold">Message both parties as Biddr support</h3>
        <label htmlFor="support-body" className="block text-sm font-semibold">
          Message
        </label>
        <Textarea id="support-body" value={body} onChange={(e) => setBody(e.target.value)} rows={3} maxLength={2000} aria-invalid={message.fieldErrors.body ? true : undefined} />
        <FieldNote error={message.fieldErrors.body} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="outline" disabled={message.pending}>
            Send as Biddr support
          </Button>
          <ActionMessage result={message.result} />
        </div>
      </form>

      <div className="space-y-2">
        <h3 className="font-bold">Block a party</h3>
        <label htmlFor="block-reason" className="block text-sm font-semibold">
          Reason (shown to them and kept in the admin log)
        </label>
        <Textarea id="block-reason" value={blockReason} onChange={(e) => setBlockReason(e.target.value)} rows={2} maxLength={500} />
        <div className="flex flex-wrap gap-2">
          <ConfirmButton
            label="Block the buyer from bidding"
            ariaLabel={`Block the buyer from bidding: ${buyer}`}
            size="sm"
            destructive
            disabled={block.pending || blockReason.trim().length < 10}
            title={`Block ${buyer} from bidding?`}
            description={<p>They can&apos;t place card holds or bids until an admin lifts it on Admin → Users. They&apos;re notified with the reason.</p>}
            confirmLabel="Block from bidding"
            onConfirm={async () => (await block.run(blockParty, { reportId, kind: "bidding", reason: blockReason })).ok}
          />
          <ConfirmButton
            label="Block the seller from selling"
            ariaLabel={`Block the seller from selling: ${seller}`}
            size="sm"
            destructive
            disabled={block.pending || blockReason.trim().length < 10}
            title={`Block ${seller} from selling?`}
            description={<p>They can&apos;t submit new cars until an admin lifts it on Admin → Users. They&apos;re notified with the reason.</p>}
            confirmLabel="Block from selling"
            onConfirm={async () => (await block.run(blockParty, { reportId, kind: "selling", reason: blockReason })).ok}
          />
        </div>
        <p className="text-xs text-mute">Write a reason of at least 10 characters first. To refund the premium, use Admin → Payments.</p>
        <ActionMessage result={block.result} />
      </div>

      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void resolve.run(resolveReport, { reportId, outcome, resolution });
        }}
      >
        <h3 className="font-bold">Resolve</h3>
        <fieldset>
          <legend className="text-sm font-semibold">Outcome</legend>
          {[
            { value: "resolved", label: "Resolved: the sale goes ahead" },
            { value: "sale_failed", label: "The sale failed" },
          ].map((o) => (
            <label key={o.value} className="flex min-h-11 items-center gap-3 text-sm">
              <input type="radio" name="outcome" value={o.value} checked={outcome === o.value} onChange={() => setOutcome(o.value as "resolved" | "sale_failed")} className="size-4 accent-[#FF5A0A]" />
              {o.label}
            </label>
          ))}
          <FieldNote error={resolve.fieldErrors.outcome} />
        </fieldset>
        <label htmlFor="resolution" className="block text-sm font-semibold">
          Decision (the reporter sees it, and it&apos;s posted to the conversation)
        </label>
        <Textarea id="resolution" value={resolution} onChange={(e) => setResolution(e.target.value)} rows={3} maxLength={2000} aria-invalid={resolve.fieldErrors.resolution ? true : undefined} />
        <FieldNote error={resolve.fieldErrors.resolution} />
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={resolve.pending}>
            Resolve the report
          </Button>
          <ActionMessage result={resolve.result} />
        </div>
      </form>
    </div>
  );
}
