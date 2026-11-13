import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getServerSupabase } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Listing submitted" };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const NEXT_STEPS = [
  { title: "We review your listing", body: "We check the details and photos, and ask you if anything is missing." },
  {
    title: "We contact you to book the inspection",
    body: "Our partner inspects the car in the city you chose. Bidders see the report.",
  },
  { title: "We schedule the auction", body: "Once the car passes inspection, we agree the dates with you and it goes live." },
];

export default async function SellSubmittedPage({ searchParams }: { searchParams: { id?: string | string[] } }) {
  const id = typeof searchParams.id === "string" && UUID_RE.test(searchParams.id) ? searchParams.id : null;

  let title: string | null = null;
  if (id) {
    // RLS: sellers can read their own drafts, nobody else's.
    const { data } = await getServerSupabase()
      .from("auctions")
      .select("title")
      .eq("id", id)
      .maybeSingle<{ title: string }>();
    title = data?.title ?? null;
  }

  return (
    <main className="container max-w-2xl py-12 sm:py-20">
      <CheckCircle2 aria-hidden className="size-10 text-verified" />
      <h1 className="mt-4 font-wide text-3xl font-extrabold tracking-tight">Thanks, your car is submitted</h1>
      <p className="mt-2 text-mute">
        {title ? (
          <>
            <span className="text-chalk">{title}</span> is waiting for review.
          </>
        ) : (
          "Your listing is waiting for review."
        )}
      </p>

      <h2 className="mt-10 text-lg font-bold">What happens next</h2>
      <ol className="mt-4 space-y-4">
        {NEXT_STEPS.map((s, i) => (
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
        <Button asChild>
          <Link href="/account/listings">See my listings</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Browse auctions</Link>
        </Button>
      </div>
    </main>
  );
}
