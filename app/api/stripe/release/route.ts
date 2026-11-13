import { getAdminSupabase } from "@/lib/supabase/server";
import { releaseHold } from "@/lib/holds";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type HoldRow = {
  id: string;
  user_id: string;
  stripe_payment_intent_id: string;
  auction: { status: string; leading_bidder_id: string | null };
};

/**
 * Vercel Cron (see vercel.json). Releases holds on closed and withdrawn auctions,
 * except the winner's hold on a sold car, which is kept and later captured toward the premium.
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
    .in("auction.status", ["ended", "sold", "reserve_not_met", "withdrawn"])
    .limit(100)
    .returns<HoldRow[]>();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  let released = 0;
  const failures: string[] = [];

  for (const hold of data ?? []) {
    const isWinner = hold.auction.status === "sold" && hold.auction.leading_bidder_id === hold.user_id;
    if (isWinner) continue;
    // Already cancelled or expired on Stripe's side still counts as released.
    if (await releaseHold(admin, hold)) released += 1;
    else failures.push(hold.id);
  }

  return Response.json({ released, failures });
}
