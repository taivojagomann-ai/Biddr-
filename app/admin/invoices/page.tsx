import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requireAdmin } from "@/lib/admin";
import { COUNTRY_NAMES } from "@/lib/countries";
import { INVOICE_TZ, invoicePeriod, invoicesIn } from "@/lib/invoice/list";
import { formatCents } from "@/lib/invoice/pdf";

export const metadata: Metadata = { title: "Invoices" };
export const dynamic = "force-dynamic";

const date = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: INVOICE_TZ }).format(new Date(iso));
const country = (c: string) => (COUNTRY_NAMES as Record<string, string>)[c] ?? c;

export default async function InvoicesPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const ctx = await requireAdmin();
  if (!ctx) notFound();
  const period = invoicePeriod(searchParams);
  const rows = await invoicesIn(ctx.db, period);

  // Totals per VAT country and rate, for the VAT return (KMD) and OSS.
  const byVat = new Map<string, { country: string; rate: number; net: number; vat: number; total: number }>();
  for (const r of rows) {
    const key = `${r.vat_country}:${r.vat_rate}`;
    const t = byVat.get(key) ?? { country: r.vat_country, rate: Number(r.vat_rate), net: 0, vat: 0, total: 0 };
    t.net += r.net_cents;
    t.vat += r.vat_cents;
    t.total += r.total_cents;
    byVat.set(key, t);
  }
  const csvHref = `/api/admin/invoices?from=${period.from}&to=${period.to}`;

  return (
    <main className="container py-8 sm:py-12">
      <Link href="/admin/payments" className="text-sm text-mute hover:text-chalk">
        ← Payments
      </Link>
      <h1 className="mt-4 font-wide text-3xl font-extrabold tracking-tight">Invoices</h1>
      <p className="mt-1 text-sm text-mute">
        Invoices and credit notes for buyer&apos;s premiums. Dates are Estonian time, as on the invoices.
      </p>

      <form method="get" className="mt-6 flex flex-wrap items-end gap-3" aria-label="Period">
        <div>
          <label htmlFor="inv-from" className="mb-1.5 block text-sm font-semibold">
            From
          </label>
          <Input id="inv-from" name="from" type="date" defaultValue={period.from} className="w-44" />
        </div>
        <div>
          <label htmlFor="inv-to" className="mb-1.5 block text-sm font-semibold">
            To
          </label>
          <Input id="inv-to" name="to" type="date" defaultValue={period.to} className="w-44" />
        </div>
        <Button type="submit" variant="secondary">
          Show
        </Button>
        <a href={csvHref} download className="inline-flex min-h-11 items-center text-sm font-semibold underline underline-offset-4 hover:text-signal">
          Download CSV for the accountant
        </a>
      </form>

      {rows.length === 0 ? (
        <p className="mt-8 text-sm text-mute">No invoices in this period.</p>
      ) : (
        <>
          <section aria-labelledby="vat-totals" className="mt-8">
            <h2 id="vat-totals" className="text-lg font-bold">
              VAT totals
            </h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[32rem] text-left text-sm">
                <thead className="text-mute">
                  <tr>
                    <th scope="col" className="py-2 pr-4 font-semibold">Country</th>
                    <th scope="col" className="py-2 pr-4 font-semibold">Rate</th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold">Net</th>
                    <th scope="col" className="py-2 pr-4 text-right font-semibold">VAT</th>
                    <th scope="col" className="py-2 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {[...byVat.values()].map((t) => (
                    <tr key={`${t.country}:${t.rate}`} className="border-t border-line">
                      <td className="py-2 pr-4">{country(t.country)}</td>
                      <td className="py-2 pr-4 tabular">{t.rate}%</td>
                      <td className="py-2 pr-4 text-right tabular">{formatCents(t.net)}</td>
                      <td className="py-2 pr-4 text-right tabular">{formatCents(t.vat)}</td>
                      <td className="py-2 text-right tabular">{formatCents(t.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section aria-labelledby="invoice-list" className="mt-8">
            <h2 id="invoice-list" className="text-lg font-bold">
              {rows.length} {rows.length === 1 ? "document" : "documents"}
            </h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[48rem] text-left text-sm">
                <thead className="text-mute">
                  <tr>
                    <th scope="col" className="py-2 pr-4 font-semibold">Number</th>
                    <th scope="col" className="py-2 pr-4 font-semibold">Date</th>
                    <th scope="col" className="py-2 pr-4 font-semibold">Buyer</th>
                    <th scope="col" className="py-2 pr-4 font-semibold">Car</th>
                    <th scope="col" className="py-2 pr-4 font-semibold">VAT</th>
                    <th scope="col" className="py-2 text-right font-semibold">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-t border-line align-top">
                      <td className="py-2 pr-4">
                        <a href={`/api/invoices/${r.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4 hover:text-signal">
                          {r.number}
                          <span className="sr-only"> (PDF, opens in a new tab)</span>
                        </a>
                        {r.kind === "credit_note" ? (
                          <span className="block text-xs text-mute">Credit note for {r.details.credits?.number}</span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-4">{date(r.issued_at)}</td>
                      <td className="py-2 pr-4">{r.details.buyer.name}</td>
                      <td className="py-2 pr-4">
                        <Link href={`/admin/auctions/${r.auction_id}`} className="underline-offset-4 hover:underline">
                          {r.details.line.description.replace(/^Buyer's premium: /, "")}
                        </Link>
                      </td>
                      <td className="py-2 pr-4 tabular">
                        {formatCents(r.vat_cents)} ({Number(r.vat_rate)}%, {r.vat_country})
                      </td>
                      <td className="py-2 text-right tabular">{formatCents(r.total_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </main>
  );
}
