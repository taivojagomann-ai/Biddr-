import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { COMPANY } from "@/lib/company";
import { partyContact } from "@/lib/contacts";
import { formatEur } from "@/lib/format";
import { ensureInvoice, type InvoiceRow } from "@/lib/invoice/issue";
import { renderReceiptPdf } from "@/lib/invoice/pdf";
import { splitVat } from "@/lib/invoice/vat";
import { PREMIUM_MAX, PREMIUM_MIN, PREMIUM_RATE } from "@/lib/pricing";
import type { BuyerPaymentRow } from "@/lib/settlement";
import { stripe } from "@/lib/stripe";

/**
 * Receipts for the buyer's premium (DECISIONS.md point 12): a payment receipt once
 * the premium is paid in full, and a refund receipt for each refund (partial ones
 * too). Same branding, company details and VAT as the invoice it settles; its own
 * number series (R-<year>-0001). The PDF is stored privately in the "receipts" bucket.
 */

export const RECEIPT_BUCKET = "receipts";

export type ReceiptType = "payment" | "refund";

export interface ReceiptCharge {
  kind: "hold_capture" | "card_charge" | "refund";
  label: string;
  amountCents: number;
  paymentIntent: string | null;
  charge: string | null;
  refund?: string | null;
  brand: string | null;
  last4: string | null;
  at: string | null;
}

export interface ReceiptDetails {
  payee: { name: string; registryCode: string; vatNumber: string; addressLines: string[]; email: string };
  payer: { name: string; email: string | null };
  reference: { invoiceNumber: string | null; auctionTitle: string; vin: string | null; auctionEndedAt: string | null };
  line: { description: string; winningBid: number; basis: string; premium: number };
  /** Refund receipts: the payment receipt and invoice they refer to. */
  refunds?: { receiptNumber: string; invoiceNumber: string | null };
}

export interface ReceiptRow {
  id: string;
  number: string;
  type: ReceiptType;
  buyer_payment_id: string;
  auction_id: string;
  buyer_id: string;
  invoice_id: string | null;
  refunds_receipt_id: string | null;
  stripe_refund_ids: string[];
  amount: number;
  currency: "EUR";
  net_cents: number;
  vat_cents: number;
  vat_rate: number;
  vat_country: string;
  charges: ReceiptCharge[];
  details: ReceiptDetails;
  pdf_path: string | null;
  issued_at: string;
}

type Admin = SupabaseClient;

const BASIS = `${Math.round(PREMIUM_RATE * 100)}% of the winning bid (minimum ${formatEur(PREMIUM_MIN)}, maximum ${formatEur(PREMIUM_MAX)})`;
const testMode = () => !process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_");

export const receiptTitle = (type: ReceiptType) => (type === "refund" ? "Refund receipt" : "Receipt");
export const receiptFileName = (r: Pick<ReceiptRow, "number" | "type">) => `Biddr-${r.type === "refund" ? "refund-receipt" : "receipt"}-${r.number}.pdf`;

/** The card used for a PaymentIntent's charge: brand, last 4, the charge id and when it happened. Best effort. */
async function cardOf(paymentIntent: string | null): Promise<{ charge: string | null; brand: string | null; last4: string | null; at: string | null }> {
  const none = { charge: null, brand: null, last4: null, at: null };
  if (!paymentIntent) return none;
  try {
    const pi = await stripe.paymentIntents.retrieve(paymentIntent, { expand: ["latest_charge"] });
    const charge = pi.latest_charge;
    if (!charge || typeof charge === "string") return { ...none, charge: typeof charge === "string" ? charge : null };
    const card = (charge as Stripe.Charge).payment_method_details?.card;
    return {
      charge: charge.id,
      brand: card?.brand ?? null,
      last4: card?.last4 ?? null,
      at: charge.created ? new Date(charge.created * 1000).toISOString() : null,
    };
  } catch (e) {
    console.error("receipt: couldn't read the card", paymentIntent, e);
    return none;
  }
}

async function context(admin: Admin, payment: BuyerPaymentRow, invoice: InvoiceRow | null) {
  const [{ data: auction }, payer] = await Promise.all([
    admin.from("auctions").select("title, vin, ends_at").eq("id", payment.auction_id).maybeSingle<{ title: string; vin: string | null; ends_at: string | null }>(),
    partyContact(admin, payment.winner_id),
  ]);
  const details: ReceiptDetails = {
    payee: { ...COMPANY, addressLines: [...COMPANY.addressLines] },
    payer: { name: payer.fullName ?? "Biddr member", email: payer.email },
    reference: { invoiceNumber: invoice?.number ?? null, auctionTitle: auction?.title ?? "Car", vin: auction?.vin ?? null, auctionEndedAt: auction?.ends_at ?? null },
    line: { description: `Buyer's premium: ${auction?.title ?? "car"}`, winningBid: payment.winning_bid, basis: BASIS, premium: payment.premium_amount },
  };
  return details;
}

