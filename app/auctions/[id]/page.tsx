import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { AuctionLive } from "@/components/auction/auction-live";
import { Gallery } from "@/components/auction/gallery";
import { InspectionCard } from "@/components/auction/inspection-card";
import { SpecSheet } from "@/components/auction/spec-sheet";
import { VideoPlayer } from "@/components/auction/video-player";
import { InspectionBadge, RestoredBadge } from "@/components/auction/badges";
import { getServerSupabase } from "@/lib/supabase/server";
import { formatKm } from "@/lib/format";
import { COMMENT_COLUMNS, type Auction, type BidHistoryRow, type CommentRow } from "@/lib/types";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOLD_EUR = Number(process.env.BID_HOLD_AMOUNT_EUR ?? 500);

async function loadAuction(id: string): Promise<Auction | null> {
  if (!UUID_RE.test(id)) return null;
  const { data } = await getServerSupabase().from("auctions").select("*").eq("id", id).maybeSingle<Auction>();
  return data;
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const a = await loadAuction(params.id);
  if (!a) return { title: "Auction not found" };
  return {
    title: a.title,
    description: `${a.year} ${a.make} ${a.model}, ${formatKm(a.mileage_km)}, ${a.location_city}. ${a.inspection_partner_name ? `Inspected by ${a.inspection_partner_name}.` : ""}`,
    openGraph: { images: a.gallery_urls.exterior.slice(0, 1) },
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
  if (user) {
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
      <div className="mb-5 flex flex-col gap-2">
        <h1 className="font-wide text-2xl font-extrabold leading-tight tracking-tight md:text-3xl">{auction.title}</h1>
        <div className="flex flex-wrap items-center gap-2 text-sm text-mute">
          <span>{formatKm(auction.mileage_km)} in {auction.location_city}, {auction.location_country}</span>
          <InspectionBadge partner={auction.inspection_partner_name} />
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
          initialNow={Date.now()}
          holdEur={HOLD_EUR}
        >
          <Gallery auction={auction} />
          <InspectionCard auction={auction} />
          {auction.video_url && <VideoPlayer url={auction.video_url} title={auction.title} />}
          <SpecSheet auction={auction} />
        </AuctionLive>
      </Suspense>
    </main>
  );
}
