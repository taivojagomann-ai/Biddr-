import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, CheckCircle2, Circle, Clock, XCircle } from "lucide-react";
import { CHALLENGE_MINUTES } from "@/lib/listing-checks/challenge";
import { IDENTITY_COLUMNS, syncIdentityOnReturn, type IdentityRow } from "@/lib/identity";
import { sellerChecklist, type CheckRow, type SellerCheckState } from "@/lib/listing-checks/seller-checklist";
import { IdentityPanel } from "@/components/identity-panel";
import { loadVerification } from "@/lib/listing-checks/run";
import { IDENTITY_REQUEST, sellerSummary, sellerView } from "@/lib/listing-checks/seller-status";
import { loginPath } from "@/lib/login";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ChallengeCamera } from "./challenge-camera";
import { DocumentsForm } from "./documents-form";
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

const CHECK_STATE_LABELS: Record<SellerCheckState, string> = { pass: "matches", look: "Biddr's team takes a look", fail: "doesn't match", waiting: "waiting" };

function CheckIcon({ state }: { state: SellerCheckState }) {
  const cls = "mt-0.5 size-5 shrink-0";
  if (state === "pass") return <CheckCircle2 aria-hidden className={cn(cls, "text-verified")} />;
  if (state === "fail") return <XCircle aria-hidden className={cn(cls, "text-signal")} />;
  if (state === "waiting") return <Clock aria-hidden className={cn(cls, "text-mute")} />;
  return <AlertTriangle aria-hidden className={cn(cls, "text-signal")} />;
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
export default async function VerifyPage({ params, searchParams }: { params: { id: string }; searchParams?: { identity?: string } }) {
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
  // Back from Stripe's identity page: read its state first.
  if (searchParams?.identity === "return") await syncIdentityOnReturn(admin, user.id);
  const [v, { data: me }, { data: checkRows }] = await Promise.all([
    loadVerification(admin, auction.id),
    admin.from("profiles").select(IDENTITY_COLUMNS).eq("id", user.id).maybeSingle<IdentityRow>(),
    admin
      .from("listing_checks")
      .select("run_id, check_name, status, extracted, reason")
      .eq("auction_id", auction.id)
      .order("checked_at", { ascending: false })
      .limit(12)
      .returns<(CheckRow & { run_id: string })[]>(),
  ]);
  // The latest run only.
  const latestRun = checkRows?.[0]?.run_id;
  const checklist = sellerChecklist((checkRows ?? []).filter((r) => r.run_id === latestRun));
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

      {checklist.length && view.checked ? (
        <section aria-labelledby="checks-heading" className="mt-6 rounded-lg border border-line bg-panel p-4">
          <h2 id="checks-heading" className="text-lg font-bold">
            What we checked
          </h2>
          <ul className="mt-3 divide-y divide-line">
            {checklist.map((c) => (
              <li key={c.key} data-seller-check={c.key} data-state={c.state} className="flex gap-3 py-2.5 text-sm">
                <CheckIcon state={c.state} />
                <div className="min-w-0">
                  <p className="font-semibold">
                    {c.label}
                    <span className="sr-only">: {CHECK_STATE_LABELS[c.state]}</span>
                  </p>
                  <p className="text-mute">{c.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
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
        <div className="mt-2">
          <IdentityPanel
            me={me ?? null}
            returnTo={`/account/listings/${auction.id}/verify`}
            intro={
              view.contentApproved ? (
                <p className="font-semibold text-chalk">{IDENTITY_REQUEST}</p>
              ) : (
                "Needed when Biddr approves your listing. You can also do it now: once, for all your listings."
              )
            }
          />
        </div>
      </section>
    </main>
  );
}
