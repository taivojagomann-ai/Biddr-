"use client";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { DESCRIPTION_MIN, REASONS, type ReportReason } from "@/lib/reports";
import { reportProblem, type ReportResult } from "../actions";

/** "Report a problem": a disclosure with the reasons for this party and a description. */
export function ReportForm({ conversationId, role, buyerOverdue }: { conversationId: string; role: "buyer" | "seller"; buyerOverdue: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | "">("");
  const [description, setDescription] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ReportResult | null>(null);
  const panelId = useId();
  const fe = result && !result.ok ? (result.fieldErrors ?? {}) : {};

  return (
    <div>
      <Button type="button" variant="outline" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((v) => !v)}>
        Report a problem
      </Button>
      <div id={panelId} hidden={!open} className="mt-4">
        <form
          className="space-y-4 rounded-lg border border-line bg-panel p-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setPending(true);
            const r = await reportProblem({ conversationId, reason, description });
            setPending(false);
            setResult(r);
            if (r.ok) router.refresh();
          }}
        >
          <fieldset aria-describedby={fe.reason ? "report-reason-error" : undefined}>
            <legend className="text-sm font-semibold">What&apos;s the problem?</legend>
            <div className="mt-2 space-y-1">
              {REASONS[role].map((r) => {
                const disabled = r.value === "buyer_not_paid" && !buyerOverdue;
                return (
                  <label key={r.value} className={`flex min-h-11 items-center gap-3 text-sm ${disabled ? "text-mute" : ""}`}>
                    <input
                      type="radio"
                      name="reason"
                      value={r.value}
                      checked={reason === r.value}
                      disabled={disabled}
                      onChange={() => setReason(r.value)}
                      className="size-4 accent-[#FF5A0A]"
                    />
                    <span>
                      {r.label}
                      {disabled ? <span className="block text-xs">Available once the 7 days for paying you have passed.</span> : null}
                    </span>
                  </label>
                );
              })}
            </div>
            {fe.reason ? (
              <p id="report-reason-error" className="mt-1 text-xs font-medium text-signal">
                {fe.reason}
              </p>
            ) : null}
          </fieldset>
          <div>
            <label htmlFor="report-description" className="block text-sm font-semibold">
              Describe what happened
            </label>
            <p id="report-description-hint" className="mt-0.5 text-xs text-mute">
              At least {DESCRIPTION_MIN} characters. Only Biddr&apos;s team sees this. While your report is open, they can read this
              conversation.
            </p>
            <Textarea
              id="report-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              maxLength={2000}
              className="mt-1.5"
              aria-invalid={fe.description ? true : undefined}
              aria-describedby={`report-description-hint${fe.description ? " report-description-error" : ""}`}
            />
            {fe.description ? (
              <p id="report-description-error" className="mt-1 text-xs font-medium text-signal">
                {fe.description}
              </p>
            ) : null}
          </div>
          {result && !result.ok && !Object.keys(fe).length ? (
            <p role="alert" className="text-sm text-signal">
              {result.error}
            </p>
          ) : null}
          <Button type="submit" disabled={pending}>
            Send report
          </Button>
        </form>
      </div>
      <p role="status" className="mt-2 text-sm">
        {result?.ok ? result.message : ""}
      </p>
    </div>
  );
}
