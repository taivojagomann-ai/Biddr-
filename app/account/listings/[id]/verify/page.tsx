import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, CheckCircle2, Circle, Clock, ShieldCheck } from "lucide-react";
import { CHALLENGE_MINUTES } from "@/lib/listing-checks/challenge";
import { IDENTITY_COLUMNS, type IdentityRow } from "@/lib/identity";
import { loadVerification } from "@/lib/listing-checks/run";
import { IDENTITY_REQUEST, sellerSummary, sellerView } from "@/lib/listing-checks/seller-status";
import { loginPath } from "@/lib/login";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ChallengeCamera } from "./challenge-camera";
import { DocumentsForm } from "./documents-form";
import { IdentityButton } from "./identity-button";
import { RunChecksButton } from "./run-checks-button";

export const metadata: Metadata = { title: "Verify your car", robots: { index: false } };
export const dynamic = "force-dynamic";
// The checks read the photos and documents with Claude and search the photos: up to a minute.
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fileName(path: string): string {
  const kind = path.includes("/authorisation-") ? "Authorisation" : "Registration certificate";
  return `${kind} (${path.split(".").pop()?.toUpperCase()})`;
}

type StepState = "done" | "needed" | "later";

/** Each step's own state, next to its heading: a green tick when it's done. */
function StepStatus({ state }: { state: StepState }) {
  if (state === "done") {
    return (
      <span data-step-status="done" className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-verified">
        <CheckCircle2 aria-hidden className="size-5" />
        Done
      </span>
    );
  }
  return (
    <span data-step-status={state} className="inline-flex shrink-0 items-center gap-1.5 text-sm font-semibold text-signal">
      <Circle aria-hidden className="size-5" />
      {state === "needed" ? "Needed" : "After approval"}
    </span>
  );
}

/**
 * "Verify your car" (DECISIONS.md point 16): the registration certificate, two photos at
 * the car with a live code, and, once the listing is approved, the seller's identity.
 */
