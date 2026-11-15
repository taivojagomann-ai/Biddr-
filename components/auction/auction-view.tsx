import { Suspense } from "react";
import { AuctionLive } from "@/components/auction/auction-live";
import { Gallery } from "@/components/auction/gallery";
import { InspectionCard } from "@/components/auction/inspection-card";
import {
  Equipment,
  Highlights,
  ItemsIncluded,
  KnownFlaws,
  Modifications,
  SellerNotes,
  ServiceHistory,
} from "@/components/auction/listing-sections";
import { SpecSheet } from "@/components/auction/spec-sheet";
import { VideoPlayer } from "@/components/auction/video-player";
import { DemoBadge, InspectionBadge, ReserveBadge, RestoredBadge } from "@/components/auction/badges";
import { WatchButton, WatchCount } from "@/components/auction/watch-button";
import { InfoTip } from "@/components/info-tip";
import { ShareButton } from "@/components/share-button";
import { HELP } from "@/lib/help";
import { formatKm } from "@/lib/format";
import type { Auction, BidHistoryRow, CommentRow } from "@/lib/types";

export interface AuctionViewProps {
  auction: Auction;
  bids: BidHistoryRow[];
  comments: CommentRow[];
  userId: string | null;
  hasHold: boolean;
  canComment: boolean;
  watching: boolean;
  initialNow: number;
  holdEur: number;
  /**
   * Seller's preview of an unpublished listing (the sell form, or a draft or rejected
   * listing): the same page, with bidding, questions, watching and sharing turned off.
   */
  preview?: boolean;
  /** Preview only: the seller asked for an inspection that hasn't been added yet. */
  inspectionPending?: boolean;
}

/**
 * The auction page below the site header: title, facts, gallery, details, bid box and
 * questions. Used by /auctions/[id] and by the sell form's preview, so both look the same.
 * No "use client": it renders on the server for /auctions/[id] and in the browser for /sell.
 */
export function AuctionView({
  auction, bids, comments, userId, hasHold, canComment, watching, initialNow, holdEur, preview = false, inspectionPending = false,
}: AuctionViewProps) {
  return (
    <>
      {auction.is_demo && (
        <p className="mb-4 flex items-center gap-2 rounded-md border border-field bg-panel px-3 py-2 text-sm">
          <DemoBadge />
          This is a demo listing for testing. Bidding is turned off.
        </p>
      )}
      <div className="mb-5 flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="min-w-0 font-wide text-2xl font-extrabold leading-tight tracking-tight md:text-3xl">{auction.title}</h1>
          {preview ? null : (
            <div className="flex flex-wrap items-center gap-2">
              <WatchCount auctionId={auction.id} initialCount={auction.watch_count} />
              <WatchButton
                auctionId={auction.id}
                userId={userId}
                initialWatching={watching}
                initialCount={auction.watch_count}
              />
              <ShareButton path={`/auctions/${auction.id}`} title={auction.title} />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm text-mute">
          <span>{formatKm(auction.mileage_km)} in {auction.location_city}, {auction.location_country}</span>
          {auction.inspection_partner_name ? (
            <span className="inline-flex items-center gap-0.5">
              <InspectionBadge partner={auction.inspection_partner_name} />
              <InfoTip topic={HELP.partnerVerified} />
            </span>
          ) : null}
          {/* Phones and tablets have no bid box, so the reserve shows here (lg+ shows it in the bid box). */}
          <span className="inline-flex items-center gap-0.5 lg:hidden">
            <ReserveBadge hasReserve={auction.has_reserve} reserveMet={auction.reserve_met} />
            <InfoTip topic={auction.has_reserve ? HELP.reserve : HELP.noReserve} />
          </span>
          {auction.condition_type === "restored_accident" && <RestoredBadge />}
        </div>
      </div>

      <Suspense>
        <AuctionLive
          initialAuction={auction}
          initialBids={bids}
          initialComments={comments}
          userId={userId}
          initialHasHold={hasHold}
          canComment={canComment}
          initialWatching={watching}
          initialNow={initialNow}
          holdEur={holdEur}
          preview={preview}
        >
          <Gallery auction={auction} />
          <Highlights auction={auction} />
          <InspectionCard auction={auction} preview={preview} inspectionPending={inspectionPending} />
          <SpecSheet auction={auction} />
          <Equipment auction={auction} />
          <Modifications auction={auction} />
          <KnownFlaws auction={auction} />
          <ServiceHistory auction={auction} />
          <ItemsIncluded auction={auction} />
          <SellerNotes auction={auction} />
          {auction.video_url && <VideoPlayer url={auction.video_url} title={auction.title} />}
        </AuctionLive>
      </Suspense>
    </>
  );
}
