"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Loader2, Lock, Star } from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import { StatusIcon } from "@/components/status-icon";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatEur } from "@/lib/format";
import { stripeAppearance, stripePromise } from "@/lib/stripe-client";
import { joinFeaturedWaitlist } from "./actions";

export type FeatureOffer =
  | { state: "available"; priceEur: number }
  | { state: "full"; priceEur: number; waitlisted: boolean }
  | { state: "featured"; priceEur: number; until: string | null; paid: boolean; invoice: { id: string; number: string } | null; receipt: { id: string; number: string } | null };

const SEAT_TEXT = "Shown in the featured carousel on Biddr's home page, labelled \"Featured\", until the auction ends.";
const REFUND_TEXT =
  "If you withdraw the auction before it goes live, or Biddr removes the seat, you get your money back automatically. Once the auction has gone live there's no automatic refund.";

async function confirmOnServer(paymentIntentId: string): Promise<"paid" | "refunded" | null> {
  const res = await fetch("/api/premium-seat/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paymentIntentId }),
  }).catch(() => null);
  const body = (await res?.json().catch(() => null)) as { status?: "paid" | "refunded" } | null;
  return res?.ok ? (body?.status ?? null) : null;
}

/**
 * "Feature this car" on My listings: an optional, paid premium seat for a scheduled or live
 * auction (DECISIONS.md point 11). The price, what it gives and the refund rules are shown
 * before paying; the card is taken by Stripe's Payment Element.
 */
