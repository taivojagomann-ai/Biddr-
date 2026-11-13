import { randomUUID } from "node:crypto";
import { logAdminAction, requireAdmin } from "@/lib/admin";
import { INSPECTION_BUCKET, auctionIdSchema } from "@/lib/admin-schemas";

export const dynamic = "force-dynamic";

/**
 * Admin-only. Returns a one-time signed upload URL for an inspection report PDF at
 * inspection-reports/<auction id>/<random>.pdf. The browser uploads the file
 * directly; the saveInspectionReport action then attaches it to the listing.
 */
export async function POST(request: Request): Promise<Response> {
  const ctx = await requireAdmin();
  // 404, not 403: don't reveal that the admin API exists.
  if (!ctx) return new Response("Not found", { status: 404 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Send the auction id as JSON." }, { status: 400 });
  }
  const parsed = auctionIdSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "This link is broken. Reload the page." }, { status: 400 });
  const { auctionId } = parsed.data;

  const { data: auction } = await ctx.db.from("auctions").select("id").eq("id", auctionId).maybeSingle();
  if (!auction) return Response.json({ error: "This auction no longer exists." }, { status: 404 });

  const path = `${auctionId}/${randomUUID()}.pdf`;
  const { data, error } = await ctx.db.storage.from(INSPECTION_BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    console.error("signed upload url failed", error);
    return Response.json({ error: "We couldn't start the upload. Try again." }, { status: 500 });
  }

  await logAdminAction(ctx, auctionId, "inspection.upload_url", { path });
  return Response.json({ path: data.path, token: data.token });
}
