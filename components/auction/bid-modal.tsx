"use client";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { loadStripe, type Appearance } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { CheckCircle2, Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { bidErrorMessage } from "@/lib/errors";
import { formatEur } from "@/lib/format";
import { buyersPremium, minNextBid, PREMIUM_MAX, PREMIUM_MIN, PREMIUM_RATE, QUICK_INCREMENTS } from "@/lib/pricing";
import type { Auction, BidderStatus, HoldResponse, PlaceBidResult } from "@/lib/types";

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

const appearance: Appearance = {
  theme: "night",
  variables: {
    colorPrimary: "#FF5500",
    colorBackground: "#0A0A0B",
    colorText: "#F4F4F5",
    colorTextSecondary: "#A1A1AA",
    colorDanger: "#FF5500",
    borderRadius: "8px",
    fontFamily: "Archivo, system-ui, sans-serif",
  },
  rules: { ".Input": { border: "1px solid #71717A" }, ".Input:focus": { border: "1px solid #FF5500", boxShadow: "none" } },
};

type Step =
  | { kind: "signin" }
  | { kind: "loading" }
  | { kind: "profile" }
  | { kind: "terms"; version: string }
  | { kind: "hold"; clientSecret: string; amountEur: number }
  | { kind: "confirm" }
  | { kind: "success"; result: PlaceBidResult }
  | { kind: "error"; title: string; message: string };

function isBidderStatus(v: unknown): v is BidderStatus {
  return (
    typeof v === "object" && v !== null &&
    typeof (v as BidderStatus).profile_complete === "boolean" &&
    typeof (v as BidderStatus).terms_accepted === "boolean" &&
    typeof (v as BidderStatus).current_version === "string"
  );
}

interface BidModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  auction: Auction;
  amount: number;
  setAmount: (n: number) => void;
  userId: string | null;
  hasHold: boolean;
  onHoldAuthorized: () => void;
  onBidPlaced: (r: PlaceBidResult) => void;
  holdEur: number;
}

