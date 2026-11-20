"use client";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { bidErrorMessage } from "@/lib/errors";
import { formatEur } from "@/lib/format";
import { PREMIUM_MAX, PREMIUM_MIN, PREMIUM_RATE } from "@/lib/pricing";
import { getBrowserSupabase } from "@/lib/supabase/client";

/**
 * "Before your first bid": a plain summary of rules the system already enforces, then
 * acceptance (accept_bidding_terms). Used by the bid dialog and by "Contact seller",
 * which needs the same acceptance. `title` and `description` are the heading elements,
 * so the dialog can pass its own.
 */
export function BiddingTermsForm({
  version,
  holdEur,
  title,
  description,
  onAccepted,
  onRecheck,
}: {
  version: string;
  holdEur: number;
  title: React.ReactNode;
  description: React.ReactNode;
  onAccepted: () => void;
  onRecheck: () => void;
}) {
  const [agreed, setAgreed] = useState(false);
  const [adult, setAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [triedSubmit, setTriedSubmit] = useState(false);

  async function accept(e: React.FormEvent) {
    e.preventDefault();
    setTriedSubmit(true);
    if (!agreed || !adult) {
      setError(
        !agreed && !adult
          ? "Tick both boxes to continue."
          : !agreed
            ? "Tick the box to agree to the bidding terms."
            : "Confirm that you are 18 or older.",
      );
      return;
    }
    setBusy(true);
    setError(null);
    const { error: rpcError } = await getBrowserSupabase().rpc("accept_bidding_terms", { p_version: version });
    setBusy(false);
    if (rpcError) {
      if (rpcError.message === "TERMS_VERSION_MISMATCH") {
        setError(bidErrorMessage("TERMS_VERSION_MISMATCH"));
        onRecheck();
        return;
      }
      setError(rpcError.message === "PROFILE_INCOMPLETE" ? bidErrorMessage("PROFILE_INCOMPLETE") : "Your acceptance wasn't saved. Check your connection and try again.");
      return;
    }
    onAccepted();
  }

  const box = "mt-0.5 size-4 shrink-0 accent-[#FF5500]";
  return (
    <form onSubmit={accept} className="flex flex-col gap-4" noValidate>
      <div>
        {title}
        {description}
      </div>
      <ul className="list-disc space-y-1.5 pl-5 text-sm">
        <li>Bids are binding. If yours is the highest when the auction ends and the reserve is met, you buy the car.</li>
        <li>Before your first bid on each auction, we place a refundable {formatEur(holdEur)} hold on your card.</li>
        <li>
          The winner pays a {Math.round(PREMIUM_RATE * 100)}% buyer&apos;s premium on top of the winning bid: at least{" "}
          {formatEur(PREMIUM_MIN)}, at most {formatEur(PREMIUM_MAX)}.
        </li>
        <li>A bid in the final 2 minutes extends the auction by 2 minutes.</li>
      </ul>
      <p className="text-sm">
        <a
          href="/terms/bidding"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block py-1 text-chalk underline underline-offset-4 hover:text-signal"
        >
          Read the full bidding terms<span className="sr-only"> (opens in a new tab)</span>
        </a>
      </p>

      <div className="space-y-2">
        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            required
            aria-invalid={triedSubmit && !agreed ? true : undefined}
            aria-describedby={error ? "terms-error" : undefined}
            className={box}
          />
          I have read and agree to the bidding terms
        </label>
        <label className="flex min-h-11 cursor-pointer items-start gap-3 text-sm">
          <input
            type="checkbox"
            checked={adult}
            onChange={(e) => setAdult(e.target.checked)}
            required
            aria-invalid={triedSubmit && !adult ? true : undefined}
            aria-describedby={error ? "terms-error" : undefined}
            className={box}
          />
          I am 18 or older
        </label>
      </div>

      {error && (
        <p id="terms-error" role="alert" className="text-sm text-signal">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" disabled={busy}>
        {busy ? <><Loader2 className="animate-spin" aria-hidden /> Saving…</> : "Agree and continue"}
      </Button>
      <p className="text-xs text-mute">Terms version {version}</p>
    </form>
  );
}
