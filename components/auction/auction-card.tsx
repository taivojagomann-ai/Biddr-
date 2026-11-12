"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Countdown } from "./countdown";
import { InspectionBadge, ReserveBadge, RestoredBadge } from "./badges";
import { formatEur, formatKm } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AuctionCard as AuctionCardData } from "@/lib/types";

export function AuctionCard({ auction, initialNow, priority = false }: { auction: AuctionCardData; initialNow: number; priority?: boolean }) {
  const cover = auction.gallery_urls.exterior[0];
  const finished = ["ended", "sold", "reserve_not_met"].includes(auction.status);
  const price = auction.current_bid ?? auction.starting_bid;

  // Flash the price when a new bid arrives via Realtime.
  const [flash, setFlash] = useState(false);
  const prevCount = useRef(auction.bid_count);
  useEffect(() => {
    if (auction.bid_count > prevCount.current) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 700);
      prevCount.current = auction.bid_count;
      return () => clearTimeout(t);
    }
  }, [auction.bid_count]);

  return (
    <Link
      href={`/auctions/${auction.id}`}
      className="group flex flex-col overflow-hidden rounded-lg border border-line bg-panel transition-colors hover:border-[#3f3f46]"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-asphalt">
        {cover ? (
          <Image
            src={cover}
            alt={`${auction.year} ${auction.make} ${auction.model}`}
            fill
            sizes="(min-width: 1280px) 25vw, (min-width: 768px) 33vw, 100vw"
            priority={priority}
            className={cn("object-cover transition-transform duration-500 group-hover:scale-[1.02]", finished && "opacity-70")}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-mute">Photos coming soon</div>
        )}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          <ReserveBadge hasReserve={auction.has_reserve} reserveMet={auction.reserve_met} />
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="line-clamp-1 font-semibold leading-tight">{auction.title}</h3>
        <p className="text-sm text-mute">
          {formatKm(auction.mileage_km)}, {auction.location_city}, {auction.location_country}
        </p>
        <div className="flex flex-wrap gap-1">
          {auction.inspection_partner_name && <InspectionBadge partner={auction.inspection_partner_name} compact />}
          {auction.condition_type === "restored_accident" && <RestoredBadge />}
        </div>

        <div className="mt-auto flex items-end justify-between gap-3 border-t border-line pt-3">
          <div className={cn("rounded-md", flash && "animate-bid-flash")}>
            <p className="text-xs text-mute">
              {auction.status === "sold" ? "Sold for" : auction.current_bid ? "Current bid" : "Starting bid"}
            </p>
            <p className="font-wide text-lg font-bold tabular">{formatEur(price)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-mute">{auction.bid_count} {auction.bid_count === 1 ? "bid" : "bids"}</p>
            <Countdown
              endsAt={auction.ends_at}
              startsAt={auction.starts_at}
              status={auction.status}
              initialNow={initialNow}
              className="font-wide text-lg font-bold"
            />
          </div>
        </div>
      </div>
    </Link>
  );
}
