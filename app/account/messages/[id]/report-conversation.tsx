"use client";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Flag, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { messageError } from "@/lib/messages";
import { getBrowserSupabase } from "@/lib/supabase/client";

/**
 * "Report": scams, pressure to pay through a link, abuse, contact details pushed before
 * the sale... A reason is required. Biddr's team sees the conversation with the original
 * text while the report is open (DECISIONS.md point 14).
 */
export function ReportConversation({ conversationId, otherRole }: { conversationId: string; otherRole: "buyer" | "seller" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (reason.trim().length < 10) {
      setError(messageError("REPORT_REASON_SHORT"));
      ref.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    const { error: rpcError } = await getBrowserSupabase().rpc("report_conversation", { p_conversation: conversationId, p_reason: reason });
    setBusy(false);
    if (rpcError) {
      setError(messageError(rpcError.message, "Your report wasn't sent. Try again."));
      ref.current?.focus();
      return;
    }
    router.refresh();
  }

  if (!open) {
    return (
      <div className="mt-2">
        <p className="text-sm text-mute">Tell Biddr if the {otherRole} asks you to pay through a link, pressures you or is abusive.</p>
        <Button
          type="button"
          variant="outline"
          className="mt-3 min-h-11"
          onClick={() => {
            setOpen(true);
            requestAnimationFrame(() => ref.current?.focus());
          }}
        >
          <Flag aria-hidden />
          Report
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="mt-3 space-y-2">
      <label htmlFor={`${id}-reason`} className="block text-sm font-semibold">
        What&apos;s wrong? <span className="font-normal text-mute">(required)</span>
      </label>
      <Textarea
        ref={ref}
        id={`${id}-reason`}
        value={reason}
        maxLength={1000}
        rows={3}
        required
        onChange={(e) => setReason(e.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-signal">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy} className="min-h-11">
          {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
          Send report
        </Button>
        <Button type="button" variant="ghost" className="min-h-11" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
