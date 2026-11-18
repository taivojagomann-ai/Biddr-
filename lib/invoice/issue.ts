import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { COMPANY } from "@/lib/company";
import { partyContact } from "@/lib/contacts";
import { formatEur } from "@/lib/format";
import { PREMIUM_MAX, PREMIUM_MIN, PREMIUM_RATE } from "@/lib/pricing";
import type { BuyerPaymentRow } from "@/lib/settlement";
import { splitVat, vatRateFor } from "./vat";

export type InvoiceKind = "invoice" | "credit_note";

/** What the document shows, saved with the invoice when it is issued. */
export interface InvoiceDetails {
  issuer: { name: string; registryCode: string; vatNumber: string; addressLines: string[]; email: string };
  buyer: { name: string; email: string | null };
  line: { description: string; winningBid: number; basis: string; carCountry: string };
  /** How the premium was paid (invoices) or refunded (credit notes). */
  payments: { label: string; amountCents: number; reference: string | null }[];
  paidAt: string | null;
  /** Credit notes: the invoice they cancel. */
  credits?: { number: string; issuedAt: string };
}

export interface InvoiceRow {
  id: string;
  number: string;
  kind: InvoiceKind;
  buyer_payment_id: string;
  auction_id: string;
  buyer_id: string;
  credited_invoice_id: string | null;
  issued_at: string;
  currency: "EUR";
  total_cents: number;
  net_cents: number;
  vat_cents: number;
  vat_rate: number;
  vat_country: string;
  details: InvoiceDetails;
}

type Admin = SupabaseClient;

const BASIS = `${Math.round(PREMIUM_RATE * 100)}% of the winning bid (minimum ${formatEur(PREMIUM_MIN)}, maximum ${formatEur(PREMIUM_MAX)})`;

async function existing(admin: Admin, paymentId: string, kind: InvoiceKind): Promise<InvoiceRow | null> {
  const { data } = await admin.from("invoices").select("*").eq("buyer_payment_id", paymentId).eq("kind", kind).maybeSingle<InvoiceRow>();
  return data ?? null;
}

async function issue(
  admin: Admin,
  args: {
    kind: InvoiceKind;
    payment: BuyerPaymentRow;
    creditedId: string | null;
    totalCents: number;
    vat: { country: string; rate: number };
    details: InvoiceDetails;
  },
): Promise<InvoiceRow> {
  const { netCents, vatCents } = splitVat(Math.abs(args.totalCents), args.vat.rate);
  const sign = args.totalCents < 0 ? -1 : 1;
  const { data, error } = await admin
    .rpc("issue_invoice", {
      p_kind: args.kind,
      p_buyer_payment_id: args.payment.id,
      p_auction_id: args.payment.auction_id,
      p_buyer_id: args.payment.winner_id,
      p_credited_invoice_id: args.creditedId,
      p_total_cents: args.totalCents,
      p_net_cents: sign * netCents,
      p_vat_cents: sign * vatCents,
      p_vat_rate: args.vat.rate,
      p_vat_country: args.vat.country,
      p_details: args.details,
    })
    .single<InvoiceRow>();
  if (error || !data) throw new Error(`issue_invoice failed: ${error?.message ?? "no row"}`);
  return data;
}

/**
 * The invoice for a paid premium, issued once (later calls return the same invoice).
 * VAT: the rate of the country the car is in; the premium includes it.
 */
