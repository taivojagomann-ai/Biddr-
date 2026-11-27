import { z } from "zod";
import { jsonError } from "@/lib/holds";
import { startSeatPayment } from "@/lib/premium-seat";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";

const Body = z.object({ auctionId: z.string().uuid() });

/** "Feature this car": starts the premium seat's payment (Stripe Payment Element). */
export async function POST(req: Request): Promise<Response> {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Missing or invalid auction.", 400);
  const { data: { user } } = await getServerSupabase().auth.getUser();
  if (!user) return jsonError("Sign in to continue.", 401);
  const r = await startSeatPayment(getAdminSupabase(), user.id, parsed.data.auctionId);
  if ("error" in r) return Response.json({ error: r.error, full: r.full ?? false }, { status: 409 });
  return Response.json(r);
}
