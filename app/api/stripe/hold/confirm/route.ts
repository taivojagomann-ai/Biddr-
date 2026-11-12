import { z } from "zod";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { jsonError, markHoldAuthorized } from "@/lib/holds";

export const runtime = "nodejs";

const Body = z.object({ paymentIntentId: z.string().regex(/^pi_[A-Za-z0-9]+$/) });

/** Called by the client right after confirmPayment. Never trusts the client's status: re-reads from Stripe. */
export async function POST(req: Request): Promise<Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid payment reference.", 400);

  const { data: { user } } = await getServerSupabase().auth.getUser();
  if (!user) return jsonError("Sign in to continue.", 401);

  const pi = await stripe.paymentIntents.retrieve(parsed.data.paymentIntentId);
  if (pi.metadata.user_id !== user.id) return jsonError("This card check belongs to another account.", 403);
  if (pi.status !== "requires_capture") return jsonError("The hold wasn't approved by your bank.", 409);

  const ok = await markHoldAuthorized(getAdminSupabase(), pi);
  return ok ? Response.json({ status: "authorized" }) : jsonError("The hold couldn't be recorded.", 422);
}
