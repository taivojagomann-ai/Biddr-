import { requireAdmin } from "@/lib/admin";
import { REPORT_BUCKET } from "@/lib/sell";

export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Signed links last one minute: long enough to open, too short to share. */
const SIGNED_URL_SECONDS = 60;

/**
 * Admin-only. Opens one of the seller's private dealer report files:
 * /api/admin/inspection-file?auction=<id>&file=<index> redirects to a short-lived
 * signed URL in the private inspection-uploads bucket. Paths come from
 * auction_private, never from the request.
 */
export async function GET(request: Request): Promise<Response> {
  const ctx = await requireAdmin();
  // 404, not 403: don't reveal that the admin API exists.
  if (!ctx) return new Response("Not found", { status: 404 });

  const url = new URL(request.url);
  const auctionId = url.searchParams.get("auction") ?? "";
  const index = Number(url.searchParams.get("file"));
  if (!UUID_RE.test(auctionId) || !Number.isInteger(index) || index < 0) {
    return new Response("This link is broken. Reload the admin page.", { status: 400 });
  }

  const { data } = await ctx.db
    .from("auction_private")
    .select("dealer_report_paths")
    .eq("auction_id", auctionId)
    .maybeSingle<{ dealer_report_paths: string[] | null }>();
  const path = data?.dealer_report_paths?.[index];
  if (!path) return new Response("This file no longer exists.", { status: 404 });

  const { data: signed, error } = await ctx.db.storage.from(REPORT_BUCKET).createSignedUrl(path, SIGNED_URL_SECONDS);
  if (error || !signed?.signedUrl) return new Response("We couldn't open this file. Try again.", { status: 502 });

  return new Response(null, {
    status: 302,
    headers: { Location: signed.signedUrl, "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
  });
}
