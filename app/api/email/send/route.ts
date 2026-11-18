import { processEmailOutbox } from "@/lib/email/outbox";
import { getAdminSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Sends pending emails (lib/email/outbox.ts). Called by the database right after an
 * emailed notification is created and every 5 minutes (call_app_job, migration 0028),
 * with "Authorization: Bearer $CRON_SECRET". Does nothing until SMTP is configured.
 */
export async function GET(req: Request): Promise<Response> {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json(await processEmailOutbox(getAdminSupabase()));
}
