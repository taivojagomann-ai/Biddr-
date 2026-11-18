import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buyersPremium } from "@/lib/pricing";
import { SECOND_CHANCE_HOURS, type BuyerPaymentRow } from "@/lib/settlement";

/**
 * After a sale (DECISIONS.md point 12): when the buyer didn't pay, the seller offers
 * the car to the next bidder ("second chance") or relists it; after a paid sale the
 * seller confirms it's completed. All writes run on the server with the service role,
 * after checking that the caller is the seller (or the offered bidder).
 */

type Admin = SupabaseClient;
export type AfterSaleResult = { ok: true; message: string; href?: string } | { ok: false; error: string };

export interface SecondChanceOffer {
  id: string;
  auction_id: string;
  original_payment_id: string;
  bidder_id: string;
  seller_id: string;
  amount: number;
  premium_amount: number;
  status: "pending" | "accepted" | "declined" | "expired" | "paid";
  expires_at: string;
  responded_at: string | null;
  created_at: string;
}

const ACTIVE = (p: Pick<BuyerPaymentRow, "status">) => p.status !== "unpaid" && p.status !== "cancelled";

async function notify(admin: Admin, rows: { user_id: string; type: string; auction_id: string; data?: Record<string, unknown> }[]) {
  const { error } = await admin.from("notifications").insert(rows.map((r) => ({ ...r, data: r.data ?? {} })));
  if (error) console.error("after-sale: notification failed", error);
}

/** The sold auction, its payments (newest first) and offers, if `sellerId` is its seller. */
async function loadSale(admin: Admin, auctionId: string, sellerId: string) {
  const { data: auction } = await admin
    .from("auctions")
    .select("id, seller_id, status, title, is_demo")
    .eq("id", auctionId)
    .maybeSingle<{ id: string; seller_id: string; status: string; title: string; is_demo: boolean }>();
  if (!auction || auction.seller_id !== sellerId || auction.status !== "sold") return null;
  const [{ data: payments }, { data: offers }] = await Promise.all([
    admin.from("buyer_payments").select("*").eq("auction_id", auctionId).order("created_at", { ascending: false }).returns<BuyerPaymentRow[]>(),
    admin.from("second_chance_offers").select("*").eq("auction_id", auctionId).order("created_at", { ascending: false }).returns<SecondChanceOffer[]>(),
  ]);
  return { auction, payments: payments ?? [], offers: offers ?? [] };
}

/**
 * The next bidder for a second-chance offer: the highest bidder who isn't a buyer that
 * already failed to pay, wasn't offered the car before, and isn't blocked. Their price is
 * their own highest bid.
 */
export async function nextBidder(
  admin: Admin,
  auctionId: string,
  exclude: string[],
): Promise<{ bidderId: string; amount: number; username: string | null } | null> {
  const { data: bids } = await admin
    .from("bids")
    .select("bidder_id, amount")
    .eq("auction_id", auctionId)
    .order("amount", { ascending: false })
    .limit(500)
    .returns<{ bidder_id: string; amount: number }[]>();
  const seen = new Set(exclude);
  for (const b of bids ?? []) {
    if (seen.has(b.bidder_id)) continue;
    seen.add(b.bidder_id);
    const { data: profile } = await admin
      .from("profiles")
      .select("username, bidding_blocked_at")
      .eq("id", b.bidder_id)
      .maybeSingle<{ username: string | null; bidding_blocked_at: string | null }>();
    if (!profile || profile.bidding_blocked_at) continue;
    return { bidderId: b.bidder_id, amount: b.amount, username: profile.username };
  }
  return null;
}

/** Who can't get an offer on this auction: every past buyer and every bidder already offered it. */
function excluded(sale: { payments: BuyerPaymentRow[]; offers: SecondChanceOffer[]; auction: { seller_id: string } }) {
  return [sale.auction.seller_id, ...sale.payments.map((p) => p.winner_id), ...sale.offers.map((o) => o.bidder_id)];
}

/** What the seller can do now on a sold car whose buyer didn't pay. */
export function sellerOptions(sale: { payments: BuyerPaymentRow[]; offers: SecondChanceOffer[] }, relisted: boolean) {
  const unpaid = sale.payments.some((p) => p.status === "unpaid");
  const active = sale.payments.some(ACTIVE);
  const openOffer = sale.offers.some((o) => o.status === "pending" || o.status === "accepted");
  const free = unpaid && !active && !openOffer && !relisted;
  return { canOffer: free, canRelist: free };
}

