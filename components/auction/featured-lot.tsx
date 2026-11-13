"use client";
import Image from "next/image";
import Link from "next/link";
import { Countdown } from "./countdown";
import { InspectionBadge, ReserveBadge, RestoredBadge } from "./badges";
import { formatEur, formatKm } from "@/lib/format";
import type { AuctionCard } from "@/lib/types";

/** The lot closing soonest, shown large: the clock is the headline. */
export function FeaturedLot({ auction, initialNow }: { auction: AuctionCard; initialNow: number }) {
  const cover = auction.gallery_urls.exterior[0];
  return (
    <Link
      href={`/auctions/${auction.id}`}
      className="group grid overflow-hidden rounded-xl border border-line bg-panel md:grid-cols-[1.4fr_1fr]"
    >
      <div className="relative aspect-[16/10] bg-asphalt md:aspect-auto md:min-h-[360px]">
        {cover && (
          <Image src={cover} alt="" fill priority sizes="(min-width: 768px) 60vw, 100vw" className="object-cover" />
        )}
        <div className="absolute left-3 top-3">
          <ReserveBadge hasReserve={auction.has_reserve} reserveMet={auction.reserve_met} />
        </div>
      </div>

      <div className="flex flex-col justify-between gap-6 p-5 md:p-7">
        <div>
          <p className="text-sm text-mute">Closing next</p>
          <h2 className="mt-1 text-2xl font-bold leading-tight md:text-3xl">{auction.title}</h2>
          <p className="mt-2 text-sm text-mute">
            {formatKm(auction.mileage_km)} in {auction.location_city}, {auction.location_country}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <InspectionBadge partner={auction.inspection_partner_name} />
            {auction.condition_type === "restored_accident" && <RestoredBadge />}
          </div>
        </div>

        <div>
          <Countdown
            endsAt={auction.ends_at}
            status={auction.status}
            initialNow={initialNow}
            className="block font-wide text-5xl font-black leading-none tracking-tight md:text-6xl"
          />
          <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
            <span className="text-sm text-mute">
              {auction.current_bid ? `High bid, ${auction.bid_count} ${auction.bid_count === 1 ? "bid" : "bids"}` : "Opening bid"}
            </span>
            <span className="font-wide text-2xl font-bold tabular">{formatEur(auction.current_bid ?? auction.starting_bid)}</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
