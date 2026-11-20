"use client";
import { useId, useState } from "react";
import { Textarea } from "@/components/ui/textarea";
import { ActionMessage, useAdminAction } from "../auctions/[id]/action-feedback";
import { ConfirmButton } from "../auctions/[id]/confirm-button";
import { blockMessaging, closeConversation, resolveConversationReports } from "./actions";

/** Close conversation, Block user from messaging (buyer or seller) and Mark as handled. Each asks for confirmation and is logged. */
export function ConversationActions({
  conversationId,
  closed,
  parties,
}: {
  conversationId: string;
  closed: boolean;
  parties: { id: string; name: string; role: "buyer" | "seller"; blocked: boolean }[];
}) {
  const { run, pending, result } = useAdminAction();
  const [reason, setReason] = useState("");
  const id = useId();
  const reasonField = (key: string) => (
    <>
      <label htmlFor={`${id}-${key}`} className="mt-4 block text-sm font-semibold">
        Reason (kept in the admin log)
      </label>
      <Textarea id={`${id}-${key}`} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} className="mt-1.5" />
      {result && !result.ok ? <ActionMessage result={result} /> : null}
    </>
  );
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {closed ? null : (
          <ConfirmButton
            label="Close conversation"
            size="sm"
            destructive
            disabled={pending}
            title="Close this conversation?"
            description={<p>Neither party can write, propose viewings or share phone numbers in it any more. Biddr support posts a short note, and its open reports are marked handled.</p>}
            confirmLabel="Close conversation"
            confirmDisabled={reason.trim().length < 10}
            onConfirm={async () => (await run(closeConversation, { conversationId, reason })).ok}
          >
            {reasonField("close")}
          </ConfirmButton>
        )}
        {parties
          .filter((p) => !p.blocked)
          .map((p) => (
            <ConfirmButton
              key={p.id}
              label={`Block ${p.role} from messaging`}
              ariaLabel={`Block ${p.role} from messaging: ${p.name}`}
              size="sm"
              variant="outline"
              disabled={pending}
              title={`Block ${p.name} from messaging?`}
              description={<p>They can&apos;t contact sellers or send messages anywhere on Biddr until an admin lifts it on Admin → Users. They get a notification with the reason.</p>}
              confirmLabel="Block from messaging"
              confirmDisabled={reason.trim().length < 10}
              onConfirm={async () => (await run(blockMessaging, { conversationId, userId: p.id, reason })).ok}
            >
              {reasonField(`block-${p.id}`)}
            </ConfirmButton>
          ))}
        <ConfirmButton
          label="Mark as handled"
          size="sm"
          variant="ghost"
          disabled={pending}
          title="Mark the reports as handled?"
          description={<p>The conversation leaves this list. Nothing changes for the buyer or the seller.</p>}
          confirmLabel="Mark as handled"
          onConfirm={async () => (await run(resolveConversationReports, { conversationId })).ok}
        />
      </div>
      {result?.ok ? <ActionMessage result={result} /> : null}
    </div>
  );
}
