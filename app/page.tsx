import { Suspense } from "react";
import { AuctionFeed } from "@/components/auction/auction-feed";
import { AuctionFilters, STATUS_TABS, type FeedStatus } from "@/components/auction/auction-filters";
import { getServerSupabase } from "@/lib/supabase/server";
import { AUCTION_CARD_COLUMNS, type AuctionCard, type Country } from "@/lib/types";

export const dynamic = "force-dynamic";

type SearchParams = { status?: string; make?: string; country?: string; condition?: string };

const COUNTRIES: readonly Country[] = ["EE", "LV", "LT"];

function parseStatus(v: string | undefined): FeedStatus {
  return STATUS_TABS.some((t) => t.value === v) ? (v as FeedStatus) : "live";
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = getServerSupabase();
  const status = parseStatus(searchParams.status);
  const now = Date.now();

  let query = supabase.from("auctions").select(AUCTION_CARD_COLUMNS).limit(48);

  switch (status) {
    case "live":
      query = query.eq("status", "live").order("ends_at", { ascending: true });
      break;
    case "ending":
      query = query
        .eq("status", "live")
        .lte("ends_at", new Date(now + 24 * 3600 * 1000).toISOString())
        .order("ends_at", { ascending: true });
      break;
    case "upcoming":
      query = query.eq("status", "upcoming").order("starts_at", { ascending: true });
      break;
    case "past":
      query = query.in("status", ["ended", "sold", "reserve_not_met"]).order("ends_at", { ascending: false });
      break;
  }

  if (searchParams.make) query = query.ilike("make", searchParams.make.replace(/[\\%_]/g, (c) => `\\${c}`));
  if (searchParams.country && COUNTRIES.includes(searchParams.country as Country)) {
    query = query.eq("location_country", searchParams.country);
  }
  if (searchParams.condition === "clean") query = query.eq("condition_type", "clean");
  if (searchParams.condition === "restored") {
    query = query.eq("condition_type", "restored_accident").not("inspection_partner_name", "is", null);
  }

  const [{ data, error }, { data: makeRows }] = await Promise.all([
    query.returns<AuctionCard[]>(),
    supabase.from("auctions").select("make").neq("status", "draft").returns<{ make: string }[]>(),
  ]);

  const makes = Array.from(new Set((makeRows ?? []).map((r) => r.make))).sort((a, b) => a.localeCompare(b));
  const hasFilters = Boolean(searchParams.make || searchParams.country || searchParams.condition);

  return (
    <main className="container flex flex-col gap-6 py-6 pb-16 md:py-10">
      <div className="max-w-2xl">
        <h1 className="font-wide text-3xl font-extrabold tracking-tight md:text-4xl">
          Performance cars, bid on in the open.
        </h1>
        <p className="mt-2 text-mute">
          M, RS, AMG and Porsche from Tallinn, Riga and Vilnius. Restored cars are listed only with an
          independent workshop inspection you can read before you bid.
        </p>
      </div>

      <Suspense>
        <AuctionFilters makes={makes} status={status} />
      </Suspense>

      {error ? (
        <div role="alert" className="rounded-lg border border-line bg-panel p-6">
          <p className="font-semibold">Auctions couldn&apos;t load.</p>
          <p className="mt-1 text-sm text-mute">Refresh the page to try again.</p>
        </div>
      ) : (
        <AuctionFeed initial={data ?? []} initialNow={now} featureFirst={status === "live" && !hasFilters} />
      )}
    </main>
  );
}
