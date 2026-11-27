"use client";
import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Countdown } from "./countdown";
import { WatchButton } from "./watch-button";
import { DemoBadge, InspectionBadge, NewBadge, ReserveBadge, RestoredBadge } from "./badges";
import { isDealerInspected } from "@/lib/inspection";
import { useMinuteNow } from "@/hooks/use-minute-now";
import { isNewListing } from "@/lib/feed";
import { formatEur, formatKm } from "@/lib/format";
import type { AuctionCard } from "@/lib/types";

/** One featured car, shown large in the home page carousel: the clock is the headline. */
export function FeaturedLot({
  auction,
  initialNow,
  userId,
  watching,
  premium = false,
}: {
  auction: AuctionCard;
  initialNow: number;
  userId: string | null;
  watching: boolean;
  /** A paid or admin-set premium seat: always labelled "Featured" (DECISIONS.md point 9). */
  premium?: boolean;
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
          <p className="flex flex-wrap items-center gap-2 text-sm text-mute">
            {premium ? (
              <span data-featured-label className="rounded-sm border border-chalk/60 px-1.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-chalk">
                Featured
              </span>
            ) : null}
            <span>{premium ? "Paid placement" : "Ending within 24 hours"}</span>
          </p>
          <h2 className="mt-1 text-2xl font-bold leading-tight md:text-3xl">
            <Link href={`/auctions/${auction.id}`} className="outline-none after:absolute after:inset-0 after:content-['']">
              {auction.title}
            </Link>
          </h2>
          <p className="mt-2 text-sm text-mute">
            {formatKm(auction.mileage_km)} in {auction.location_city}, {auction.location_country}
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <InspectionBadge dealer={isDealerInspected(auction) ? (auction.inspection_partner_name ?? "an authorised dealer") : null} />
            {auction.condition_type === "restored_accident" && <RestoredBadge />}
          </div>
        </div>

        <div>
          <p className="mb-1 text-sm text-mute">Ends in</p>
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
          {/* Above the card's full-size link, so it's its own target. */}
          <Button asChild className="relative z-10 mt-4 min-h-11 w-full sm:w-auto">
            <Link href={`/auctions/${auction.id}#bid`}>
              Place bid<span className="sr-only"> on {auction.title}</span>
            </Link>
          </Button>
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
