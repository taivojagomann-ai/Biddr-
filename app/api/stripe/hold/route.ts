import { z } from "zod";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";
import { HOLD_AMOUNT_EUR, stripe } from "@/lib/stripe";
import { getBidderStatus, unmetRequirement } from "@/lib/bidder";
import { bidErrorMessage } from "@/lib/errors";
import { jsonError, markHoldAuthorized } from "@/lib/holds";
import type { HoldResponse } from "@/lib/types";

export const runtime = "nodejs";

const Body = z.object({ auctionId: z.string().uuid() });
const RESUMABLE = new Set(["requires_payment_method", "requires_confirmation", "requires_action"]);

/** Creates (or resumes) the €500 manual-capture hold a user needs before bidding on one auction. */
export async function POST(req: Request): Promise<Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Missing or invalid auction.", 400);
  const { auctionId } = parsed.data;

  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return jsonError("Sign in to place a bid.", 401);

  // Complete profile and current bidding terms come first: never touch Stripe for
  // someone who can't bid. Same check as the bids trigger (bidder_status(), 0008).
  // If the check itself fails, stay closed rather than create a hold.
  const status = await getBidderStatus(supabase);
  if (!status) return jsonError("Bidding isn't available right now. Try again in a minute.", 503);
  const unmet = unmetRequirement(status);
  if (unmet) return Response.json({ error: bidErrorMessage(unmet), code: unmet }, { status: 403 });

  const admin = getAdminSupabase();

  const { data: auction } = await admin
    .from("auctions").select("id,title,status,seller_id,is_demo").eq("id", auctionId).maybeSingle<{
      id: string; title: string; status: string; seller_id: string; is_demo: boolean;
    }>();
  if (!auction) return jsonError("This auction no longer exists.", 404);
  // Never ask a real card for a hold on a demo listing.
  if (auction.is_demo) return jsonError("This is a demo listing. Bidding is turned off.", 409);
  if (auction.seller_id === user.id) return jsonError("You can't bid on your own car.", 403);
  if (!["live", "upcoming"].includes(auction.status)) return jsonError("Bidding has closed on this car.", 409);

  // 1. Reuse an existing hold where possible.
  const { data: existing } = await admin
    .from("bid_holds")
    .select("id,status,stripe_payment_intent_id")
    .eq("auction_id", auctionId).eq("user_id", user.id)
    .in("status", ["pending", "authorized"])
    .maybeSingle<{ id: string; status: "pending" | "authorized"; stripe_payment_intent_id: string }>();

  if (existing?.status === "authorized") {
    return Response.json({ status: "authorized", amountEur: HOLD_AMOUNT_EUR } satisfies HoldResponse);
  }

  if (existing?.status === "pending") {
    const pi = await stripe.paymentIntents.retrieve(existing.stripe_payment_intent_id);
    if (pi.status === "requires_capture") {
      await markHoldAuthorized(admin, pi);
      return Response.json({ status: "authorized", amountEur: HOLD_AMOUNT_EUR } satisfies HoldResponse);
    }
    if (RESUMABLE.has(pi.status) && pi.client_secret) {
      return Response.json({
        status: "requires_payment", clientSecret: pi.client_secret, paymentIntentId: pi.id, amountEur: HOLD_AMOUNT_EUR,
      } satisfies HoldResponse);
    }
    await admin.from("bid_holds").update({ status: "failed" }).eq("id", existing.id);
  }

  // 2. Ensure a Stripe customer, so the card can be reused for the buyer's premium.
  const { data: profile } = await admin
    .from("profiles").select("stripe_customer_id,full_name").eq("id", user.id)
    .single<{ stripe_customer_id: string | null; full_name: string | null }>();

  let customerId = profile?.stripe_customer_id ?? null;
  if (!customerId) {
    const customer = await stripe.customers.create(
      { email: user.email, name: profile?.full_name ?? undefined, metadata: { supabase_user_id: user.id } },
      { idempotencyKey: `customer:${user.id}` },
    );
    customerId = customer.id;
    await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("id", user.id);
  }

  // 3. New manual-capture PaymentIntent = authorization only, no charge.
  const pi = await stripe.paymentIntents.create({
    amount: HOLD_AMOUNT_EUR * 100,
    currency: "eur",
    capture_method: "manual",
    customer: customerId,
    payment_method_types: ["card"],
    setup_future_usage: "off_session",
    description: `Bidding security hold: ${auction.title}`,
    statement_descriptor_suffix: "BID HOLD",
    metadata: { kind: "bid_hold", auction_id: auctionId, user_id: user.id },
  });

  const { error: insertError } = await admin.from("bid_holds").insert({
    auction_id: auctionId,
    user_id: user.id,
    stripe_payment_intent_id: pi.id,
    amount: HOLD_AMOUNT_EUR,
    status: "pending",
  });

  if (insertError) {
    // Unique index hit: a parallel request created the hold first. Drop ours.
    await stripe.paymentIntents.cancel(pi.id).catch(() => undefined);
    if (insertError.code === "23505") return jsonError("A card check is already in progress. Try again.", 409);
    return jsonError("The card check couldn't start. Try again.", 500);
  }

  return Response.json({
    status: "requires_payment", clientSecret: pi.client_secret ?? undefined, paymentIntentId: pi.id, amountEur: HOLD_AMOUNT_EUR,
  } satisfies HoldResponse);
}
