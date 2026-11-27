import { z } from "zod";
import { jsonError } from "@/lib/holds";
import { finishSeatPayment } from "@/lib/premium-seat";
import { stripe } from "@/lib/stripe";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

const Body = z.object({ paymentIntentId: z.string().regex(/^pi_[A-Za-z0-9_]+$/) });

/** After the seller paid on the site. Never trusts the browser: re-reads the PaymentIntent from Stripe. */
export async function POST(req: Request): Promise<Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid payment reference.", 400);
  const { data: { user } } = await getServerSupabase().auth.getUser();
  if (!user) return jsonError("Sign in to continue.", 401);
  const admin = getAdminSupabase();
  const { data: purchase } = await admin
    .from("premium_seat_purchases")
    .select("seller_id")
    .eq("payment_intent_id", parsed.data.paymentIntentId)
    .maybeSingle<{ seller_id: string }>();
  if (!purchase || purchase.seller_id !== user.id) return jsonError("This payment belongs to another account.", 403);
  const pi = await stripe.paymentIntents.retrieve(parsed.data.paymentIntentId);
  if (pi.status !== "succeeded") return jsonError("The payment didn't go through. Try again or use another card.", 409);
  const status = await finishSeatPayment(admin, pi);
  return status ? Response.json({ status }) : jsonError("The payment couldn't be recorded. Reload the page.", 422);
}
