"use client";
import { useEffect, useRef, useState } from "react";
import type { RealtimePostgresUpdatePayload } from "@supabase/supabase-js";
import { AuctionCard } from "./auction-card";
import { FeaturedLot } from "./featured-lot";
import { setWatchCount } from "@/lib/client/watch-store";
import { compareForTab, tabLabel, type FeedStatus } from "@/lib/feed";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { Auction, AuctionCard as AuctionCardData } from "@/lib/types";

/** Grid of cards that stays live: bids, extensions and closings stream in over one channel. */
export function AuctionFeed({
  initial,
  initialNow,
  featureFirst = false,
  userId,
  watchedIds,
  status,
  total,
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
}) {
  const [auctions, setAuctions] = useState(initial);
  const watched = new Set(watchedIds);
  const sortRef = useRef(compareForTab(status));
  sortRef.current = compareForTab(status);

  // After switching tabs or filters (not on first load), say what's shown, politely.
  const [announcement, setAnnouncement] = useState("");
  const firstLoad = useRef(true);

  useEffect(() => {
    setAuctions(initial);
    for (const a of initial) setWatchCount(a.id, a.watch_count);
    if (firstLoad.current) {
      firstLoad.current = false;
      return;
    }
    setAnnouncement(`${tabLabel(status)}: ${total} ${total === 1 ? "auction" : "auctions"}.`);
  }, [initial, status, total]);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    const channel = supabase
      .channel("feed:auctions")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "auctions" },
        (payload: RealtimePostgresUpdatePayload<Auction>) => {
          const next = payload.new;
          if (typeof next.watch_count === "number") setWatchCount(next.id, next.watch_count);
          // Keep the tab's order (e.g. a late bid moving ends_at on Live).
          setAuctions((list) =>
            [...list].map((a) =>
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
            ).sort(sortRef.current),
          );
        })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  const liveRegion = (
    <p role="status" className="sr-only">
      {announcement}
    </p>
  );

  if (auctions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line p-10 text-center">
        {liveRegion}
        <p className="font-semibold">No cars match these filters.</p>
        <p className="mt-1 text-sm text-mute">Clear a filter, or check Past results to see what similar cars sold for.</p>
      </div>
    );
  }

  const [first, ...rest] = auctions;
  const featured = featureFirst && status === "live" && first?.status === "live" ? first : null;
  const grid = featured ? rest : auctions;

  return (
    <div className="flex flex-col gap-6">
      {featured && <FeaturedLot auction={featured} initialNow={initialNow} userId={userId} watching={watched.has(featured.id)} />}
      {liveRegion}
      {grid.length > 0 &&
        (status === "newest" ? (
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