/**
 * Stores the PDF and, for the caller that stored it, tells the winner (bell, and email
 * when email is set up). Returns the receipt with its path.
 */
async function storeAndNotify(admin: Admin, receipt: ReceiptRow): Promise<ReceiptRow> {
  if (receipt.pdf_path) return receipt;
  const pdf = await renderReceiptPdf(receipt, { testMode: testMode() });
  const path = `${receipt.buyer_id}/${receipt.number}.pdf`;
  const { error: upErr } = await admin.storage.from(RECEIPT_BUCKET).upload(path, Buffer.from(pdf), { contentType: "application/pdf", upsert: true });
  if (upErr) throw new Error(`receipt upload failed: ${upErr.message}`);
  // Only the caller that fills in the path notifies (a concurrent call finds it set).
  const { data: claimed } = await admin.from("receipts").update({ pdf_path: path }).eq("id", receipt.id).is("pdf_path", null).select("id");
  if (claimed?.length) {
    await admin.from("notifications").insert({
      user_id: receipt.buyer_id,
      type: "receipt_ready",
      auction_id: receipt.auction_id,
      data: { receipt_id: receipt.id, number: receipt.number, receipt_type: receipt.type, amount_cents: receipt.amount },
    });
  }
  return { ...receipt, pdf_path: path };
}

/**
 * The payment receipt, once the premium is paid in full (status 'paid', or 'refunded'
 * after it was paid). Never before. Issued once: later calls return the same receipt.
 */
export async function ensureReceipt(admin: Admin, paymentId: string): Promise<ReceiptRow | null> {
  const { data: found } = await admin.from("receipts").select("*").eq("buyer_payment_id", paymentId).eq("type", "payment").maybeSingle<ReceiptRow>();
  if (found) return storeAndNotify(admin, found);

  const { data: payment } = await admin.from("buyer_payments").select("*").eq("id", paymentId).maybeSingle<BuyerPaymentRow>();
  if (!payment || (payment.status !== "paid" && payment.status !== "refunded") || !payment.paid_at) return null;
  const invoice = await ensureInvoice(admin, payment.id);
  if (!invoice) return null;

  const fromHold = (payment.captured_from_hold ?? 0) * 100;
  const rest = payment.premium_amount * 100 - fromHold;
  const charges: ReceiptCharge[] = [];
  if (fromHold > 0) charges.push({ kind: "hold_capture", label: "Captured from card hold", amountCents: fromHold, paymentIntent: payment.hold_payment_intent_id, ...(await cardOf(payment.hold_payment_intent_id)) });
  if (rest > 0) charges.push({ kind: "card_charge", label: "Charged to card", amountCents: rest, paymentIntent: payment.remainder_payment_intent_id, ...(await cardOf(payment.remainder_payment_intent_id)) });

  const total = payment.premium_amount * 100;
  // VAT exactly as on the invoice: the same rate and country, the same split.
  const { netCents, vatCents } = splitVat(total, Number(invoice.vat_rate));
  const { data, error } = await admin
    .rpc("issue_receipt", {
      p_type: "payment",
      p_buyer_payment_id: payment.id,
      p_auction_id: payment.auction_id,
      p_buyer_id: payment.winner_id,
      p_invoice_id: invoice.id,
      p_refunds_receipt_id: null,
      p_stripe_refund_ids: [],
      p_amount: total,
      p_net_cents: netCents,
      p_vat_cents: vatCents,
      p_vat_rate: invoice.vat_rate,
      p_vat_country: invoice.vat_country,
      p_charges: charges,
      p_details: await context(admin, payment, invoice),
      p_issued_at: payment.paid_at,
    })
    .single<ReceiptRow>();
  if (error || !data) throw new Error(`issue_receipt failed: ${error?.message ?? "no row"}`);
  return storeAndNotify(admin, data);
}

export interface RefundInput {
  id: string;
  amountCents: number;
  paymentIntent: string | null;
  charge: string | null;
  at: string | null;
}

/**
 * A refund receipt for these Stripe refunds (full or partial), referring to the payment
 * receipt and the invoice. Refunds that already have a receipt are left out; returns
 * null when none is left.
 */