export default async function VerifyPage({ params }: { params: { id: string } }) {
  if (!UUID_RE.test(params.id)) notFound();
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(loginPath(`/account/listings/${params.id}/verify`));

  const { data: auction } = await supabase
    .from("auctions")
    .select("id, title, status, seller_id")
    .eq("id", params.id)
    .maybeSingle<{ id: string; title: string; status: string; seller_id: string }>();
  if (!auction || auction.seller_id !== user.id) notFound();

  const admin = getAdminSupabase();
  const [v, { data: me }] = await Promise.all([
    loadVerification(admin, auction.id),
    admin.from("profiles").select(IDENTITY_COLUMNS).eq("id", user.id).maybeSingle<IdentityRow>(),
  ]);
  const identityStatus = me?.identity_status ?? "none";
  const view = sellerView(v, identityStatus);
  const summary = sellerSummary(view);
  const inReview = auction.status === "draft";
  const locked = !inReview || (view.onHold && !view.canRetry) || Boolean(v?.files_purged_at);
  const codeValid = v?.challenge_code && v.challenge_expires_at && Date.parse(v.challenge_expires_at) > Date.now();
  const docsStep: StepState = view.hasDocuments ? "done" : "needed";
  const photosStep: StepState = view.hasPhotos ? "done" : "needed";
  const identityStep: StepState = view.identityVerified ? "done" : view.contentApproved ? "needed" : "later";
  const Icon = summary.tone === "ok" ? CheckCircle2 : summary.tone === "bad" ? AlertTriangle : Clock;

  return (
    <main className="container max-w-2xl py-8">
      <Link href="/account/listings" className="inline-flex min-h-11 items-center text-sm text-mute hover:text-chalk">
        ← My listings
      </Link>
      <h1 className="mt-1 font-wide text-2xl font-extrabold tracking-tight sm:text-3xl">Verify your car</h1>
      <p className="mt-1 text-sm text-mute">{auction.title}</p>
      <p className="mt-3 text-sm">
        Biddr checks every car automatically before it goes live: that you have the car, and that its VIN and mileage match
        the listing. It takes a few minutes at the car.
      </p>
      <div className="mt-3 rounded-md border border-line bg-panel p-3 text-sm">
        <p className="font-semibold">You need both, in any order:</p>
        <ol className="mt-1 list-decimal space-y-1 pl-5">
          <li>
            <a href="#docs-heading" className="underline underline-offset-4 hover:text-signal">The registration certificate</a>: add it any time.
          </li>
          <li>
            <a href="#photos-heading" className="underline underline-offset-4 hover:text-signal">Two photos at the car</a>: only these have a{" "}
            {CHALLENGE_MINUTES}-minute code.
          </li>
        </ol>
        <p className="mt-1 text-mute">The checks start automatically when both are added.</p>
      </div>

      <p
        role="status"
        className={cn(
          "mt-5 flex gap-2 rounded-md border p-3 text-sm",
          summary.tone === "ok" ? "border-verified/60 bg-verified/10" : summary.tone === "bad" ? "border-signal/60 bg-signal/10" : "border-line bg-panel",
        )}
      >
        <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", summary.tone === "ok" ? "text-verified" : summary.tone === "bad" ? "text-signal" : "text-mute")} />
        {summary.text}
      </p>
      {inReview && !locked && view.hasDocuments && view.hasPhotos ? <RunChecksButton auctionId={auction.id} needed={!view.checked} /> : null}
      {view.reasons.length ? (
        <div className="mt-3 rounded-md border border-signal/40 p-3 text-sm">
          <p className="font-semibold">What didn&apos;t match</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {view.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {view.canRetry ? (
            <p className="mt-2 text-mute">
              You can try once more: correct the document or take the photos again with a new code. If the listing has a
              typo (for example in the VIN or the mileage),{" "}
              <Link href={`/account/listings/${auction.id}/edit`} className="font-semibold text-chalk underline underline-offset-4 hover:text-signal">
                edit the listing
              </Link>
              : the checks run again right away.
            </p>
          ) : null}
        </div>
      ) : null}

      {!inReview ? <p className="mt-5 text-sm text-mute">This listing isn&apos;t waiting for review, so nothing can be changed here.</p> : null}

      <section aria-labelledby="docs-heading" className={cn("mt-8 rounded-lg border border-line bg-panel p-4", docsStep === "done" && "border-verified/60")}>
        <div className="flex items-start justify-between gap-3">
          <h2 id="docs-heading" className="text-lg font-bold">
            1. Registration certificate
          </h2>
          <StepStatus state={docsStep} />
        </div>
        {view.hasPhotos && !view.hasDocuments && !locked ? (
          <p className="mt-2 rounded-md border border-signal/60 bg-signal/10 p-3 text-sm font-semibold">
            Your photos are saved. Add the registration certificate here to run the checks.
          </p>
        ) : null}
        <div className="mt-3">
          <DocumentsForm
            auctionId={auction.id}
            userId={user.id}
            locked={locked}
            initial={{
              registration: (v?.registration_paths ?? []).map((p) => ({ path: p, name: fileName(p) })),
              sellerIsOwner: v?.seller_is_owner ?? true,
              authorisation: (v?.authorisation_paths ?? []).map((p) => ({ path: p, name: fileName(p) })),
            }}
          />
        </div>
      </section>

      <section aria-labelledby="photos-heading" className={cn("mt-6 rounded-lg border border-line bg-panel p-4", photosStep === "done" && "border-verified/60")}>
        <div className="flex items-start justify-between gap-3">
          <h2 id="photos-heading" className="text-lg font-bold">
            2. Two photos at the car
          </h2>
          <StepStatus state={photosStep} />
        </div>
        <p className="mt-1 text-sm text-mute">
          You get a code, write it on a paper and take two photos with this page: the VIN plate and the odometer, each with the paper.
        </p>
        {view.hasDocuments && !view.hasPhotos && !locked ? (
          <p className="mt-2 rounded-md border border-signal/60 bg-signal/10 p-3 text-sm font-semibold">
            Your documents are saved. Take the two photos at the car to run the checks.
          </p>
        ) : null}
        <div className="mt-3">
          {locked ? (
            <p className="text-sm text-mute">{view.hasPhotos ? "Both photos are sent." : "Photos can't be added now."}</p>
          ) : (
            <ChallengeCamera
              auctionId={auction.id}
              userId={user.id}
              initialCode={codeValid ? v!.challenge_code : null}
              initialExpiresAt={codeValid ? v!.challenge_expires_at : null}
              done={view.hasPhotos}
            />
          )}
        </div>
      </section>

      <section aria-labelledby="identity-heading" className={cn("mt-6 rounded-lg border border-line bg-panel p-4", identityStep === "done" && "border-verified/60")}>
        <div className="flex items-start justify-between gap-3">
          <h2 id="identity-heading" className="text-lg font-bold">
            3. Your identity
          </h2>
          <StepStatus state={identityStep} />
        </div>
        {view.identityVerified ? (
          <p className="mt-2 flex items-center gap-2 text-sm text-verified">
            <ShieldCheck aria-hidden className="size-4" />
            Your identity is verified. Buyers see &quot;Verified seller&quot; on your listings.
          </p>
        ) : view.contentApproved ? (
          <div className="mt-2 space-y-3">
            <p className="text-sm font-semibold">{IDENTITY_REQUEST}</p>
            <p className="text-sm text-mute">
              On Stripe&apos;s page you take a photo of your ID and a selfie. It takes about two minutes and is done once for all
              your listings. Biddr keeps only your verified name and the document&apos;s country.
            </p>
            {identityStatus === "pending" ? <p className="text-sm text-mute">Your identity check is in progress.</p> : null}
            {identityStatus === "requires_input" ? <p className="text-sm text-signal">The last check didn&apos;t go through. Please try again.</p> : null}
            {identityStatus !== "pending" ? <IdentityButton /> : null}
          </div>
        ) : (
          <p className="mt-2 text-sm text-mute">
            When Biddr approves your listing, we&apos;ll ask you to verify your identity with Stripe (once, for all your listings).
          </p>
        )}
      </section>
    </main>
  );
}