export async function offerToNextBidder(admin: Admin, sellerId: string, auctionId: string): Promise<AfterSaleResult> {
  const sale = await loadSale(admin, auctionId, sellerId);
  if (!sale) return { ok: false, error: "This car isn't one of your sold listings." };
  const { data: relist } = await admin.from("auctions").select("id").eq("relisted_from", auctionId).maybeSingle();
  if (!sellerOptions(sale, Boolean(relist)).canOffer) {
    return { ok: false, error: "The car can't be offered to the next bidder right now. Reload the page." };
  }
  const next = await nextBidder(admin, auctionId, excluded(sale));
  if (!next) return { ok: false, error: "There's no other bidder to offer the car to. You can relist it instead." };

  const original = sale.payments.find((p) => p.status === "unpaid")!;
  const expiresAt = new Date(Date.now() + SECOND_CHANCE_HOURS * 3600 * 1000).toISOString();
  const { data: offer, error } = await admin
    .from("second_chance_offers")
    .insert({
      auction_id: auctionId,
      original_payment_id: original.id,
      bidder_id: next.bidderId,
      seller_id: sellerId,
      amount: next.amount,
      premium_amount: buyersPremium(next.amount),
      expires_at: expiresAt,
    })
    .select("*")
    .single<SecondChanceOffer>();
  if (error || !offer) {
    // 23505: another offer was made at the same moment.
    return { ok: false, error: error?.code === "23505" ? "An offer is already open. Reload the page." : "The offer wasn't saved. Try again." };
  }
  await notify(admin, [
    { user_id: next.bidderId, type: "second_chance_offer", auction_id: auctionId, data: { amount: next.amount, expires_at: expiresAt } },
  ]);
  return { ok: true, message: `Offered to ${next.username ?? "the next bidder"} for €${next.amount.toLocaleString("en-GB")}. They have ${SECOND_CHANCE_HOURS} hours to accept and pay.` };
}

/** The offered bidder accepts: a payment for the premium opens, to be paid now on My purchases. */
export async function acceptOffer(admin: Admin, userId: string, offerId: string): Promise<AfterSaleResult> {
  const { data: offer } = await admin.from("second_chance_offers").select("*").eq("id", offerId).maybeSingle<SecondChanceOffer>();
  if (!offer || offer.bidder_id !== userId) return { ok: false, error: "This offer isn't for you." };
  if (offer.status !== "pending" || Date.parse(offer.expires_at) <= Date.now()) {
    return { ok: false, error: "This offer has ended. Reload the page." };
  }
  const { data: profile } = await admin.from("profiles").select("bidding_blocked_at").eq("id", userId).maybeSingle<{ bidding_blocked_at: string | null }>();
  if (profile?.bidding_blocked_at) return { ok: false, error: "Your bidding is blocked, so you can't accept offers. Contact Biddr." };

  // Claim the offer first, so a double click can't open two payments.
  const { data: claimed } = await admin
    .from("second_chance_offers")
    .update({ status: "accepted", responded_at: new Date().toISOString() })
    .eq("id", offerId)
    .eq("status", "pending")
    .select("id");
  if (!claimed?.length) return { ok: false, error: "This offer has ended. Reload the page." };

  const { error } = await admin.from("buyer_payments").insert({
    auction_id: offer.auction_id,
    winner_id: userId,
    seller_id: offer.seller_id,
    winning_bid: offer.amount,
    premium_amount: offer.premium_amount,
    captured_from_hold: 0,
    status: "action_required",
    due_at: offer.expires_at,
    failure_reason: "Pay the buyer's premium to buy this car.",
    second_chance_offer_id: offer.id,
  });
  if (error) {
    await admin.from("second_chance_offers").update({ status: "pending", responded_at: null }).eq("id", offerId);
    return { ok: false, error: "The payment couldn't start. Try again." };
  }
  return { ok: true, message: "Accepted. Now complete the payment of the buyer's premium below." };
}

