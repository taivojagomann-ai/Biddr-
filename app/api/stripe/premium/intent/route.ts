import { z } from "zod";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { jsonError } from "@/lib/holds";
import type { BuyerPaymentRow } from "@/lib/settlement";

export const runtime = "nodejs";

const Body = z.object({ auctionId: z.string().uuid() });
const RESUMABLE = new Set(["requires_payment_method", "requires_confirmation", "requires_action"]);

/**
 * "Complete payment": the winner pays what's left of the buyer's premium on the
 * site (Stripe Payment Element, with 3-D Secure when the bank asks). Reuses the
 * PaymentIntent that needed authentication when it can.
 */
export async function POST(req: Request): Promise<Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Missing or invalid auction.", 400);
  const { data: { user } } = await getServerSupabase().auth.getUser();
  if (!user) return jsonError("Sign in to continue.", 401);

  const admin = getAdminSupabase();
  const { data: row } = await admin
    .from("buyer_payments")
    .select("*")
    .eq("auction_id", parsed.data.auctionId)
    .maybeSingle<BuyerPaymentRow>();
  if (!row || row.winner_id !== user.id) return jsonError("There's no payment for you on this car.", 404);
  if (row.status === "paid") return jsonError("This premium is already paid.", 409);
  if (row.status !== "action_required" && row.status !== "failed") {
    return jsonError("This payment isn't waiting for you right now. Reload the page.", 409);
  }
  const outstanding = (row.premium_amount - (row.captured_from_hold ?? 0)) * 100;

  if (row.remainder_payment_intent_id) {
    const existing = await stripe.paymentIntents.retrieve(row.remainder_payment_intent_id);
    if (RESUMABLE.has(existing.status) && existing.amount === outstanding && existing.client_secret) {
      return Response.json({ clientSecret: existing.client_secret, amountEur: outstanding / 100 });
    }
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle<{ stripe_customer_id: string | null }>();
  const { data: auction } = await admin.from("auctions").select("title").eq("id", row.auction_id).maybeSingle<{ title: string }>();
  const pi = await stripe.paymentIntents.create(
    {
      amount: outstanding,
      currency: "eur",
      ...(profile?.stripe_customer_id ? { customer: profile.stripe_customer_id } : {}),
      payment_method_types: ["card"],
      description: `Buyer's premium: ${auction?.title ?? "car"}`,
      statement_descriptor_suffix: "PREMIUM",
      metadata: { kind: "buyer_premium", auction_id: row.auction_id, user_id: user.id, buyer_payment_id: row.id },
    },
    { idempotencyKey: `premium-onsession:${row.id}:${row.attempts}:${outstanding}` },
  );
  await admin.from("buyer_payments").update({ remainder_payment_intent_id: pi.id }).eq("id", row.id);
  if (!pi.client_secret) return jsonError("The payment couldn't start. Try again.", 502);
  return Response.json({ clientSecret: pi.client_secret, amountEur: outstanding / 100 });
}
