import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { STATUS_BOX_CLASS, StatusIcon, type StatusKind } from "@/components/status-icon";
import { Button } from "@/components/ui/button";
import { syncIdentityOnReturn } from "@/lib/identity";
import { CHALLENGE_MINUTES } from "@/lib/listing-checks/challenge";
import { loadVerificationModels } from "@/lib/listing-checks/load-model";
import { loadVerification } from "@/lib/listing-checks/run";
import type { ResultStatus, RowStatus } from "@/lib/listing-checks/verification-model";
import { loginPath } from "@/lib/login";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";
import { ChallengeCamera } from "./challenge-camera";
import { DocumentsForm } from "./documents-form";
import { IdentityButton } from "./identity-button";
import { InputList } from "./input-list";
import { SubmitForChecking } from "./submit-for-checking";

export const metadata: Metadata = { title: "Verify your car", robots: { index: false } };
export const dynamic = "force-dynamic";
// The checks read the photos and documents with Claude and search the photos: up to a minute.
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fileName(path: string): string {
  const kind = path.includes("/authorisation-") ? "Authorisation" : "Registration certificate";
  return `${kind} (${path.split(".").pop()?.toUpperCase()})`;
}

const RESULT_KIND: Record<ResultStatus, StatusKind> = { checking: "waiting", passed: "passed", approved: "passed", attention: "attention", failed: "failed" };
const ROW_KIND: Record<RowStatus, StatusKind> = { waiting: "waiting", passed: "passed", attention: "attention", failed: "failed" };
const ROW_WORD: Record<RowStatus, string> = { waiting: "Waiting", passed: "Passed", attention: "Needs attention", failed: "Failed" };

/**
 * "Verify your car" (DECISIONS.md points 16 and 18), in three separate blocks: how it
 * works, what we need from you (inputs: added or not), and the check results (only after
 * submitting). Adding something is never shown as passing.
 */
export default async function VerifyPage({ params, searchParams }: { params: { id: string }; searchParams?: { identity?: string } }) {
  if (!UUID_RE.test(params.id)) notFound();
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(loginPath(`/account/listings/${params.id}/verify`));

  const { data: auction } = await supabase
    .from("auctions")
    .select("id, title, status, seller_id, created_at")
    .eq("id", params.id)
    .maybeSingle<{ id: string; title: string; status: string; seller_id: string; created_at: string }>();
  if (!auction || auction.seller_id !== user.id) notFound();

  const admin = getAdminSupabase();
  // Back from Stripe's identity page: read its state first.
  if (searchParams?.identity === "return") await syncIdentityOnReturn(admin, user.id);
  const [v, models] = await Promise.all([loadVerification(admin, auction.id), loadVerificationModels(admin, user.id, [auction])]);
  const model = models.get(auction.id)!;
  const codeValid = v?.challenge_code && v.challenge_expires_at && Date.parse(v.challenge_expires_at) > Date.now();
  const returnTo = `/account/listings/${auction.id}/verify`;

  const results = model.result ? (
    <section aria-labelledby="results-heading" data-result={model.result.status} className="rounded-lg border border-line bg-panel p-4">
      <h2 id="results-heading" className="text-lg font-bold">
        Check results
      </h2>
      <div role="status" className={cn("mt-3 rounded-md border p-3", STATUS_BOX_CLASS[RESULT_KIND[model.result.status]])}>
        <p className="flex items-start gap-3">
          <StatusIcon kind={RESULT_KIND[model.result.status]} animate className="mt-0.5 size-5" />
          <span>
            <span className="block font-semibold">{model.result.title}</span>
            <span className="block text-sm">{model.result.text}</span>
          </span>
        </p>
        {model.result.action ? (
          <Button asChild className="mt-3 min-h-11 w-full sm:w-auto">
            <Link href={model.result.action.href}>{model.result.action.label}</Link>
          </Button>
        ) : null}
      </div>
      {model.rows.length ? (
        <ul className="mt-3 divide-y divide-line">
          {model.rows.map((r) => (
            <li key={r.key} data-check={r.key} data-state={r.status} className="flex gap-3 py-2.5 text-sm">
              <StatusIcon kind={ROW_KIND[r.status]} className="mt-0.5 size-5" />
              <div className="min-w-0">
                <p className="font-semibold">
                  {r.label}: <span className="font-normal">{ROW_WORD[r.status]}</span>
                </p>
                <p className="text-mute">{r.text}</p>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  ) : null;

  return (
    <main className="container max-w-2xl py-8">
      <Link href="/account/listings" className="inline-flex min-h-11 items-center text-sm text-mute hover:text-chalk">
        ← My listings
      </Link>
      <h1 className="mt-1 font-wide text-2xl font-extrabold tracking-tight sm:text-3xl">Verify your car</h1>
      <p className="mt-1 text-sm text-mute">{auction.title}</p>

      {/* "Checking…" appears here while the checks run; after submitting, the results come first. */}
      <div id="check-results-slot" className="mt-5 scroll-mt-20 empty:hidden" />
      {results ? <div className="mt-5">{results}</div> : null}

      <section aria-labelledby="how-heading" className="mt-6 rounded-lg border border-line bg-panel p-4">
        <h2 id="how-heading" className="text-lg font-bold">
          How verification works
        </h2>
        <p className="mt-2 text-sm">
          We check that the car exists, that you own it and that its details match your listing. It protects buyers and
          helps your car sell. It usually takes a few minutes.
        </p>
        <p className="mt-2 text-sm text-mute">Your documents are only seen by Biddr. Buyers see a Verified seller badge.</p>
      </section>

      <section id="what-we-need" aria-labelledby="need-heading" className="mt-6 scroll-mt-20 space-y-4 rounded-lg border border-line bg-panel p-4">
        <h2 id="need-heading" className="text-lg font-bold">
          What we need from you
        </h2>
        <p className="text-sm text-mute">
          Add these in any order. The two photos are taken here at the car with a code that&apos;s valid for {CHALLENGE_MINUTES} minutes;
          everything else can be added any time.
        </p>
        <InputList
          items={model.items}
          editable={model.editable}
          identityAction={<IdentityButton label="Start" returnTo={returnTo} />}
          panels={{
            registration: (
              <DocumentsForm
                auctionId={auction.id}
                userId={user.id}
                locked={!model.editable}
                initial={{
                  registration: (v?.registration_paths ?? []).map((p) => ({ path: p, name: fileName(p) })),
                  sellerIsOwner: v?.seller_is_owner ?? true,
                  authorisation: (v?.authorisation_paths ?? []).map((p) => ({ path: p, name: fileName(p) })),
                }}
              />
            ),
            photos: (
              <ChallengeCamera
                auctionId={auction.id}
                userId={user.id}
                initialCode={codeValid ? v!.challenge_code : null}
                initialExpiresAt={codeValid ? v!.challenge_expires_at : null}
                done={Boolean(v?.vin_photo_path && v?.odometer_photo_path)}
              />
            ),
          }}
        />
        {model.locked ? (
          <p className="text-sm text-mute">
            {auction.status !== "draft" ? "This listing isn't waiting for review, so nothing can be changed here." : "These can't be changed now."}
          </p>
        ) : !model.submitted ? (
          <SubmitForChecking
            auctionId={auction.id}
            ready={model.ready}
            progress={`${model.requiredAdded} of ${model.requiredTotal} required items added`}
          />
        ) : model.editable ? (
          <p className="text-sm text-mute">Change what the result asks for, then submit for checking again.</p>
        ) : (
          <p className="text-sm text-mute">Submitted for checking. These can&apos;t be changed unless a result asks for it.</p>
        )}
      </section>
    </main>
  );
}
