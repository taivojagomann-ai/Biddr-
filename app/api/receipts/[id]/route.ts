import { requireAdmin } from "@/lib/admin";
import { RECEIPT_BUCKET, receiptFileName, type ReceiptRow } from "@/lib/receipts/issue";
import { renderReceiptPdf } from "@/lib/invoice/pdf";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The signed link only has to last until the browser opens it. */
const SIGNED_SECONDS = 60;

/**
 * A receipt or refund receipt: the winner gets their own (RLS: "buyers read their
 * receipts"), an admin with two-step verification any; everyone else 404. Redirects to
 * a short-lived signed link to the stored PDF (private bucket), which opens in the
 * browser's PDF viewer.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<Response> {
  if (!UUID_RE.test(params.id)) return new Response("Not found", { status: 404 });
  const supabase = getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in to download your receipt.", { status: 401 });

  let { data: receipt } = await supabase.from("receipts").select("*").eq("id", params.id).maybeSingle<ReceiptRow>();
  if (!receipt) {
    const admin = await requireAdmin();
    if (admin) ({ data: receipt } = await admin.db.from("receipts").select("*").eq("id", params.id).maybeSingle<ReceiptRow>());
  }
  if (!receipt) return new Response("Not found", { status: 404 });

  const db = getAdminSupabase();
  let path = receipt.pdf_path;
  if (!path) {
    // Not stored yet (an upload failed): store it now.
    const pdf = await renderReceiptPdf(receipt, { testMode: !process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") });
    path = `${receipt.buyer_id}/${receipt.number}.pdf`;
    await db.storage.from(RECEIPT_BUCKET).upload(path, Buffer.from(pdf), { contentType: "application/pdf", upsert: true });
    await db.from("receipts").update({ pdf_path: path }).eq("id", receipt.id).is("pdf_path", null);
  }
  const { data: signed, error } = await db.storage.from(RECEIPT_BUCKET).createSignedUrl(path, SIGNED_SECONDS, { download: false });
  if (error || !signed) return new Response("The receipt couldn't be opened. Try again.", { status: 500 });
  // The stored file is already named after the receipt number (<buyer>/<number>.pdf).
  return new Response(null, {
    status: 302,
    headers: { location: signed.signedUrl, "cache-control": "private, no-store", "x-receipt-file": receiptFileName(receipt) },
  });
}
