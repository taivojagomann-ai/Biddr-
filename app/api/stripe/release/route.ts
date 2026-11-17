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
    .order("created_at", { ascending: true })
    .limit(2000)
    .returns<HoldRow[]>();

  if (error) return Response.json({ error: error.message }, { status: 500 });

  let released = 0;
  const failures: string[] = [];

  // The winner's hold on a sold car stays open (it's captured toward the premium), so it's
  // skipped before taking the batch: otherwise enough of them would fill the batch and
  // block every other release.
  const toRelease = (data ?? [])
    .filter((h) => !(h.auction.status === "sold" && h.auction.leading_bidder_id === h.user_id))
    .slice(0, 100);
  for (const hold of toRelease) {
    // Already cancelled or expired on Stripe's side still counts as released.
    if (await releaseHold(admin, hold)) released += 1;
    else failures.push(hold.id);
  }

  return Response.json({ released, failures });
}
