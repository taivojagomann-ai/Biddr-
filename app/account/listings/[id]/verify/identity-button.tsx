"use client";
import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { verifyIdentity } from "./actions";

/** Starts (or continues) Stripe Identity: the browser goes to Stripe's page and comes back to `returnTo`. */
export function IdentityButton({ label = "Verify your identity", returnTo = "/account/listings" }: { label?: string; returnTo?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button
        type="button"
        className="min-h-11"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const r = await verifyIdentity({ returnTo });
            if (r.ok && r.url) {
              // Stays busy while the browser goes to Stripe's page.
              window.location.assign(r.url);
              return;
            }
            setError(r.ok ? "The identity check couldn't start. Try again in a moment." : r.error);
          } catch {
            setError("The identity check couldn't start. Try again in a moment.");
          }
          setBusy(false);
        }}
      >
        {busy ? <Loader2 aria-hidden className="animate-spin" /> : <ShieldCheck aria-hidden />}
        {label}
      </Button>
      {error ? (
        <p role="alert" className="text-sm text-signal">
          {error}
        </p>
      ) : null}
    </div>
  );
}
