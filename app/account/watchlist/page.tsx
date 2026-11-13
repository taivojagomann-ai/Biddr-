import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Car } from "lucide-react";
import { Countdown } from "@/components/auction/countdown";
import { formatEur } from "@/lib/format";
import { loginPath } from "@/lib/login";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Auction } from "@/lib/types";
import { cn } from "@/lib/utils";
import { RemoveFromWatchlist } from "./remove-button";

export const metadata: Metadata = { title: "Watchlist" };
export const dynamic = "force-dynamic";

type Watched = Pick<
  Auction,
  "id" | "title" | "status" | "current_bid" | "starting_bid" | "bid_count" | "ends_at" | "starts_at" | "gallery_urls" | "leading_bidder_id"
>;
type Row = { created_at: string; auction: Watched | null };

const OPEN = new Set(["live", "upcoming"]);

function result(a: Watched): string {
  switch (a.status) {
    case "sold":
      return a.current_bid ? `Sold for ${formatEur(a.current_bid)}` : "Sold";
    case "reserve_not_met":
      return a.current_bid ? `Reserve not met (high bid ${formatEur(a.current_bid)})` : "Reserve not met";
    case "ended":
      return "Ended with no bids";
    case "withdrawn":
      return "Withdrawn";
    default:
      return "Ended";
  }
}

export default async function WatchlistPage({ searchParams }: { searchParams: { tab?: string } }) {
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(loginPath("/account/watchlist"));

  // RLS: own watchlist rows only; auctions the user can no longer see come back as null.
  const { data } = await supabase
    .from("watchlist")
    .select("created_at, auction:auctions(id,title,status,current_bid,starting_bid,bid_count,ends_at,starts_at,gallery_urls,leading_bidder_id)")
    .order("created_at", { ascending: false })
    .returns<Row[]>();
  const all = (data ?? []).flatMap((r) => (r.auction ? [r.auction] : []));
  const open = all
    .filter((a) => OPEN.has(a.status))
    .sort((x, y) => Date.parse(x.ends_at ?? x.starts_at ?? "") - Date.parse(y.ends_at ?? y.starts_at ?? ""));
  const ended = all.filter((a) => !OPEN.has(a.status));
  const tab = searchParams.tab === "ended" ? "ended" : "open";
  const rows = tab === "open" ? open : ended;

  // Which of these cars the user has bid on, for "You're leading" / "Outbid".
  const ids = all.map((a) => a.id);
  const bidOn = new Set<string>();
  if (ids.length) {
    const { data: bids } = await supabase.from("bids").select("auction_id").eq("bidder_id", user.id).in("auction_id", ids);
    for (const b of bids ?? []) bidOn.add(b.auction_id as string);
  }
  const now = Date.now();

  const tabLink = (key: "open" | "ended", label: string, count: number) => (
    <Link
      href={key === "open" ? "/account/watchlist" : "/account/watchlist?tab=ended"}
      aria-current={tab === key ? "page" : undefined}
      className={cn(
        "-mb-px flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold",
        tab === key ? "border-signal text-chalk" : "border-transparent text-mute hover:text-chalk",
      )}
    >
      {label}
      <span className={cn("rounded-full px-2 py-0.5 text-xs tabular", tab === key ? "bg-signal text-asphalt" : "bg-line text-chalk")}>
        {count}
      </span>
    </Link>
  );

  return (
    <main className="container max-w-3xl py-10 sm:py-14">
      <h1 className="font-wide text-3xl font-extrabold tracking-tight">Watchlist</h1>

      <nav aria-label="Watchlist" className="mt-6 overflow-x-auto">
        <div className="flex min-w-max gap-1 border-b border-line">
          {tabLink("open", "Live and upcoming", open.length)}
          {tabLink("ended", "Ended", ended.length)}
        </div>
      </nav>

      {all.length === 0 ? (
        <div className="mt-8 rounded-lg border border-dashed border-line p-8 text-center">
          <p className="text-sm text-mute">Cars you watch appear here. Tap Watch on any listing to follow it.</p>
          <Link href="/" className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4">
            Browse auctions
          </Link>
        </div>
      ) : rows.length === 0 ? (
        <p className="mt-8 text-sm text-mute">
          {tab === "open" ? "None of the cars you watch are live or upcoming right now." : "None of the cars you watch have ended yet."}
        </p>
      ) : (
        <ul className="mt-6 divide-y divide-line rounded-lg border border-line bg-panel">
          {rows.map((a) => {
            const cover = a.gallery_urls?.exterior?.[0];
            const bid = bidOn.has(a.id);
            const leading = a.leading_bidder_id === user.id;
            const price = a.current_bid ?? a.starting_bid;
            return (
              <li key={a.id} className="flex items-center gap-3 p-3 sm:gap-4">
                <div className="relative aspect-[4/3] w-20 shrink-0 overflow-hidden rounded-md bg-asphalt sm:w-28">
                  {cover ? (
                    <Image src={cover} alt="" fill sizes="112px" className="object-cover" />
                  ) : (
                    <Car aria-hidden className="absolute inset-0 m-auto size-6 text-mute" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <Link href={`/auctions/${a.id}`} className="block truncate font-semibold underline-offset-4 hover:underline">
                    {a.title}
                  </Link>
                  <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    {OPEN.has(a.status) ? (
                      <>
                        <span>
                          <span className="text-mute">{a.current_bid ? "Current bid " : "Starting bid "}</span>
                          <span className="font-semibold tabular">{formatEur(price)}</span>
                        </span>
                        <Countdown endsAt={a.ends_at} startsAt={a.starts_at} status={a.status} initialNow={now} className="text-mute" />
                      </>
                    ) : (
                      <span className="text-mute">{result(a)}</span>
                    )}
                    {bid ? (
                      <span
                        className={cn(
                          "rounded-sm px-1.5 py-0.5 text-xs font-semibold",
                          leading ? "bg-verified/15 text-verified" : "bg-signal/15 text-signal",
                        )}
                      >
                        {leading ? (OPEN.has(a.status) ? "You're leading" : a.status === "sold" ? "You won" : "Your bid was highest") : "Outbid"}
                      </span>
                    ) : null}
                  </p>
                </div>
                <RemoveFromWatchlist auctionId={a.id} userId={user.id} title={a.title} />
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
