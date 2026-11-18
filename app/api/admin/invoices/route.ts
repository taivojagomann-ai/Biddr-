import { logAdminAction, requireAdmin } from "@/lib/admin";
import { invoicePeriod, invoicesCsv, invoicesIn } from "@/lib/invoice/list";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** CSV of the invoices and credit notes issued in ?from=&to= (admins with two-step verification only). */
export async function GET(req: Request): Promise<Response> {
  const ctx = await requireAdmin();
  if (!ctx) return new Response("Not found", { status: 404 });
  const url = new URL(req.url);
  const period = invoicePeriod({ from: url.searchParams.get("from") ?? undefined, to: url.searchParams.get("to") ?? undefined });
  const rows = await invoicesIn(ctx.db, period);
  await logAdminAction(ctx, null, "invoices.export", { ...period, count: rows.length });
  return new Response(invoicesCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="biddr-invoices-${period.from}-to-${period.to}.csv"`,
      "cache-control": "private, no-store",
    },
  });
}
