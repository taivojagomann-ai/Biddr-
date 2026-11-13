import { Suspense } from "react";
import { AuctionFeed } from "@/components/auction/auction-feed";
import { AuctionFilters } from "@/components/auction/auction-filters";
import { parseFeedStatus, type FeedStatus } from "@/lib/feed";
import { parseSearchQuery } from "@/lib/search";
import { getServerSupabase } from "@/lib/supabase/server";
import { AUCTION_CARD_COLUMNS, type AuctionCard, type AuctionSearchRow, type Country } from "@/lib/types";

export const dynamic = "force-dynamic";

type SearchParams = { status?: string; q?: string; country?: string; condition?: string };

const COUNTRIES: readonly Country[] = ["EE", "LV", "LT"];

/** Home page link keeping the given filters; empty values are left out. */
function homeHref(values: Record<string, string | null | undefined>): string {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value) next.set(key, value);
  const qs = next.toString();
  return qs ? `/?${qs}` : "/";
}

export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = getServerSupabase();
  const status = parseFeedStatus(searchParams.status);
  const q = parseSearchQuery(searchParams.q);
  const country = searchParams.country && COUNTRIES.includes(searchParams.country as Country) ? searchParams.country : null;
  const condition = searchParams.condition === "clean" || searchParams.condition === "restored" ? searchParams.condition : null;
  const now = Date.now();

  let data: AuctionCard[] | null;
  let error: unknown;
  let count: number | null;
  // With a search, how many past results exist (offered when the tab has none).
  let pastCount = 0;

  if (q) {
    // search_auctions (0012): every word must match, ordered like the tab with exact
    // model matches first; RLS applies (security invoker).
    const searchTab = (tab: FeedStatus, limit: number) =>
      supabase
        .rpc("search_auctions", {
          p_query: q, p_tab: tab, p_country: country, p_condition: condition, p_limit: limit, p_offset: 0,
        })
        .order("sort_rank", { ascending: true })
        .returns<AuctionSearchRow[]>();
    const res = await searchTab(status, 48);
    error = res.error;
    data = (res.data ?? []).map(({ sort_rank: _rank, total_count: _total, ...card }) => card);
    count = res.data?.[0] ? Number(res.data[0].total_count) : 0;
    if (!error && count === 0 && status !== "past") {
      const past = await searchTab("past", 1);
      pastCount = past.data?.[0] ? Number(past.data[0].total_count) : 0;
    }
  } else {
    // count: total matches for the tab (the grid shows up to 48), for the heading and announcement.
    let query = supabase.from("auctions").select(AUCTION_CARD_COLUMNS, { count: "exact" }).limit(48);

    switch (status) {
      case "live":
        query = query.eq("status", "live").order("ends_at", { ascending: true });
        break;
      case "newest":
        // When bidding opened, not when the car was submitted.
        query = query.eq("status", "live").order("starts_at", { ascending: false });
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

    if (country) query = query.eq("location_country", country);
    if (condition === "clean") query = query.eq("condition_type", "clean");
    if (condition === "restored") {
      query = query.eq("condition_type", "restored_accident").not("inspection_partner_name", "is", null);
    }

    const res = await query.returns<AuctionCard[]>();
    ({ data, error, count } = res);
  }

  // Which of the shown cars the signed-in user watches (RLS: own rows only).
  const { data: { user } } = await supabase.auth.getUser();
  let watchedIds: string[] = [];
  const shownIds = (data ?? []).map((a) => a.id);
  if (user && shownIds.length) {
    const { data: rows } = await supabase.from("watchlist").select("auction_id").in("auction_id", shownIds);
    watchedIds = (rows ?? []).map((r) => r.auction_id as string);
  }

  const hasFilters = Boolean(q || country || condition);
  const search = q
    ? {
        query: q,
        pastCount,
        pastHref: homeHref({ status: "past", q, country, condition }),
        clearHref: homeHref({ status: status === "live" ? null : status, country, condition }),
      }
    : null;

  return (
    <main className="container flex flex-col gap-6 py-6 pb-16 md:py-10">
      <div className="max-w-2xl">
        <h1 className="font-wide text-3xl font-extrabold tracking-tight md:text-4xl">
          Cars worth chasing
        </h1>
        <p className="mt-2 text-mute">
          Buy and sell exceptional performance cars with transparent bidding, documented service histories and
          independent inspections for restored cars.
        </p>
      </div>

      <Suspense>
        <AuctionFilters status={status} />
      </Suspense>

      {error ? (
        <div role="alert" className="rounded-lg border border-line bg-panel p-6">
          <p className="font-semibold">Auctions couldn&apos;t load.</p>
          <p className="mt-1 text-sm text-mute">Refresh the page to try again.</p>
        </div>
      ) : (
        <AuctionFeed
          initial={data ?? []}
          status={status}
          total={count ?? (data ?? []).length}
          initialNow={now}
          featureFirst={status === "live" && !hasFilters}
          search={search}
          userId={user?.id ?? null}
          watchedIds={watchedIds}
        />
      )}
    </main>
  );
}
