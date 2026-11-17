import { z } from "zod";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { jsonError } from "@/lib/holds";
import { finishWithPaymentIntent } from "@/lib/settlement";

export const runtime = "nodejs";

const Body = z.object({ paymentIntentId: z.string().regex(/^pi_[A-Za-z0-9_]+$/) });

/** After the winner paid on the site. Never trusts the browser: re-reads the PaymentIntent from Stripe. */
export async function POST(req: Request): Promise<Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid payment reference.", 400);
  const { data: { user } } = await getServerSupabase().auth.getUser();
  if (!user) return jsonError("Sign in to continue.", 401);

  const pi = await stripe.paymentIntents.retrieve(parsed.data.paymentIntentId, { expand: ["latest_charge"] });
  if (pi.metadata?.user_id !== user.id || pi.metadata?.kind !== "buyer_premium") {
    return jsonError("This payment belongs to another account.", 403);
  }
  if (pi.status !== "succeeded") return jsonError("The payment didn't go through. Try again or use another card.", 409);
  const ok = await finishWithPaymentIntent(getAdminSupabase(), pi);
  return ok ? Response.json({ status: "paid" }) : jsonError("The payment couldn't be recorded. Reload the page.", 422);
}
