"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { LIVE_WITHDRAW_NOTE, REASON_MAX, REQUEST_REASON_MIN, type WithdrawResult } from "@/lib/withdraw";
import { requestWithdrawal, withdrawListing } from "./actions";

/**
 * Rendered for every listing (also when there's nothing to do), so the outcome of a
 * withdrawal stays on screen and keeps keyboard focus after the row changes status.
 * Seller's withdraw controls on /account/listings:
 * - "withdraw": Waiting for review or Scheduled, withdraw directly (optional reason).
 * - "request": live, ask the Biddr team (reason of at least 20 characters).
 * - "requested": a request is waiting for an admin.
 */
export function WithdrawActions({
  auctionId,
  title,
  option,
  declined,
}: {
  auctionId: string;
  title: string;
  option: "withdraw" | "request" | "requested" | null;
  /** The last request was declined (the seller may ask again). */
  declined: boolean;
}) {
  const [done, setDone] = useState<string | null>(null);
  const doneRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (!done) return;
    // After the dialog has finished closing (it returns focus to its trigger, which is gone now).
    const t = window.setTimeout(() => doneRef.current?.focus(), 50);
    return () => window.clearTimeout(t);
  }, [done]);

  const outcome = done ? (
    <p ref={doneRef} tabIndex={-1} role="status" className="text-sm font-semibold text-verified outline-none">
      {done}
    </p>
  ) : null;

  if (option === null) return outcome;
  if (option === "requested") {
    return outcome ?? (
      <p className="inline-flex items-center gap-1.5 text-sm font-semibold">
        <Clock aria-hidden className="size-4 text-signal" />
        Withdrawal requested
        <span className="font-normal text-mute">· waiting for the Biddr team</span>
      </p>
    );
  }
  if (outcome) return outcome;
  return (
    <div className="flex flex-col items-start gap-1">
      {option === "request" && declined ? (
        <p className="text-xs text-mute">Your last withdrawal request was declined. You can ask again with more detail.</p>
      ) : null}
      <WithdrawDialog auctionId={auctionId} title={title} live={option === "request"} onDone={setDone} />
    </div>
  );
}

function WithdrawDialog({
  auctionId,
  title,
  live,
  onDone,
}: {
  auctionId: string;
  title: string;
  live: boolean;
  onDone: (message: string) => void;
}) {
  const router = useRouter();
  const id = useId();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<WithdrawResult | null>(null);
  const reasonId = `${id}-reason`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const error = result && !result.ok ? result.error : null;
  const label = live ? "Request withdrawal" : "Withdraw listing";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    let res: WithdrawResult;
    try {
      res = live ? await requestWithdrawal({ auctionId, reason }) : await withdrawListing({ auctionId, reason });
    } catch {
      res = { ok: false, error: "We couldn't reach the server. Check your connection and try again." };
    }
    setBusy(false);
    setResult(res);
    if (res.ok) {
      setOpen(false);
      onDone(res.message);
      router.refresh();
    }
  }

  return (
    <Dialog
        open={open}
        onOpenChange={(o) => {
          if (busy) return;
          setOpen(o);
          if (o) setResult(null);
        }}
      >
        <DialogTrigger asChild>
          {/* The name starts with the visible text (WCAG 2.5.3) and adds which car. */}
          <Button type="button" variant="outline" size="sm" aria-label={`${label}: ${title}`}>
            {label}
          </Button>
        </DialogTrigger>
        <DialogContent>
          <form onSubmit={submit} noValidate>
            <DialogTitle className="pr-8">{live ? "Request withdrawal?" : "Withdraw this listing?"}</DialogTitle>
            <DialogDescription asChild>
              <div className="mt-2 space-y-2 text-sm text-mute">
                <p className="font-semibold text-chalk">{title}</p>
                {live ? (
                  <p>{LIVE_WITHDRAW_NOTE}</p>
                ) : (
                  <p>The listing is taken off Biddr and can&apos;t be scheduled again. You can list the car again later as a new listing.</p>
                )}
              </div>
            </DialogDescription>

            <div className="mt-4 space-y-1.5">
              <label htmlFor={reasonId} className="block text-sm font-semibold">
                {live ? "Why do you want to withdraw it?" : "Reason"}
                {live ? null : <span className="ml-1 font-normal text-mute"> (optional)</span>}
              </label>
              <Textarea
                id={reasonId}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={REASON_MAX}
                required={live}
                aria-invalid={error ? true : undefined}
                aria-describedby={[error ? errorId : null, live ? hintId : null].filter(Boolean).join(" ") || undefined}
                placeholder={live ? "e.g. The car was damaged in a hailstorm yesterday." : "e.g. Sold privately"}
                className="min-h-0 p-3"
              />
              {live ? (
                <p id={hintId} className="text-xs text-mute">
                  At least {REQUEST_REASON_MIN} characters. {reason.trim().length} so far.
                </p>
              ) : null}
              {error ? (
                <p id={errorId} role="alert" className="text-sm font-medium text-signal">
                  {error}
                </p>
              ) : null}
            </div>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={busy}
                className={live ? undefined : "bg-[#b91c1c] text-chalk hover:bg-[#991b1b] active:bg-[#7f1d1d]"}
              >
                {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
                {live ? "Send request" : "Withdraw listing"}
              </Button>
            </div>
          </form>
        </DialogContent>
    </Dialog>
  );
}
