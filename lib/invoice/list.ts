import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { COUNTRY_NAMES } from "@/lib/countries";
import { addDays, fromZonedInputs } from "@/lib/zoned-time";
import type { InvoiceRow } from "./issue";

/** Invoice dates are Biddr's (Estonian) dates, as printed on the invoices. */
export const INVOICE_TZ = "Europe/Tallinn";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** The period from ?from=&to= (YYYY-MM-DD, inclusive); the current month by default. */
export function invoicePeriod(params: { from?: string; to?: string }): { from: string; to: string } {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: INVOICE_TZ }).format(new Date());
  const valid = (d?: string): d is string => Boolean(d && DATE_RE.test(d) && fromZonedInputs(d, "00:00", INVOICE_TZ));
  const from = valid(params.from) ? params.from : `${today.slice(0, 8)}01`;
  const to = valid(params.to) && params.to >= from ? params.to : today < from ? from : today;
  return { from, to };
}

/** Invoices and credit notes issued in the period, oldest first (for the accountant). */
export async function invoicesIn(admin: SupabaseClient, period: { from: string; to: string }): Promise<InvoiceRow[]> {
  const start = fromZonedInputs(period.from, "00:00", INVOICE_TZ)!;
  const end = fromZonedInputs(addDays(period.to, 1), "00:00", INVOICE_TZ)!;
  const { data } = await admin
    .from("invoices")
    .select("*")
    .gte("issued_at", start)
    .lt("issued_at", end)
    .order("issued_at", { ascending: true })
    .limit(5000)
    .returns<InvoiceRow[]>();
  return data ?? [];
}

const euros = (cents: number) => (cents / 100).toFixed(2);
const tallinnDate = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: INVOICE_TZ }).format(new Date(iso));
const csvCell = (v: string) => (/[",\n;]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** CSV for the accountant: one row per invoice or credit note, amounts in euros with a dot. */
export function invoicesCsv(rows: InvoiceRow[]): string {
  const header = [
    "Number", "Type", "Date", "Credits invoice", "Buyer", "Buyer email", "Description",
    "Net (EUR)", "VAT rate (%)", "VAT (EUR)", "Total (EUR)", "VAT country", "Car country",
  ];
  const lines = rows.map((r) =>
    [
      r.number,
      r.kind === "credit_note" ? "Credit note" : "Invoice",
      tallinnDate(r.issued_at),
      r.details.credits?.number ?? "",
      r.details.buyer.name,
      r.details.buyer.email ?? "",
      r.details.line.description,
      euros(r.net_cents),
      String(Number(r.vat_rate)),
      euros(r.vat_cents),
      euros(r.total_cents),
      r.vat_country,
      (COUNTRY_NAMES as Record<string, string>)[r.details.line.carCountry] ?? r.details.line.carCountry,
    ]
      .map(csvCell)
      .join(","),
  );
  return [header.join(","), ...lines].join("\r\n") + "\r\n";
}
