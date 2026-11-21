import { getAdminSupabase } from "@/lib/supabase/server";
import { BUCKET } from "@/lib/listing-checks/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DAYS = 30;
const ENDED = ["ended", "sold", "reserve_not_met", "withdrawn", "rejected"];

type Row = {
  auction_id: string;
  registration_paths: string[];
  authorisation_paths: string[];
  vin_photo_path: string | null;
  odometer_photo_path: string | null;
  auction: { status: string; ends_at: string | null; updated_at: string };
};

/**
 * Deletes the challenge photos, registration certificates and owner authorisations 30
 * days after the auction ended (or the listing was rejected or withdrawn): pg_cron calls
 * this daily with CRON_SECRET (migration 0030). The extracted values and check results
 * stay for the admins' records.
 */
export async function GET(req: Request): Promise<Response> {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  const db = getAdminSupabase();
  const cutoff = Date.now() - DAYS * 86_400_000;
  const { data, error } = await db
    .from("listing_verifications")
    .select("auction_id, registration_paths, authorisation_paths, vin_photo_path, odometer_photo_path, auction:auctions!inner(status, ends_at, updated_at)")
    .is("files_purged_at", null)
    .in("auction.status", ENDED)
    .limit(200)
    .returns<Row[]>();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let purged = 0;
  for (const r of data ?? []) {
    // Ended auctions: from the end time; rejected or withdrawn listings: from that change.
    const endedAt = Date.parse(r.auction.ends_at && r.auction.status !== "rejected" && r.auction.status !== "withdrawn" ? r.auction.ends_at : r.auction.updated_at);
    if (!(endedAt < cutoff)) continue;
    const paths = [...r.registration_paths, ...r.authorisation_paths, r.vin_photo_path, r.odometer_photo_path].filter((p): p is string => Boolean(p));
    if (paths.length) {
      const { error: removeError } = await db.storage.from(BUCKET).remove(paths);
      if (removeError) {
        console.error("listing checks purge: couldn't delete files", r.auction_id, removeError);
        continue;
      }
    }
    await db
      .from("listing_verifications")
      .update({ registration_paths: [], authorisation_paths: [], vin_photo_path: null, odometer_photo_path: null, files_purged_at: new Date().toISOString() })
      .eq("auction_id", r.auction_id);
    purged += 1;
  }
  return Response.json({ purged });
}
