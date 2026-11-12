import { getAdminSupabase } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HoldRow = {
  id: string;
  user_id: string;
  stripe_payment_intent_id: string;
  auction: { status: string; leading_bidder_id: string | null };
};

/**
 * Vercel Cron (see vercel.json). Releases holds on closed auctions, except the
 * winner's hold on a sold car, which is kept and later captured toward the premium.
 */
export async function GET(req: Request): Promise<Response> {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const admin = getAdminSupabase();
  const { data, error } = await admin
    .from("bid_holds")
    .select("id,user_id,stripe_payment_intent_id,auction:auctions!inner(status,leading_bidder_id)")
    .eq("status", "authorized")
    .in("auction.status", ["ended", "sold", "reserve_not_met"])
    .limit(100)
    .returns<HoldRow[]>();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  let released = 0;
  const failures: string[] = [];

  for (const hold of data ?? []) {
    const isWinner = hold.auction.status === "sold" && hold.auction.leading_bidder_id === hold.user_id;
    if (isWinner) continue;
    try {
      await stripe.paymentIntents.cancel(hold.stripe_payment_intent_id, { cancellation_reason: "abandoned" });
    } catch (e) {
      // Already canceled or expired on Stripe's side: still mark it released locally.
      const code = (e as { code?: string }).code;
      if (code !== "payment_intent_unexpected_state") {
        failures.push(hold.id);
        continue;
      }
    }
    await admin.from("bid_holds").update({ status: "released" }).eq("id", hold.id);
    released += 1;
  }

  return Response.json({ released, failures });
}
