import type { Metadata } from "next";
import { notFound } from "next/navigation";
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
import { InfoTip } from "@/components/info-tip";
import { HELP } from "@/lib/help";
import { getServerSupabase } from "@/lib/supabase/server";
import { formatEur, formatKm } from "@/lib/format";
import { WatchButton, WatchCount } from "@/components/auction/watch-button";
import { ShareButton } from "@/components/share-button";
import { COMMENT_COLUMNS, type Auction, type BidHistoryRow, type CommentRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOLD_EUR = Number(process.env.BID_HOLD_AMOUNT_EUR ?? 500);

async function loadAuction(id: string): Promise<Auction | null> {
  if (!UUID_RE.test(id)) return null;
  const { data } = await getServerSupabase().from("auctions").select("*").eq("id", id).maybeSingle<Auction>();
  return data;
}

/** "2019 · 42,800 km · Tallinn. Live auction on Biddr." or the result. */
function shareDescription(a: Auction): string {
  const facts = `${a.year} · ${formatKm(a.mileage_km)} · ${a.location_city}.`;
  const result =
    a.status === "live"
      ? "Live auction on Biddr."
      : a.status === "upcoming"
        ? "Upcoming auction on Biddr."
        : a.status === "sold" && a.current_bid
          ? `Sold for ${formatEur(a.current_bid)} on Biddr.`
          : a.status === "reserve_not_met"
            ? "Auction ended: reserve not met."
            : a.status === "withdrawn"
              ? "Auction withdrawn."
              : a.status === "ended"
                ? "Auction ended with no bids."
                : "On Biddr.";
  return `${a.is_demo ? "Demo listing. " : ""}${facts} ${result}`;
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const a = await loadAuction(params.id);
  if (!a) return { title: "Auction not found" };
  const description = shareDescription(a);
  const url = `/auctions/${a.id}`;
  // og:image comes from ./opengraph-image.tsx (absolute via metadataBase in the root layout).
  return {
    title: a.title,
    description,
    alternates: { canonical: url },
    openGraph: { type: "website", siteName: "Biddr", title: a.title, description, url },
    twitter: { card: "summary_large_image", title: a.title, description, images: [`${url}/opengraph-image`] },
  };
}

export default async function AuctionPage({ params }: { params: { id: string } }) {
  const supabase = getServerSupabase();
  const auction = await loadAuction(params.id);
  if (!auction) notFound();

  const [{ data: { user } }, bidsRes, commentsRes] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc("get_bid_history", { p_auction_id: auction.id, p_limit: 100 }).returns<BidHistoryRow[]>(),
    supabase.from("comments").select(COMMENT_COLUMNS).eq("auction_id", auction.id)
      .order("created_at", { ascending: true }).returns<CommentRow[]>(),
  ]);

  let hasHold = false;
  let canComment = false;
  let watching = false;
  if (user) {
    const { data: watchRow } = await supabase
      .from("watchlist")
      .select("auction_id")
      .eq("auction_id", auction.id)
      .eq("user_id", user.id)
      .maybeSingle();
    watching = Boolean(watchRow);
    const { data: me } = await supabase
      .from("profiles")
      .select("username, country")
      .eq("id", user.id)
      .maybeSingle<{ username: string | null; country: string | null }>();
    canComment = Boolean(me?.username?.trim() && me.country);
    const { data: hold } = await supabase
      .from("bid_holds")
      .select("id")
      .eq("auction_id", auction.id)
      .eq("user_id", user.id)
      .eq("status", "authorized")
      .maybeSingle();
    hasHold = Boolean(hold);
  }

  return (
    <main className="container py-6">
      {auction.is_demo && (
        <p className="mb-4 flex items-center gap-2 rounded-md border border-field bg-panel px-3 py-2 text-sm">
          <DemoBadge />
          This is a demo listing for testing. Bidding is turned off.
        </p>
      )}
      <div className="mb-5 flex flex-col gap-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="min-w-0 font-wide text-2xl font-extrabold leading-tight tracking-tight md:text-3xl">{auction.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <WatchCount auctionId={auction.id} initialCount={auction.watch_count} />
            <WatchButton
              auctionId={auction.id}
              userId={user?.id ?? null}
              initialWatching={watching}
              initialCount={auction.watch_count}
            />
            <ShareButton path={`/auctions/${auction.id}`} title={auction.title} />
          </div>
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
          initialBids={bidsRes.data ?? []}
          initialComments={commentsRes.data ?? []}
          userId={user?.id ?? null}
          initialHasHold={hasHold}
          canComment={canComment}
          initialWatching={watching}
          initialNow={Date.now()}
          holdEur={HOLD_EUR}
        >
          <Gallery auction={auction} />
          <Highlights auction={auction} />
          <InspectionCard auction={auction} />
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
    </main>
  );
}
