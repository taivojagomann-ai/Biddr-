import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HOLD_AMOUNT_EUR } from "./stripe";

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
