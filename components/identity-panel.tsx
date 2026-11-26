import { CircleCheck } from "lucide-react";
import { StatusIcon } from "@/components/status-icon";
import { IdentityButton } from "@/app/account/listings/[id]/verify/identity-button";
import { LocalDateTime } from "@/components/local-date-time";
import type { IdentityRow } from "@/lib/identity";

/**
 * The member's identity check, wherever it's shown (profile, My listings, Verify your car):
 * verified with the name and date, Stripe checking, not finished (closed early: continue),
 * didn't go through (try again), or not started.
 */
export function IdentityPanel({ me, returnTo, intro }: { me: Pick<IdentityRow, "identity_status" | "identity_verified_name" | "identity_verified_at" | "identity_session_id"> | null; returnTo: string; intro?: React.ReactNode }) {
  const status = me?.identity_status ?? "none";
  if (status === "verified") {
    return (
      <div data-identity-state="verified" className="space-y-1 text-sm">
        <p className="flex items-center gap-2 font-semibold text-status-success">
          <CircleCheck aria-hidden className="size-5" />
          Verified
        </p>
        <p>
          {me?.identity_verified_name ? <>{me.identity_verified_name}, verified </> : "Verified "}
          {me?.identity_verified_at ? (
            <>
              on <LocalDateTime iso={me.identity_verified_at} dateOnly />
            </>
          ) : null}{" "}
          with Stripe. Buyers see &quot;Verified seller&quot; on your listings.
        </p>
      </div>
    );
  }
  const started = Boolean(me?.identity_session_id);
  const state = status === "pending" ? "checking" : status === "requires_input" ? "failed" : started ? "unfinished" : "none";
  const text = {
    checking: "Stripe is checking your documents. This usually takes a few minutes; this page updates when it's done.",
    failed: "The last check didn't go through. Try again with a clear, well-lit photo of your ID.",
    unfinished: "You started the identity check but didn't finish it. Continue where you left off.",
    none: "Not verified yet.",
  }[state];
  const label = { checking: "Continue identity check", failed: "Try again", unfinished: "Continue identity check", none: "Verify your identity" }[state];
  return (
    <div data-identity-state={state} className="space-y-3 text-sm">
      {intro ? <div className="text-mute">{intro}</div> : null}
      <p className={state === "failed" ? "flex gap-2 text-status-warning" : "flex gap-2"}>
        <StatusIcon kind={state === "checking" ? "waiting" : state === "failed" ? "attention" : state === "unfinished" ? "added" : "not-added"} className="mt-0.5 size-4" />
        {text}
      </p>
      <IdentityButton label={label} returnTo={returnTo} />
      {state === "checking" ? <p className="text-xs text-mute">Closed Stripe&apos;s page before finishing? Continue with the button above.</p> : null}
      <p className="text-xs text-mute">
        On Stripe&apos;s page you take a photo of your ID and a selfie. It takes about two minutes and is done once for all your
        listings. Biddr keeps only your verified name and the document&apos;s country.
      </p>
    </div>
  );
}