export function BidModal(props: BidModalProps) {
  const { open, onOpenChange, auction, userId, hasHold, holdEur } = props;
  const [step, setStep] = useState<Step>({ kind: "loading" });

  // The dialog is opened from state (bid box or sticky bar), not a DialogTrigger, so Radix
  // doesn't know where to send focus on close. Remember the opener and return focus there.
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (open && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      opener.current = document.activeElement;
    }
  }, [open]);

  const startHold = useCallback(async () => {
    setStep({ kind: "loading" });
    try {
      const res = await fetch("/api/stripe/hold", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auctionId: auction.id }),
      });
      const body = (await res.json()) as HoldResponse | { error: string; code?: string };
      if (res.status === 403 && "code" in body && (body.code === "PROFILE_INCOMPLETE" || body.code === "TERMS_NOT_ACCEPTED")) {
        // The server is the final word: send the user to the step they still need.
        await checkRequirementsRef.current();
        return;
      }
      if (!res.ok || "error" in body) {
        setStep({ kind: "error", title: "Card check didn't start", message: "error" in body ? body.error : "The card check couldn't start." });
        return;
      }
      if (body.status === "authorized") {
        props.onHoldAuthorized();
        setStep({ kind: "confirm" });
      } else if (body.clientSecret) {
        setStep({ kind: "hold", clientSecret: body.clientSecret, amountEur: body.amountEur });
      }
    } catch {
      setStep({ kind: "error", title: "Card check didn't start", message: "The card check couldn't start. Check your connection and try again." });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auction.id]);

  // Profile, then terms, then the card hold: each step is skipped when already done.
  const checkRequirements = useCallback(async () => {
    setStep({ kind: "loading" });
    const { data, error } = await getBrowserSupabase().rpc("bidder_status");
    if (error || !isBidderStatus(data)) {
      setStep({ kind: "error", title: "We couldn't check your account", message: "Check your connection and try again." });
      return;
    }
    if (!data.profile_complete) setStep({ kind: "profile" });
    else if (!data.terms_accepted) setStep({ kind: "terms", version: data.current_version });
    else if (hasHold) setStep({ kind: "confirm" });
    else void startHold();
  }, [hasHold, startHold]);
  const checkRequirementsRef = useRef(checkRequirements);
  checkRequirementsRef.current = checkRequirements;

  // Choose the first step each time the modal opens.
  useEffect(() => {
    if (!open) return;
    if (!userId) setStep({ kind: "signin" });
    else void checkRequirements();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const elementsOptions = useMemo(
    () => (step.kind === "hold" ? { clientSecret: step.clientSecret, appearance } : undefined),
    [step],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="bid-modal-desc"
        onCloseAutoFocus={(e) => {
          if (opener.current?.isConnected) {
            e.preventDefault();
            opener.current.focus();
          }
        }}
      >
        {step.kind === "signin" && (
          <div className="flex flex-col gap-4">
            <DialogTitle>Sign in to bid</DialogTitle>
            <DialogDescription id="bid-modal-desc">
              Bidding is open to registered members in Estonia, Latvia and Lithuania.
            </DialogDescription>
            <Button asChild size="lg"><Link href={`/login?next=/auctions/${auction.id}`}>Sign in</Link></Button>
          </div>
        )}

        {step.kind === "loading" && (
          <div className="flex flex-col items-center gap-3 py-10">
            <DialogTitle className="sr-only">Preparing your bid</DialogTitle>
            <Loader2 className="size-6 animate-spin text-mute" aria-hidden />
            <DialogDescription id="bid-modal-desc">Preparing secure card check…</DialogDescription>
          </div>
        )}

        {step.kind === "profile" && (
          <div className="flex flex-col gap-4">
            <DialogTitle>Finish your profile to bid</DialogTitle>
            <DialogDescription id="bid-modal-desc">
              Bidders need a username, full name, country and phone number. Only your username and country are shown
              publicly.
            </DialogDescription>
            <Button asChild size="lg">
              <Link href={`/account/setup?next=${encodeURIComponent(`/auctions/${auction.id}`)}`}>Finish your profile</Link>
            </Button>
          </div>
        )}

        {step.kind === "terms" && (
          <TermsStep
            version={step.version}
            holdEur={holdEur}
            onAccepted={() => (hasHold ? setStep({ kind: "confirm" }) : void startHold())}
            onRecheck={() => void checkRequirements()}
          />
        )}

        {step.kind === "hold" && elementsOptions && (
          <Elements stripe={stripePromise} options={elementsOptions}>
            <HoldForm
              amountEur={step.amountEur}
              auctionId={auction.id}
              onAuthorized={() => { props.onHoldAuthorized(); setStep({ kind: "confirm" }); }}
            />
          </Elements>
        )}

        {step.kind === "confirm" && (
          <ConfirmBid {...props} onDone={(result) => { props.onBidPlaced(result); setStep({ kind: "success", result }); }}
            onHoldMissing={() => void startHold()} onRequirementMissing={() => void checkRequirements()} />
        )}

        {step.kind === "success" && (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <CheckCircle2 className="size-10 text-verified" aria-hidden />
            <DialogTitle>You have the high bid</DialogTitle>
            <DialogDescription id="bid-modal-desc">
              Your bid of {formatEur(step.result.current_bid)} is in.
              {step.result.extended && " It came in the final two minutes, so the auction now ends 2 minutes later."}
              {" "}We&apos;ll show it here if someone outbids you.
            </DialogDescription>
            {/* Focus lands here so screen readers hear the result straight away. */}
            <Button className="mt-2 w-full" autoFocus onClick={() => onOpenChange(false)}>Back to the car</Button>
          </div>
        )}

        {step.kind === "error" && (
          <div className="flex flex-col gap-4">
            <DialogTitle>{step.title}</DialogTitle>
            <DialogDescription id="bid-modal-desc">{step.message}</DialogDescription>
            <Button autoFocus onClick={() => void checkRequirements()}>Try again</Button>
          </div>
        )}

        <p className="mt-4 flex items-center justify-center gap-1.5 text-center text-xs text-mute">
          <Lock className="size-3 shrink-0" aria-hidden /> Card details are handled by Stripe. Hold: {formatEur(holdEur)}, refundable.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function HoldForm({ amountEur, auctionId, onAuthorized }: { amountEur: number; auctionId: string; onAuthorized: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setBusy(true);
    setError(null);

    const { error: stripeError, paymentIntent } = await stripe.confirmPayment({
      elements,
      redirect: "if_required",
      confirmParams: { return_url: `${window.location.origin}/auctions/${auctionId}?hold=return` },
    });

    if (stripeError) {
      setBusy(false);
      setError(stripeError.message ?? "Your card was declined. Try another card.");
      return;
    }

    // Manual capture: a successful authorization lands in requires_capture.
    if (paymentIntent?.status === "requires_capture") {
      const res = await fetch("/api/stripe/hold/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentIntentId: paymentIntent.id }),
      });
      setBusy(false);
      if (res.ok) onAuthorized();
      else setError("Your card was authorized but we couldn't record it. Close this window and try again; you won't be charged twice.");
      return;
    }

    setBusy(false);
    setError("Your bank didn't approve the hold. Try another card.");
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <DialogTitle>Confirm your card</DialogTitle>
        <DialogDescription id="bid-modal-desc" className="mt-1">
          We place a {formatEur(amountEur)} hold on your card. It is not a charge: the hold is released when this auction
          ends unless you win, in which case it goes toward the buyer&apos;s premium.
        </DialogDescription>
      </div>
      <PaymentElement options={{ layout: "tabs", wallets: { applePay: "auto", googlePay: "auto" } }} />
      {error && <p role="alert" className="text-sm text-signal">{error}</p>}
      <Button type="submit" size="lg" disabled={!stripe || busy}>
        {busy ? <><Loader2 className="animate-spin" aria-hidden /> Checking card…</> : `Place ${formatEur(amountEur)} hold`}
      </Button>
    </form>
  );
}

function ConfirmBid({
  auction, amount, setAmount, onDone, onHoldMissing, onRequirementMissing,
}: BidModalProps & { onDone: (r: PlaceBidResult) => void; onHoldMissing: () => void; onRequirementMissing: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const minNext = minNextBid(auction);
  const outpaced = amount < minNext; // someone bid while this window was open
  const premium = buyersPremium(amount);

  async function placeBid() {
    setBusy(true);
    setError(null);
    const { data, error: rpcError } = await getBrowserSupabase()
      .rpc("place_bid", { p_auction_id: auction.id, p_amount: amount })
      .returns<PlaceBidResult>();
    setBusy(false);

    if (rpcError) {
      if (rpcError.message === "HOLD_REQUIRED" || rpcError.message === "NOT_VERIFIED") {
        onHoldMissing();
        return;
      }
      if (rpcError.message === "PROFILE_INCOMPLETE" || rpcError.message === "TERMS_NOT_ACCEPTED") {
        onRequirementMissing();
        return;
      }
      if (rpcError.message === "BID_TOO_LOW" && rpcError.details) {
        const floor = Number(rpcError.details);
        if (Number.isFinite(floor)) setAmount(floor);
      }
      setError(bidErrorMessage(rpcError.message));
      return;
    }
    if (data) onDone(data);
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <DialogTitle>Confirm your bid</DialogTitle>
        <DialogDescription id="bid-modal-desc" className="mt-1">{auction.title}</DialogDescription>
      </div>

      <div>
        <label htmlFor="modal-bid" className="text-sm text-mute">Bid amount (minimum {formatEur(minNext)})</label>
        <div className="relative mt-1">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute">€</span>
          <Input id="modal-bid" inputMode="numeric" pattern="[0-9]*" className="h-12 pl-7 font-wide text-xl font-black tabular"
            value={amount ? String(amount) : ""} onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, "")) || 0)}
            aria-invalid={outpaced} aria-describedby={outpaced ? "modal-bid-outpaced" : undefined} />
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {QUICK_INCREMENTS.map((inc) => {
            const target = Math.max(minNext, (auction.current_bid ?? auction.starting_bid) + inc);
            return (
              <Button key={inc} type="button" variant="outline" size="sm" onClick={() => setAmount(target)}>
                +{formatEur(inc)}
                <span className="sr-only">, sets your bid to {formatEur(target)}</span>
              </Button>
            );
          })}
        </div>
      </div>

      {outpaced && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-signal/10 p-3 text-sm text-signal">
          <span id="modal-bid-outpaced">A new bid came in. The minimum is now {formatEur(minNext)}.</span>
          <Button size="sm" variant="outline" onClick={() => setAmount(minNext)}>Use {formatEur(minNext)}</Button>
        </div>
      )}

      <dl className="grid gap-1.5 rounded-lg border border-line p-3 text-sm">
        <div className="flex justify-between"><dt className="text-mute">Your bid</dt><dd className="tabular">{formatEur(amount)}</dd></div>
        <div className="flex justify-between">
          <dt className="text-mute">Buyer&apos;s premium (5%, min €350, max €3,500)</dt>
          <dd className="tabular">{formatEur(premium)}</dd>
        </div>
        <div className="flex justify-between border-t border-line pt-1.5 font-bold">
          <dt>Total if you win</dt><dd className="tabular">{formatEur(amount + premium)}</dd>
        </div>
      </dl>

      {error && <p role="alert" className="text-sm text-signal">{error}</p>}

      <Button size="lg" onClick={placeBid} disabled={busy || outpaced || amount <= 0}>
        {busy ? <><Loader2 className="animate-spin" aria-hidden /> Placing bid…</> : `Place bid of ${formatEur(amount)}`}
      </Button>
      <p className="text-xs text-mute">
        Bids are binding. A bid in the final two minutes adds two minutes to the clock.{" "}
        <Link href="/how-it-works#bidding" className="inline-block py-1 text-chalk underline underline-offset-4 hover:text-signal">
          How bidding works
        </Link>
      </p>
    </div>
  );
}

/** "Before your first bid": a plain summary of rules the system already enforces, then acceptance. */
function TermsStep({
  version,
  holdEur,
  onAccepted,
  onRecheck,
}: {
  version: string;
  holdEur: number;
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
        <DialogTitle>Before your first bid</DialogTitle>
        <DialogDescription id="bid-modal-desc" className="mt-1">
          How bidding on Biddr works:
        </DialogDescription>
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
