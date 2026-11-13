import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HOLD_AMOUNT_EUR, stripe } from "./stripe";

/**
 * Records a successful manual-capture authorization and marks the user as a
 * verified bidder. Idempotent: called from both the confirm route and the webhook.
 */
export async function markHoldAuthorized(admin: SupabaseClient, pi: Stripe.PaymentIntent): Promise<boolean> {
  if (pi.metadata.kind !== "bid_hold" || pi.status !== "requires_capture") return false;
  if (pi.amount_capturable < HOLD_AMOUNT_EUR * 100 || pi.currency !== "eur") return false;

  const userId = pi.metadata.user_id;
  if (!userId) return false;

  const { error: holdError } = await admin
    .from("bid_holds")
    .update({ status: "authorized" })
    .eq("stripe_payment_intent_id", pi.id)
    .in("status", ["pending", "authorized"]);
  if (holdError) throw holdError;

  const { error: profileError } = await admin
    .from("profiles")
    .update({ is_verified_bidder: true })
    .eq("id", userId);
  if (profileError) throw profileError;

  return true;
}

export function jsonError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * Cancels one Stripe hold and marks it released. Returns false if Stripe refused,
 * so the caller can retry later. An already-cancelled or expired hold counts as released.
 */
export async function releaseHold(
  admin: SupabaseClient,
  hold: { id: string; stripe_payment_intent_id: string },
): Promise<boolean> {
  try {
    await stripe.paymentIntents.cancel(hold.stripe_payment_intent_id, { cancellation_reason: "abandoned" });
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== "payment_intent_unexpected_state") return false;
  }
  const { error } = await admin.from("bid_holds").update({ status: "released" }).eq("id", hold.id);
  return !error;
}

/** Releases every open hold on one auction (used when an admin withdraws it). */
export async function releaseAuctionHolds(
  admin: SupabaseClient,
  auctionId: string,
): Promise<{ released: number; failed: number }> {
  const { data, error } = await admin
    .from("bid_holds")
    .select("id, stripe_payment_intent_id")
    .eq("auction_id", auctionId)
    .in("status", ["pending", "authorized"])
    .returns<{ id: string; stripe_payment_intent_id: string }[]>();
  if (error) return { released: 0, failed: -1 };
  let released = 0;
  let failed = 0;
  for (const hold of data ?? []) {
    if (await releaseHold(admin, hold)) released += 1;
    else failed += 1;
  }
  return { released, failed };
}