export async function ensureInvoice(admin: Admin, paymentId: string): Promise<InvoiceRow | null> {
  const found = await existing(admin, paymentId, "invoice");
  if (found) return found;

  const { data: payment } = await admin.from("buyer_payments").select("*").eq("id", paymentId).maybeSingle<BuyerPaymentRow>();
  // Paid premiums are invoiced (a refunded one was paid first). When the buyer didn't pay,
  // only what was kept from the card hold is (DECISIONS.md point 12).
  if (!payment) return null;
  const retained = payment.status === "unpaid";
  if (retained ? (payment.captured_from_hold ?? 0) <= 0 : payment.status !== "paid" && payment.status !== "refunded") return null;

  const [{ data: auction }, buyer] = await Promise.all([
    admin.from("auctions").select("title, location_country").eq("id", payment.auction_id).maybeSingle<{ title: string; location_country: string | null }>(),
    partyContact(admin, payment.winner_id),
  ]);
  const vat = vatRateFor(auction?.location_country);
  const fromHold = payment.captured_from_hold ?? 0;
  const rest = retained ? 0 : payment.premium_amount - fromHold;

  const payments: InvoiceDetails["payments"] = [];
  if (fromHold > 0) payments.push({ label: "Taken from the card hold", amountCents: fromHold * 100, reference: payment.hold_payment_intent_id });
  if (rest > 0) payments.push({ label: "Charged to the card", amountCents: rest * 100, reference: payment.remainder_payment_intent_id });

  return issue(admin, {
    kind: "invoice",
    payment,
    creditedId: null,
    totalCents: (retained ? fromHold : payment.premium_amount) * 100,
    vat,
    details: {
      issuer: { ...COMPANY, addressLines: [...COMPANY.addressLines] },
      buyer: { name: buyer.fullName ?? "Biddr member", email: buyer.email },
      line: {
        description: retained
          ? `Buyer's premium, part kept from the card hold (the premium wasn't paid in full and the sale was cancelled): ${auction?.title ?? "car"}`
          : `Buyer's premium: ${auction?.title ?? "car"}`,
        winningBid: payment.winning_bid,
        basis: BASIS,
        carCountry: vat.country,
      },
      payments,
      paidAt: payment.paid_at,
    },
  });
}

/** The credit note for a refunded premium: the invoice's amounts, negative. Issues the invoice first if missing. */
export async function ensureCreditNote(admin: Admin, paymentId: string): Promise<InvoiceRow | null> {
  const found = await existing(admin, paymentId, "credit_note");
  if (found) return found;
  const invoice = await ensureInvoice(admin, paymentId);
  if (!invoice) return null;
  const { data: payment } = await admin.from("buyer_payments").select("*").eq("id", paymentId).maybeSingle<BuyerPaymentRow>();
  if (!payment || payment.status !== "refunded") return null;

  return issue(admin, {
    kind: "credit_note",
    payment,
    creditedId: invoice.id,
    totalCents: -invoice.total_cents,
    vat: { country: invoice.vat_country, rate: Number(invoice.vat_rate) },
    details: {
      ...invoice.details,
      payments: [{ label: "Refunded to the card", amountCents: -invoice.total_cents, reference: null }],
      paidAt: null,
      credits: { number: invoice.number, issuedAt: invoice.issued_at },
    },
  });
}

/**
 * Issues missing invoices for recently paid premiums, and credit notes for refunded
 * ones (the settlement job calls this, so a failed attempt is retried). Returns how many.
 */
export async function issueMissingInvoices(admin: Admin, limit = 50): Promise<number> {
  const { data: payments } = await admin
    .from("buyer_payments")
    .select("id, status")
    .in("status", ["paid", "refunded", "unpaid"])
    .order("updated_at", { ascending: false })
    .limit(limit)
    .returns<{ id: string; status: string }[]>();
  if (!payments?.length) return 0;
  const { data: issued } = await admin
    .from("invoices")
    .select("buyer_payment_id, kind")
    .in("buyer_payment_id", payments.map((p) => p.id))
    .returns<{ buyer_payment_id: string; kind: InvoiceKind }[]>();
  const has = new Set((issued ?? []).map((i) => `${i.buyer_payment_id}:${i.kind}`));
  let n = 0;
  for (const p of payments) {
    try {
      if (!has.has(`${p.id}:invoice`) && (await ensureInvoice(admin, p.id))) n += 1;
      if (p.status === "refunded" && !has.has(`${p.id}:credit_note`) && (await ensureCreditNote(admin, p.id))) n += 1;
    } catch (e) {
      console.error("invoice: issuing failed", p.id, e);
    }
  }
  return n;
}

export const invoiceTitle = (kind: InvoiceKind) => (kind === "credit_note" ? "Credit note" : "Invoice");
export const invoiceFileName = (inv: Pick<InvoiceRow, "number" | "kind">) =>
  `Biddr-${inv.kind === "credit_note" ? "credit-note" : "invoice"}-${inv.number}.pdf`;