export async function ensureRefundReceipt(admin: Admin, paymentId: string, refunds: RefundInput[]): Promise<ReceiptRow | null> {
  const { data: payment } = await admin.from("buyer_payments").select("*").eq("id", paymentId).maybeSingle<BuyerPaymentRow>();
  if (!payment) return null;
  const original = await ensureReceipt(admin, paymentId);
  if (!original) return null;
  const { data: done } = await admin.from("receipts").select("stripe_refund_ids").eq("buyer_payment_id", paymentId).eq("type", "refund").returns<{ stripe_refund_ids: string[] }[]>();
  const covered = new Set((done ?? []).flatMap((r) => r.stripe_refund_ids));
  const fresh = refunds.filter((r) => r.amountCents > 0 && !covered.has(r.id));
  if (!fresh.length) return null;

  const charges: ReceiptCharge[] = [];
  for (const r of fresh) {
    const card = original.charges.find((c) => c.paymentIntent && c.paymentIntent === r.paymentIntent);
    charges.push({
      kind: "refund",
      label: card?.kind === "hold_capture" ? "Refunded (captured from card hold)" : "Refunded to card",
      amountCents: r.amountCents,
      paymentIntent: r.paymentIntent,
      charge: r.charge ?? card?.charge ?? null,
      refund: r.id,
      brand: card?.brand ?? null,
      last4: card?.last4 ?? null,
      at: r.at,
    });
  }
  const amount = fresh.reduce((s, r) => s + r.amountCents, 0);
  const { netCents, vatCents } = splitVat(amount, Number(original.vat_rate));
  const details: ReceiptDetails = {
    ...original.details,
    refunds: { receiptNumber: original.number, invoiceNumber: original.details.reference.invoiceNumber },
  };
  const { data, error } = await admin
    .rpc("issue_receipt", {
      p_type: "refund",
      p_buyer_payment_id: payment.id,
      p_auction_id: payment.auction_id,
      p_buyer_id: payment.winner_id,
      p_invoice_id: original.invoice_id,
      p_refunds_receipt_id: original.id,
      p_stripe_refund_ids: fresh.map((r) => r.id),
      p_amount: amount,
      p_net_cents: netCents,
      p_vat_cents: vatCents,
      p_vat_rate: original.vat_rate,
      p_vat_country: original.vat_country,
      p_charges: charges,
      p_details: details,
      p_issued_at: fresh.map((r) => r.at).filter(Boolean).sort().pop() ?? new Date().toISOString(),
    })
    .maybeSingle<ReceiptRow>();
  if (error) throw new Error(`issue_receipt failed: ${error.message}`);
  if (!data) return null; // another call receipted these refunds meanwhile
  return storeAndNotify(admin, data);
}

/**
 * A charge on a premium was refunded (Stripe's charge.refunded, e.g. a partial refund
 * made in Stripe's dashboard): a refund receipt for the refunds that don't have one yet.
 */
export async function receiptForRefundedCharge(admin: Admin, charge: Stripe.Charge): Promise<ReceiptRow | null> {
  const pi = typeof charge.payment_intent === "string" ? charge.payment_intent : (charge.payment_intent?.id ?? null);
  if (!pi) return null;
  const { data: payment } = await admin
    .from("buyer_payments")
    .select("id")
    .or(`hold_payment_intent_id.eq.${pi},remainder_payment_intent_id.eq.${pi}`)
    .in("status", ["paid", "refunded"])
    .maybeSingle<{ id: string }>();
  if (!payment) return null;
  const list = await stripe.refunds.list({ charge: charge.id, limit: 100 });
  const refunds: RefundInput[] = list.data
    .filter((r) => r.status === "succeeded" || r.status === "pending")
    .map((r) => ({ id: r.id, amountCents: r.amount, paymentIntent: pi, charge: charge.id, at: new Date(r.created * 1000).toISOString() }));
  return ensureRefundReceipt(admin, payment.id, refunds);
}

/** Payment receipts that weren't issued when the premium was paid (the settlement job retries). */
export async function issueMissingReceipts(admin: Admin, limit = 50): Promise<number> {
  const { data: payments } = await admin
    .from("buyer_payments")
    .select("id")
    .in("status", ["paid", "refunded"])
    .not("paid_at", "is", null)
    .order("updated_at", { ascending: false })
    .limit(limit)
    .returns<{ id: string }[]>();
  if (!payments?.length) return 0;
  const { data: issued } = await admin
    .from("receipts")
    .select("buyer_payment_id, pdf_path")
    .eq("type", "payment")
    .in("buyer_payment_id", payments.map((p) => p.id))
    .returns<{ buyer_payment_id: string; pdf_path: string | null }[]>();
  const done = new Set((issued ?? []).filter((r) => r.pdf_path).map((r) => r.buyer_payment_id));
  let n = 0;
  for (const p of payments) {
    if (done.has(p.id)) continue;
    try {
      if (await ensureReceipt(admin, p.id)) n += 1;
    } catch (e) {
      console.error("receipt: issuing failed", p.id, e);
    }
  }
  return n;
}
