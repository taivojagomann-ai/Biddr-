"use client";
import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { verifyIdentity } from "./actions";

/** Starts Stripe Identity (the browser goes to Stripe's page and comes back). */
export function IdentityButton({ label = "Verify your identity" }: { label?: string }) {
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
          const r = await verifyIdentity();
          // On success the server redirects to Stripe; only errors come back here.
          setBusy(false);
          if (r && !r.ok) setError(r.error);
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
