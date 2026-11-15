"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { RealtimePostgresUpdatePayload } from "@supabase/supabase-js";
import { AuctionCard } from "./auction-card";
import { FeaturedLot } from "./featured-lot";
import { setWatchCount } from "@/lib/client/watch-store";
import { compareForTab, tabLabel, type FeedStatus } from "@/lib/feed";
import { noResultsText, resultsCountText } from "@/lib/search";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { Auction, AuctionCard as AuctionCardData } from "@/lib/types";

/** An active search (?q=), worked out on the server. */
export interface FeedSearch {
  query: string;
  /** Matches in Past results, offered when this tab has none. */
  pastCount: number;
  pastHref: string;
  clearHref: string;
}

/** Grid of cards that stays live: bids, extensions and closings stream in over one channel. */
export function AuctionFeed({
  initial,
  initialNow,
  featureFirst = false,
  userId,
  watchedIds,
  status,
  total,
  search = null,
}: {
  initial: AuctionCardData[];
  initialNow: number;
  userId: string | null;
  /** Auctions the signed-in user watches (server-read, among the ones shown). */
  watchedIds: string[];
  /** Current tab: decides the order kept after Realtime updates, and the heading. */
  status: FeedStatus;
  /** Total matches for the tab and filters (the grid shows up to 48). */
  total: number;
  featureFirst?: boolean;
  search?: FeedSearch | null;
}) {
  const [auctions, setAuctions] = useState(initial);
  const watched = new Set(watchedIds);
  // Search results keep the server's order (exact model matches first).
  const sortRef = useRef<((a: AuctionCardData, b: AuctionCardData) => number) | null>(null);
  sortRef.current = search ? null : compareForTab(status);
  const query = search?.query ?? "";

  // After switching tabs, filters or searching (not on first load), say what's shown, politely.
  const [announcement, setAnnouncement] = useState("");
  const firstLoad = useRef(true);

  useEffect(() => {
    setAuctions(initial);
    for (const a of initial) setWatchCount(a.id, a.watch_count);
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    setAnnouncement(
      query
        ? `${tabLabel(status)}: ${resultsCountText(total, query)}`
        : `${tabLabel(status)}: ${total} ${total === 1 ? "auction" : "auctions"}.`,
    );
  }, [initial, status, total, query]);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    const channel = supabase
      .channel("feed:auctions")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "auctions" },
        (payload: RealtimePostgresUpdatePayload<Auction>) => {
          const next = payload.new;
          if (typeof next.watch_count === "number") setWatchCount(next.id, next.watch_count);
          // Keep the tab's order (e.g. a late bid moving ends_at on Live).
          setAuctions((list) => {
            const updated = list.map((a) =>
              a.id === next.id
                ? {
                    ...a,
                    current_bid: next.current_bid,
                    bid_count: next.bid_count,
                    ends_at: next.ends_at,
                    starts_at: next.starts_at,
                    status: next.status,
                    reserve_met: next.reserve_met,
                    watch_count: next.watch_count,
                  }
                : a,
            );
            return sortRef.current ? updated.sort(sortRef.current) : updated;
          });
        })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  // Rendered in the same place whatever is shown, so it's there before it changes.
  const liveRegion = (
    <p role="status" className="sr-only">
      {announcement}
    </p>
  );

  if (auctions.length === 0) {
    return (
      <div>
        {liveRegion}
        <div className="rounded-lg border border-dashed border-line p-10 text-center">
          {search ? (
            <>
              <p className="font-semibold">{noResultsText(status, search.query)}</p>
              <ul className="mt-3 flex flex-col items-center gap-2 text-sm">
                {status !== "past" && search.pastCount > 0 && (
                  <li>
                    <Link href={search.pastHref} scroll={false} className="font-semibold text-signal underline underline-offset-4">
                      See {search.pastCount} past {search.pastCount === 1 ? "result" : "results"} for “{search.query}”
                    </Link>
                  </li>
                )}
                <li>
                  <Link href={search.clearHref} scroll={false} className="text-chalk underline underline-offset-4">
                    Clear the search
                  </Link>
                </li>
              </ul>
            </>
          ) : (
            <>
              <p className="font-semibold">No cars match these filters.</p>
              <p className="mt-1 text-sm text-mute">Clear a filter, or check Past results to see what similar cars sold for.</p>
            </>
          )}
        </div>
      </div>
    );
  }

  const [first, ...rest] = auctions;
  const featured = featureFirst && !search && status === "live" && first?.status === "live" ? first : null;
  const grid = featured ? rest : auctions;

  return (
    <div className="flex flex-col gap-6">
      {liveRegion}
      {featured && <FeaturedLot auction={featured} initialNow={initialNow} userId={userId} watching={watched.has(featured.id)} />}
      {grid.length > 0 &&
        (search ? (
          <h2 className="font-wide text-lg font-bold">
            Results for “{search.query}” <span className="text-mute tabular">({total})</span>
          </h2>
        ) : status === "newest" ? (
          <h2 className="font-wide text-lg font-bold">
            Newly listed <span className="text-mute tabular">({total})</span>
          </h2>
        ) : (
          <h2 className="sr-only">{featured ? "More auctions" : "Auctions"}</h2>
        ))}
      {grid.length > 0 && (
        // Two per row on phones (12px gap), 3 from 1024px, 4 from 1280px.
        <ul className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3 xl:grid-cols-4">
          {grid.map((a, i) => (
            <li key={a.id}>
              <AuctionCard auction={a} initialNow={initialNow} priority={i < 4} userId={userId} watching={watched.has(a.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