export function FeatureCar({ auctionId, title, offer }: { auctionId: string; title: string; offer: FeatureOffer }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [secret, setSecret] = useState<{ clientSecret: string; amountEur: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waitlisted, setWaitlisted] = useState(offer.state === "full" && offer.waitlisted);
  const [done, setDone] = useState<string | null>(null);

  if (offer.state === "featured") {
    return (
      <div data-feature-state="featured" className="space-y-1 rounded-md border border-line p-2.5 text-sm">
        <p className="flex items-center gap-2">
          <StatusIcon kind="passed" className="size-4" />
          <span>
            <span className="font-semibold">Featured</span> on the home page until <LocalDateTime iso={offer.until} />
          </span>
        </p>
        {offer.invoice || offer.receipt ? (
          <p className="flex flex-wrap gap-x-4 pl-6">
            {offer.invoice ? (
              <a href={`/api/invoices/${offer.invoice.id}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-signal">
                Invoice {offer.invoice.number} (PDF)
              </a>
            ) : null}
            {offer.receipt ? (
              <a href={`/api/receipts/${offer.receipt.id}`} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center underline underline-offset-4 hover:text-signal">
                Receipt {offer.receipt.number} (PDF)
              </a>
            ) : null}
          </p>
        ) : null}
      </div>
    );
  }

  if (offer.state === "full") {
    return (
      <div data-feature-state="full" className="space-y-2 rounded-md border border-line p-2.5 text-sm">
        <p className="flex gap-2">
          <StatusIcon kind="waiting" className="mt-0.5 size-4" />
          <span>All featured places are taken right now.</span>
        </p>
        {waitlisted ? (
          <p role="status" className="pl-6 text-mute">
            We&apos;ll notify you when a place frees up.
          </p>
        ) : (
          <form
            action={async () => {
              const r = await joinFeaturedWaitlist({ auctionId });
              if (r.ok) setWaitlisted(true);
              else setError(r.error);
            }}
            className="pl-6"
          >
            <Button type="submit" variant="outline" className="min-h-11" aria-label={`Notify me when a place frees up: ${title}`}>
              Notify me when a place frees up
            </Button>
          </form>
        )}
        {error ? (
          <p role="alert" className="text-status-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  async function start() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/premium-seat/intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auctionId }),
    }).catch(() => null);
    setBusy(false);
    const body = (await res?.json().catch(() => null)) as { clientSecret?: string; amountEur?: number; error?: string; full?: boolean } | null;
    if (!res?.ok || !body?.clientSecret) {
      setError(body?.error ?? "The payment couldn't start. Check your connection and try again.");
      if (body?.full) router.refresh();
      return;
    }
    setSecret({ clientSecret: body.clientSecret, amountEur: body.amountEur ?? offer.priceEur });
  }

  return (
    <div data-feature-state="available">
      <Button type="button" variant="outline" className="min-h-11" onClick={() => setOpen(true)} aria-label={`Feature this car: ${title}`}>
        <Star aria-hidden />
        Feature this car
      </Button>
      {done ? (
        <p role="status" className="mt-2 text-sm">
          {done}
        </p>
      ) : null}
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setSecret(null);
            setError(null);
          }
        }}
      >
        <DialogContent aria-describedby="feature-desc">
          <div className="space-y-3">
            <DialogTitle>Feature this car</DialogTitle>
            <DialogDescription id="feature-desc">
              <span className="block font-semibold text-chalk">{formatEur(offer.priceEur)}, VAT included</span>
              <span className="mt-1 block">{SEAT_TEXT}</span>
            </DialogDescription>
            <p className="text-sm text-mute">{REFUND_TEXT}</p>
            <p className="text-sm text-mute">Optional: your auction runs the same without it. You get an invoice and a receipt.</p>
            {secret ? (
              <Elements stripe={stripePromise} options={{ clientSecret: secret.clientSecret, appearance: stripeAppearance }}>
                <SeatPayForm
                  auctionId={auctionId}
                  amountEur={secret.amountEur}
                  onPaid={(status) => {
                    setOpen(false);
                    setSecret(null);
                    setDone(
                      status === "refunded"
                        ? "The payment went through, but the car couldn't be featured any more, so it was refunded straight away."
                        : "Paid. Your car is featured on the home page until the auction ends.",
                    );
                    router.refresh();
                  }}
                />
              </Elements>
            ) : (
              <Button type="button" size="lg" className="w-full" onClick={() => void start()} disabled={busy}>
                {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
                Continue to payment
              </Button>
            )}
            {error ? (
              <p role="alert" className="text-sm text-status-danger">
                {error}
              </p>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SeatPayForm({ auctionId, amountEur, onPaid }: { auctionId: string; amountEur: number; onPaid: (status: "paid" | "refunded") => void }) {
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
      confirmParams: { return_url: `${window.location.origin}/account/listings?seat=return&auction=${auctionId}` },
    });
    if (stripeError) {
      setBusy(false);
      setError(
        stripeError.type === "card_error" || stripeError.type === "validation_error"
          ? `${stripeError.message ?? "Your card was declined."} Nothing was charged. Try again or use another card.`
          : "The payment didn't go through. Check your connection and try again.",
      );
      return;
    }
    const status = paymentIntent?.status === "succeeded" ? await confirmOnServer(paymentIntent.id) : null;
    setBusy(false);
    if (status) onPaid(status);
    else setError("The payment didn't go through. Try again or use another card.");
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <PaymentElement options={{ layout: "tabs" }} />
      {error ? (
        <p role="alert" className="text-sm text-status-danger">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="lg" disabled={!stripe || busy}>
        {busy ? (
          <>
            <Loader2 className="animate-spin" aria-hidden /> Paying…
          </>
        ) : (
          `Pay ${formatEur(amountEur)}`
        )}
      </Button>
      <p className="flex items-center gap-1.5 text-xs text-mute">
        <Lock className="size-3 shrink-0" aria-hidden /> Card details are handled by Stripe.
      </p>
    </form>
  );
}

/** Back from a 3-D Secure redirect: confirm on the server, say what happened, clean the address. */
export function SeatPaymentReturn() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const handled = useRef(false);
  const [result, setResult] = useState<"paid" | "refunded" | "failed" | null>(null);
  useEffect(() => {
    const pi = params.get("payment_intent");
    if (handled.current || params.get("seat") !== "return" || !pi) return;
    handled.current = true;
    void (async () => {
      const status = params.get("redirect_status") === "failed" ? null : await confirmOnServer(pi);
      setResult(status ?? "failed");
      router.replace(pathname, { scroll: false });
      router.refresh();
    })();
  }, [params, pathname, router]);
  if (!result) return null;
  return (
    <p role="status" className="mt-6 rounded-md border border-line bg-panel p-3 text-sm">
      {result === "paid"
        ? "Paid. Your car is featured on the home page until the auction ends."
        : result === "refunded"
          ? "The payment went through, but the car couldn't be featured any more, so it was refunded straight away."
          : "The payment didn't go through. Nothing was charged; you can try again."}
    </p>
  );
}
