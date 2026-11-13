"use client";
import { useEffect, useState } from "react";
import type { RealtimePostgresUpdatePayload } from "@supabase/supabase-js";
import { AuctionCard } from "./auction-card";
import { FeaturedLot } from "./featured-lot";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { Auction, AuctionCard as AuctionCardData } from "@/lib/types";

/** Grid of cards that stays live: bids, extensions and closings stream in over one channel. */
export function AuctionFeed({
  initial,
  initialNow,
  featureFirst = false,
}: {
  initial: AuctionCardData[];
  initialNow: number;
  featureFirst?: boolean;
}) {
  const [auctions, setAuctions] = useState(initial);

  useEffect(() => setAuctions(initial), [initial]);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    const channel = supabase
      .channel("feed:auctions")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "auctions" },
        (payload: RealtimePostgresUpdatePayload<Auction>) => {
          const next = payload.new;
          setAuctions((list) =>
            list.map((a) =>
              a.id === next.id
                ? {
                    ...a,
                    current_bid: next.current_bid,
                    bid_count: next.bid_count,
                    ends_at: next.ends_at,
                    status: next.status,
                    reserve_met: next.reserve_met,
                  }
                : a,
            ),
          );
        })
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, []);

  if (auctions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line p-10 text-center">
        <p className="font-semibold">No cars match these filters.</p>
        <p className="mt-1 text-sm text-mute">Clear a filter, or check Past results to see what similar cars sold for.</p>
      </div>
    );
  }

  const [first, ...rest] = auctions;
  const featured = featureFirst && first?.status === "live" ? first : null;
  const grid = featured ? rest : auctions;

  return (
    <div className="flex flex-col gap-6">
      {featured && <FeaturedLot auction={featured} initialNow={initialNow} />}
      {grid.length > 0 && (
        <h2 className="sr-only">{featured ? "More auctions" : "Auctions"}</h2>
      )}
      {grid.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {grid.map((a, i) => (
            <li key={a.id}>
              <AuctionCard auction={a} initialNow={initialNow} priority={i < 4} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
