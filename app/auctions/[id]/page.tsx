import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { AuctionView } from "@/components/auction/auction-view";
import { PreviewBanner } from "@/components/auction/preview-banner";
import { Button } from "@/components/ui/button";
import { getCurrentAdminId } from "@/lib/admin";
import { PREVIEW_TEXT, isPreviewStatus } from "@/lib/listing-preview";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";
import { formatEur, formatKm } from "@/lib/format";
import { DecisionPanel } from "@/app/account/listings/decision-panel";
import { COMMENT_COLUMNS, type SellerInspectionDecision, type Auction, type BidHistoryRow, type CommentRow } from "@/lib/types";

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
  // Drafts and rejected listings are previews for the seller and admins: keep them out of search engines.
  if (isPreviewStatus(a.status)) return { title: `Preview: ${a.title}`, robots: { index: false, follow: false } };
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

  // RLS only returns drafts and rejected listings to their seller and to admins;
  // everyone else got null above and a 404.
  const preview = isPreviewStatus(auction.status);
  let isAdmin = false;
  let rejectionReason: string | null = null;
  let inspectionPending = false;
  // The seller's choice after a rejected dealer report (0016), shown to the seller.
  let decision: { required: boolean; reason: string | null; deadline: string | null; choice: SellerInspectionDecision | null } | null = null;
  if (preview && user) {
    isAdmin = (await getCurrentAdminId()) === user.id;
    if (isAdmin || auction.seller_id === user.id) {
      // auction_private is admin-only: read just this listing's reason and inspection
      // choice with the service role.
      const { data: row } = await getAdminSupabase()
        .from("auction_private")
        .select(
          "rejection_reason, dealer_inspection_provided, inspection_review_status, inspection_review_note, seller_decision_required, seller_decision_deadline, seller_decision",
        )
        .eq("auction_id", auction.id)
        .maybeSingle<{
          rejection_reason: string | null;
          dealer_inspection_provided: boolean | null;
          inspection_review_status: string | null;
          inspection_review_note: string | null;
          seller_decision_required: boolean;
          seller_decision_deadline: string | null;
          seller_decision: SellerInspectionDecision | null;
        }>();
      rejectionReason = auction.status === "rejected" ? row?.rejection_reason ?? null : null;
      // A dealer report Biddr hasn't checked yet.
      inspectionPending = row?.dealer_inspection_provided === true && row.inspection_review_status === "pending";
      if (auction.status === "draft" && auction.seller_id === user.id && (row?.seller_decision_required || row?.seller_decision)) {
        decision = {
          required: row.seller_decision_required,
          reason: row.inspection_review_note,
          deadline: row.seller_decision_deadline,
          choice: row.seller_decision,
        };
      }
    }
  }

  return (
    <main className="container py-6">
      {preview ? (
        <div className="mb-5">
          <PreviewBanner
            heading={PREVIEW_TEXT.privateBanner}
            tone={auction.status === "rejected" ? "warning" : "info"}
            actions={
              <>
                {isAdmin ? (
                  <Button asChild size="sm">
                    <Link href={`/admin/auctions/${auction.id}`}>Open in admin</Link>
                  </Button>
                ) : null}
                {auction.seller_id === user?.id ? (
                  <Button asChild size="sm" variant="outline">
                    <Link href="/account/listings">My listings</Link>
                  </Button>
                ) : null}
              </>
            }
          >
            {auction.status === "rejected" ? (
              <p>
                <span className="font-semibold text-chalk">Not accepted:</span>{" "}
                {rejectionReason ?? "We couldn't accept this listing. Contact us for details."}
              </p>
            ) : decision?.required ? (
              <p>Waiting for your decision about the inspection report.</p>
            ) : (
              <p>{PREVIEW_TEXT.waiting}</p>
            )}
          </PreviewBanner>
          {decision && user ? (
            <div className="mt-3">
              <DecisionPanel
                auctionId={auction.id}
                userId={user.id}
                title={auction.title}
                make={auction.make}
                required={decision.required}
                reason={decision.reason}
                deadline={decision.deadline}
                choice={decision.choice}
              />
            </div>
          ) : null}
        </div>
      ) : null}
      <AuctionView
        auction={auction}
        bids={bidsRes.data ?? []}
        comments={commentsRes.data ?? []}
        userId={user?.id ?? null}
        hasHold={hasHold}
        canComment={canComment}
        watching={watching}
        initialNow={Date.now()}
        holdEur={HOLD_EUR}
        preview={preview}
        inspectionPending={inspectionPending}
      />
    </main>
  );
}
