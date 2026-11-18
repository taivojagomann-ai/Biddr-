import { requireAdmin } from "@/lib/admin";
import { invoiceFileName, type InvoiceRow } from "@/lib/invoice/issue";
import { renderInvoicePdf } from "@/lib/invoice/pdf";
import { getServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * An invoice or credit note as a PDF. The buyer gets their own (RLS: "buyers read
 * their invoices"); an admin with two-step verification can open any. Everyone else: 404.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }): Promise<Response> {
  if (!UUID_RE.test(params.id)) return new Response("Not found", { status: 404 });
  const supabase = getServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Sign in to download your invoice.", { status: 401 });

  let { data: invoice } = await supabase.from("invoices").select("*").eq("id", params.id).maybeSingle<InvoiceRow>();
  if (!invoice) {
    const admin = await requireAdmin();
    if (admin) ({ data: invoice } = await admin.db.from("invoices").select("*").eq("id", params.id).maybeSingle<InvoiceRow>());
  }
  if (!invoice) return new Response("Not found", { status: 404 });

  const pdf = await renderInvoicePdf(invoice, { testMode: !process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_") });
  return new Response(Buffer.from(pdf), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${invoiceFileName(invoice)}"`,
      "cache-control": "private, no-store",
    },
  });
}
