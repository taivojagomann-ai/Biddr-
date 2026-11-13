"use client";
import Image from "next/image";
import Link from "next/link";
import { Countdown } from "./countdown";
import { WatchButton } from "./watch-button";
import { DemoBadge, InspectionBadge, NewBadge, ReserveBadge, RestoredBadge } from "./badges";
import { useMinuteNow } from "@/hooks/use-minute-now";
import { isNewListing } from "@/lib/feed";
import { formatEur, formatKm } from "@/lib/format";
import type { AuctionCard } from "@/lib/types";

/** The lot closing soonest, shown large: the clock is the headline. */
export function FeaturedLot({
  auction,
  initialNow,
  userId,
  watching,
}: {
  auction: AuctionCard;
  initialNow: number;
  userId: string | null;
  watching: boolean;
}) {
  const cover = auction.gallery_urls.exterior[0];
  const now = useMinuteNow(initialNow);
  return (
    <article className="group relative grid overflow-hidden rounded-xl border border-line bg-panel md:grid-cols-[1.4fr_1fr] has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-signal has-[a:focus-visible]:ring-offset-2 has-[a:focus-visible]:ring-offset-asphalt">
      <div className="relative aspect-[16/10] bg-asphalt md:aspect-auto md:min-h-[360px]">
        {cover && (
          <Image src={cover} alt="" fill priority sizes="(min-width: 768px) 60vw, 100vw" className="object-cover" />
        )}
        <div className="absolute left-3 top-3 flex gap-1">
          {auction.is_demo && <DemoBadge />}
          {isNewListing(auction, now) && <NewBadge />}
          <ReserveBadge hasReserve={auction.has_reserve} reserveMet={auction.reserve_met} />
        </div>
      </div>

      <div className="flex flex-col justify-between gap-6 p-5 md:p-7">
        <div>
          <p className="text-sm text-mute">Closing next</p>
          <h2 className="mt-1 text-2xl font-bold leading-tight md:text-3xl">
            <Link href={`/auctions/${auction.id}`} className="outline-none after:absolute after:inset-0 after:content-['']">
              {auction.title}
            </Link>
          </h2>
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
      <div className="absolute right-3 top-3 z-10">
        <WatchButton
          auctionId={auction.id}
          title={auction.title}
          userId={userId}
          initialWatching={watching}
          initialCount={auction.watch_count}
          className="[&_button]:bg-asphalt/85 [&_button]:backdrop-blur"
        />
      </div>
    </article>
  );
}
