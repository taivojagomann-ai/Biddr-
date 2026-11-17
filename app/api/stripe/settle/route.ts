import { getAdminSupabase } from "@/lib/supabase/server";
import { settlePending } from "@/lib/settlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Settles buyer's premiums for sold auctions (lib/settlement.ts). Called by the
 * database when an auction is sold and every 5 minutes by pg_cron (call_app_job,
 * migration 0022), with "Authorization: Bearer $CRON_SECRET". Idempotent.
 */
export async function GET(req: Request): Promise<Response> {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json(await settlePending(getAdminSupabase()));
}