export async function declineOffer(admin: Admin, userId: string, offerId: string): Promise<AfterSaleResult> {
  const { data: offer } = await admin
    .from("second_chance_offers")
    .update({ status: "declined", responded_at: new Date().toISOString() })
    .eq("id", offerId)
    .eq("bidder_id", userId)
    .eq("status", "pending")
    .select("auction_id, seller_id")
    .returns<{ auction_id: string; seller_id: string }[]>();
  const o = offer?.[0];
  if (!o) return { ok: false, error: "This offer has already ended. Reload the page." };
  await notify(admin, [{ user_id: o.seller_id, type: "second_chance_closed", auction_id: o.auction_id, data: { outcome: "declined" } }]);
  return { ok: true, message: "Declined. Thanks for letting the seller know." };
}

// Columns a relisted draft doesn't take over: the auction's outcome, schedule and Biddr's review results.
const NOT_COPIED = new Set([
  "id", "status", "current_bid", "leading_bidder_id", "bid_count", "reserve_met", "starts_at", "ends_at", "created_at",
  "updated_at", "watch_count", "search_text", "search_words", "relisted_from", "is_demo", "withdrawn_before_review",
  "inspection_partner_name", "inspection_report_url", "inspection_date", "inspection_highlights", "inspection_type",
  "inspected_by_seller", "history_report_verified", "history_report_public_link", "history_summary", "editor_take",
]);
// The seller's own answers in auction_private that go along (reviews start again).
const PRIVATE_COPIED = [
  "requested_reserve", "dealer_inspection_provided", "dealer_name", "dealer_city", "dealer_country", "dealer_inspection_date",
  "dealer_inspection_mileage_km", "dealer_report_paths", "history_report_provided", "history_report_paths",
  "history_report_link", "history_report_share_allowed",
] as const;

/** A new draft with the same details and photos, for Biddr's team to review and schedule again. */
export async function relistCar(admin: Admin, sellerId: string, auctionId: string): Promise<AfterSaleResult> {
  const sale = await loadSale(admin, auctionId, sellerId);
  if (!sale) return { ok: false, error: "This car isn't one of your sold listings." };
  const { data: existing } = await admin.from("auctions").select("id").eq("relisted_from", auctionId).maybeSingle<{ id: string }>();
  if (existing) return { ok: true, message: "Already relisted.", href: `/auctions/${existing.id}` };
  if (!sellerOptions(sale, false).canRelist) return { ok: false, error: "The car can't be relisted right now. Reload the page." };

  const [{ data: original }, { data: priv }] = await Promise.all([
    admin.from("auctions").select("*").eq("id", auctionId).single<Record<string, unknown>>(),
    admin.from("auction_private").select(PRIVATE_COPIED.join(", ")).eq("auction_id", auctionId).maybeSingle<Record<string, unknown>>(),
  ]);
  if (!original) return { ok: false, error: "This car no longer exists." };
  const copy = Object.fromEntries(Object.entries(original).filter(([k]) => !NOT_COPIED.has(k)));
  const { data: draft, error } = await admin
    .from("auctions")
    .insert({ ...copy, status: "draft", relisted_from: auctionId })
    .select("id")
    .single<{ id: string }>();
  if (error || !draft) {
    if (error?.code === "23505") return { ok: false, error: "This car is already listed or waiting for review." };
    console.error("relist: insert failed", error);
    return { ok: false, error: "The car couldn't be relisted. Try again." };
  }
  const privateRow: Record<string, unknown> = { auction_id: draft.id, ...(priv ?? {}) };
  if (priv?.dealer_inspection_provided) privateRow.inspection_review_status = "pending";
  if (priv?.history_report_provided) privateRow.history_review_status = "pending";
  const { error: privError } = await admin.from("auction_private").insert(privateRow);
  if (privError) {
    console.error("relist: private row failed", privError);
    await admin.from("auctions").delete().eq("id", draft.id).eq("status", "draft");
    return { ok: false, error: "The car couldn't be relisted. Try again." };
  }
  return { ok: true, message: "Relisted. Biddr's team reviews it and schedules the new auction.", href: `/auctions/${draft.id}` };
}

/** The seller confirms the car was paid for and handed over. */
export async function completeSale(admin: Admin, sellerId: string, paymentId: string): Promise<AfterSaleResult> {
  const { data } = await admin
    .from("buyer_payments")
    .update({ sale_completed_at: new Date().toISOString() })
    .eq("id", paymentId)
    .eq("seller_id", sellerId)
    .eq("status", "paid")
    .is("sale_completed_at", null)
    .select("id");
  if (!data?.length) return { ok: false, error: "This sale can't be marked completed. Reload the page." };
  return { ok: true, message: "Marked as completed. Thanks!" };
}
