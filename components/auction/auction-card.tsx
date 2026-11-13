"use client";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Countdown } from "./countdown";
import { WatchButton } from "./watch-button";
import { DemoBadge, InspectionBadge, NewBadge, ReserveBadge, RestoredBadge } from "./badges";
import { useMinuteNow } from "@/hooks/use-minute-now";
import { isNewListing } from "@/lib/feed";
import { formatEur, formatKm } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AuctionCard as AuctionCardData } from "@/lib/types";

export function AuctionCard({
  auction,
  initialNow,
  priority = false,
  userId,
  watching,
}: {
  auction: AuctionCardData;
  initialNow: number;
  priority?: boolean;
  userId: string | null;
  watching: boolean;
}) {
  const cover = auction.gallery_urls.exterior[0];
  const finished = ["ended", "sold", "reserve_not_met"].includes(auction.status);
  const price = auction.current_bid ?? auction.starting_bid;
  // One shared minute timer, so the badge drops off 24 hours after going live.
  const now = useMinuteNow(initialNow);

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

  const bids = `${auction.bid_count} ${auction.bid_count === 1 ? "bid" : "bids"}`;

  return (
    // Only the title is a link; its ::after stretches over the whole card, so the card
    // stays clickable while the Watch button sits above it as a separate control.
    // Below 640px the card is compact (two per row); from 640px it keeps the full layout.
    // `auction-card` is a CSS container: the footer adapts to the card's own width.
    <article className="auction-card group relative flex h-full min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-panel transition-colors hover:border-[#3f3f46] has-[a:focus-visible]:ring-2 has-[a:focus-visible]:ring-signal has-[a:focus-visible]:ring-offset-2 has-[a:focus-visible]:ring-offset-asphalt">
      <div className="relative aspect-[4/3] overflow-hidden bg-asphalt">
        {cover ? (
          <Image
            src={cover}
            alt="" // the title below names the car; the photo would repeat it
            fill
            sizes="(min-width: 1280px) 25vw, (min-width: 1024px) 33vw, 50vw"
            priority={priority}
            className={cn("object-cover transition-transform duration-500 group-hover:scale-[1.02]", finished && "opacity-70")}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-xs text-mute sm:text-sm">Photos coming soon</div>
        )}
        {/* Leaves room on the right for the Watch button. */}
        <div className="absolute left-1.5 top-1.5 flex max-w-[calc(100%-3.25rem)] flex-wrap gap-1 sm:left-2 sm:top-2 sm:max-w-[calc(100%-7rem)]">
          {auction.is_demo && <DemoBadge />}
          <ReserveBadge hasReserve={auction.has_reserve} reserveMet={auction.reserve_met} />
          {isNewListing(auction, now) && <NewBadge />}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-2.5 sm:gap-2 sm:p-3">
        <h3 className="line-clamp-2 break-words text-sm font-semibold leading-snug sm:line-clamp-1 sm:text-base sm:leading-tight">
          <Link href={`/auctions/${auction.id}`} className="outline-none after:absolute after:inset-0 after:content-['']">
            {auction.title}
          </Link>
        </h3>
        <p className="truncate text-xs text-mute sm:whitespace-normal sm:text-sm">
          {formatKm(auction.mileage_km)}, {auction.location_city}
          <span className="hidden sm:inline">, {auction.location_country}</span>
        </p>
        {(auction.inspection_partner_name || auction.condition_type === "restored_accident") && (
          <div className="flex flex-wrap gap-1">
            {auction.inspection_partner_name && <InspectionBadge partner={auction.inspection_partner_name} compact />}
            {auction.condition_type === "restored_accident" && <RestoredBadge collapsible />}
          </div>
        )}

        <div className="ac-foot mt-auto border-t border-line pt-2 sm:pt-3">
          <div className={cn("min-w-0 rounded-md", flash && "animate-bid-flash")}>
            <p className="text-[11px] leading-tight text-mute sm:text-xs">
              {auction.status === "sold" ? "Sold for" : auction.current_bid ? "Current bid" : "Starting bid"}
            </p>
            <p className="break-all font-wide text-base font-bold leading-tight tabular sm:text-lg">{formatEur(price)}</p>
          </div>
          <div className="ac-meta min-w-0">
            <p className="text-[11px] leading-tight text-mute sm:text-xs">{bids}</p>
            {/* A chip on phones; plain large text from 640px, as before. */}
            <span className="inline-flex max-w-full rounded-sm border border-line bg-asphalt px-1.5 py-0.5 text-[13px] font-semibold leading-tight sm:border-0 sm:bg-transparent sm:p-0">
              <Countdown
                endsAt={auction.ends_at}
                startsAt={auction.starts_at}
                status={auction.status}
                initialNow={initialNow}
                className="break-words sm:font-wide sm:text-lg sm:font-bold"
              />
            </span>
          </div>
        </div>
      </div>
      {/* After the link in the DOM (keyboard order: card, then Watch), above it visually. */}
      <div className="absolute right-0.5 top-0.5 z-10 sm:right-2 sm:top-2">
        <WatchButton
          variant="card"
          auctionId={auction.id}
          title={auction.title}
          userId={userId}
          initialWatching={watching}
          initialCount={auction.watch_count}
        />
      </div>
    </article>
  );
}
