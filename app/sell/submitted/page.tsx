import type { Metadata } from "next";
import Link from "next/link";
import { CircleCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatEur } from "@/lib/format";
import { seatSettings } from "@/lib/premium-seat";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Listing submitted" };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REVIEW = { title: "We review your listing", body: "We check the details and photos, and ask you if anything is missing." };

const STEPS_WITH_INSPECTION = [
  {
    title: "We review your listing and the dealer report",
    body: "We check the details and photos, and that the report is from an authorised dealer of the brand and matches the car.",
  },
  { title: "We schedule the auction", body: "Once we approve the listing, we agree the dates with you and it goes live." },
];

const STEPS_WITHOUT_INSPECTION = [
  REVIEW,
  { title: "We schedule the auction", body: "Once we approve the listing, we agree the dates with you and it goes live." },
];

export default async function SellSubmittedPage({ searchParams }: { searchParams: { id?: string | string[] } }) {
  const id = typeof searchParams.id === "string" && UUID_RE.test(searchParams.id) ? searchParams.id : null;
  const seatPrice = (await seatSettings(getAdminSupabase())).priceEur;

  let title: string | null = null;
  let dealerReport = false;
  if (id) {
    // RLS: sellers can read their own drafts, nobody else's.
    const { data } = await getServerSupabase()
      .from("auctions")
      .select("title")
      .eq("id", id)
      .maybeSingle<{ title: string }>();
    title = data?.title ?? null;
    if (title) {
      // auction_private is admin-only; RLS just showed this listing is the user's own
      // (or they're an admin), so read only whether a dealer report was provided with the service role.
      const { data: priv } = await getAdminSupabase()
        .from("auction_private")
        .select("dealer_inspection_provided")
        .eq("auction_id", id)
        .maybeSingle<{ dealer_inspection_provided: boolean | null }>();
      dealerReport = priv?.dealer_inspection_provided === true;
    }
  }
  const steps = dealerReport ? STEPS_WITH_INSPECTION : STEPS_WITHOUT_INSPECTION;

  return (
    <main className="container max-w-2xl py-12 sm:py-20">
      <CircleCheck aria-hidden className="size-10 text-status-success" />
      <h1 className="mt-4 font-wide text-3xl font-extrabold tracking-tight">Thanks, your car is submitted</h1>
      <p className="mt-2 text-mute">
        {title ? (
          <>
            <span className="text-chalk">{title}</span> is waiting for review.
          </>
        ) : (
          "Your listing is waiting for review."
        )}{" "}
        {dealerReport ? "We'll review your listing and check the dealer's inspection report." : "We'll review your listing."}
      </p>

      {id && title ? (
        <section aria-labelledby="verify-heading" className="mt-8 rounded-lg border border-signal/50 bg-panel p-4">
          <h2 id="verify-heading" className="text-lg font-bold">
            Next: verify your car
          </h2>
          <p className="mt-1 text-sm text-mute">
            Add what we need (your identity check, the registration certificate and two photos at the car with a code we give
            you), then submit it for checking. It usually takes a few minutes and is needed before the auction can be scheduled.
          </p>
          <Button asChild className="mt-3">
            <Link href={`/account/listings/${id}/verify`}>Verify your car</Link>
          </Button>
        </section>
      ) : null}

      {id && title ? (
        <section aria-labelledby="feature-heading" data-feature-offer className="mt-6 rounded-lg border border-line bg-panel p-4">
          <h2 id="feature-heading" className="text-lg font-bold">
            Optional: feature this car
          </h2>
          <p className="mt-1 text-sm text-mute">
            Once your auction is scheduled, you can give it a premium seat for {formatEur(seatPrice)} (VAT included): it&apos;s shown in
            the featured carousel on Biddr&apos;s home page, labelled &quot;Featured&quot;, until the auction ends. If you withdraw it before
            it goes live, you get your money back. Your auction runs the same without it.
          </p>
          <p className="mt-2 text-sm">
            Use <span className="font-semibold">Feature this car</span> on{" "}
            <Link href="/account/listings" className="font-semibold underline underline-offset-4 hover:text-signal">
              My listings
            </Link>{" "}
            when it&apos;s scheduled.
          </p>
        </section>
      ) : null}

      <h2 className="mt-10 text-lg font-bold">What happens next</h2>
      <ol className="mt-4 space-y-4">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-4 rounded-lg border border-line bg-panel p-4">
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line font-wide text-sm font-bold">
              {i + 1}
            </span>
            <div>
              <p className="font-semibold">{s.title}</p>
              <p className="text-sm text-mute">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-10 flex flex-wrap gap-3">
        <Button asChild variant="outline">
          <Link href="/account/listings">See my listings</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Browse auctions</Link>
        </Button>
      </div>
    </main>
  );
}
