"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { Loader2, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatEur } from "@/lib/format";
import { stripeAppearance, stripePromise } from "@/lib/stripe-client";

async function confirmOnServer(paymentIntentId: string): Promise<boolean> {
  const res = await fetch("/api/stripe/premium/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paymentIntentId }),
  }).catch(() => null);
  return Boolean(res?.ok);
}

/** "Complete payment": pays what's left of the buyer's premium with the Stripe Payment Element (3-D Secure when needed). */
export function CompletePayment({ auctionId, title }: { auctionId: string; title: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<{ clientSecret: string; amountEur: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function start() {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/stripe/premium/intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auctionId }),
    }).catch(() => null);
    setBusy(false);
    const body = (await res?.json().catch(() => null)) as { clientSecret?: string; amountEur?: number; error?: string } | null;
    if (!res?.ok || !body?.clientSecret) {
      setError(body?.error ?? "The payment couldn't start. Check your connection and try again.");
      return;
    }
    setState({ clientSecret: body.clientSecret, amountEur: body.amountEur ?? 0 });
    setOpen(true);
  }

  return (
    <>
      <Button type="button" onClick={() => void start()} disabled={busy} aria-describedby={error ? `pay-error-${auctionId}` : undefined}>
        {busy ? <Loader2 aria-hidden className="animate-spin" /> : null}
        Complete payment<span className="sr-only">: {title}</span>
      </Button>
      {error ? (
        <p id={`pay-error-${auctionId}`} role="alert" className="text-sm text-signal">
          {error}
        </p>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby="premium-pay-desc">
          {state ? (
            <Elements stripe={stripePromise} options={{ clientSecret: state.clientSecret, appearance: stripeAppearance }}>
              <PayForm
                auctionId={auctionId}
                amountEur={state.amountEur}
                onPaid={() => {
                  setOpen(false);
                  router.refresh();
                }}
              />
            </Elements>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

function PayForm({ auctionId, amountEur, onPaid }: { auctionId: string; amountEur: number; onPaid: () => void }) {
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
      confirmParams: { return_url: `${window.location.origin}/account/purchases?premium=return&auction=${auctionId}` },
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
    if (paymentIntent?.status === "succeeded" && (await confirmOnServer(paymentIntent.id))) {
      setBusy(false);
      onPaid();
      return;
    }
    setBusy(false);
    setError("The payment didn't go through. Try again or use another card.");
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <DialogTitle>Pay the buyer&apos;s premium</DialogTitle>
        <DialogDescription id="premium-pay-desc" className="mt-1">
          {formatEur(amountEur)} to Biddr. The car itself is paid directly to the seller.
        </DialogDescription>
      </div>
      <PaymentElement options={{ layout: "tabs" }} />
      {error ? (
        <p role="alert" className="text-sm text-signal">
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
export function PaymentReturn() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const handled = useRef(false);
  const [result, setResult] = useState<"paid" | "failed" | null>(null);

  useEffect(() => {
    const pi = params.get("payment_intent");
    if (handled.current || params.get("premium") !== "return" || !pi) return;
    handled.current = true;
    void (async () => {
      const ok = params.get("redirect_status") !== "failed" && (await confirmOnServer(pi));
      setResult(ok ? "paid" : "failed");
      router.replace(pathname, { scroll: false });
      router.refresh();
    })();
  }, [params, pathname, router]);

  if (!result) return null;
  return (
    <p role={result === "paid" ? "status" : "alert"} className="mt-6 rounded-md border border-line bg-panel px-3 py-2 text-sm">
      {result === "paid"
        ? "Payment complete. The seller's contact details are below."
        : "Your bank didn't approve the payment, so nothing was charged. Try again with Complete payment, or use another card."}
    </p>
  );
}
