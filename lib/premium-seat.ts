import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { COMPANY } from "@/lib/company";
import { partyContact } from "@/lib/contacts";
import { issueInvoiceRow, type InvoiceRow } from "@/lib/invoice/issue";
import { splitVat, vatRateFor } from "@/lib/invoice/vat";
import { cardOf, storeAndNotify, type ReceiptCharge, type ReceiptDetails, type ReceiptRow } from "@/lib/receipts/issue";
import { stripe } from "@/lib/stripe";

/**
 * Premium seats (DECISIONS.md points 9 and 11): an optional, paid place in the home page's
 * featured carousel for a scheduled or live auction, always labelled "Featured", lasting
 * until the auction ends. One-time Stripe PaymentIntent (automatic capture); an invoice
 * and a receipt like the buyer's premium (VAT of the car's country, included in the
 * price). At most N paid seats at once (admin setting). Refunded automatically when the
 * auction is withdrawn before it goes live or an admin removes the seat.
 */

type Admin = SupabaseClient;

export const SEAT_DEFAULTS = { priceEur: 29, limit: 5 } as const;
export const SEAT_DESCRIPTION = "Premium seat: featured on Biddr's home page, labelled \"Featured\", until the auction ends";
export const SEAT_REFUND_RULES =
  "If you withdraw the auction before it goes live, or Biddr removes the seat, you get your money back automatically. Once the auction has gone live there's no automatic refund.";
export const SEATS_FULL = "All featured places are taken right now";

export interface SeatPurchase {
  id: string;
  auction_id: string;
  seller_id: string;
  amount_cents: number;
  status: "pending" | "paid" | "failed" | "refunded" | "canceled";
  payment_intent_id: string | null;
  paid_at: string | null;
  refunded_at: string | null;
  refund_id: string | null;
  refund_reason: string | null;
  created_at: string;
}

type SeatAuction = {
  id: string;
  title: string;
  status: string;
  seller_id: string;
  ends_at: string | null;
  starts_at: string | null;
  vin: string | null;
  location_country: string | null;
  premium_seat_until: string | null;
  premium_seat_source: string | null;
};
const AUCTION_COLUMNS = "id, title, status, seller_id, ends_at, starts_at, vin, location_country, premium_seat_until, premium_seat_source";

export async function seatSettings(admin: Admin): Promise<{ priceEur: number; limit: number }> {
  const { data } = await admin.from("site_settings").select("key, value").in("key", ["premium_seat_price_eur", "premium_seat_limit"]).returns<{ key: string; value: unknown }[]>();
  const get = (k: string, d: number) => {
    const v = Number((data ?? []).find((r) => r.key === k)?.value);
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  return { priceEur: get("premium_seat_price_eur", SEAT_DEFAULTS.priceEur), limit: Math.floor(get("premium_seat_limit", SEAT_DEFAULTS.limit)) };
}

/** Paid seats taking a place now: on scheduled or live auctions that haven't ended. */
export async function activePaidSeats(admin: Admin): Promise<number> {
  const { count } = await admin
    .from("auctions")
    .select("id", { count: "exact", head: true })
    .eq("premium_seat_source", "paid")
    .gt("premium_seat_until", new Date().toISOString())
    .in("status", ["upcoming", "live"]);
  return count ?? 0;
}

/** Whether this seller can buy a seat for this auction now, and why not. */
export async function seatOffer(
  admin: Admin,
  sellerId: string,
  auctionId: string,
): Promise<{ state: "available" | "featured" | "full" | "not_eligible"; priceEur: number; until?: string | null; reason?: string }> {
  const settings = await seatSettings(admin);
  const { data: a } = await admin.from("auctions").select(AUCTION_COLUMNS).eq("id", auctionId).maybeSingle<SeatAuction>();
  if (!a || a.seller_id !== sellerId) return { state: "not_eligible", priceEur: settings.priceEur, reason: "This listing isn't yours." };
  if (a.premium_seat_until && Date.parse(a.premium_seat_until) > Date.now()) return { state: "featured", priceEur: settings.priceEur, until: a.premium_seat_until };
  if ((a.status !== "upcoming" && a.status !== "live") || !a.ends_at || Date.parse(a.ends_at) <= Date.now()) {
    return { state: "not_eligible", priceEur: settings.priceEur, reason: "Only a scheduled or live auction can be featured." };
  }
  if ((await activePaidSeats(admin)) >= settings.limit) return { state: "full", priceEur: settings.priceEur };
  return { state: "available", priceEur: settings.priceEur };
}

/** Starts (or resumes) the payment: a one-time PaymentIntent with automatic capture. */
export async function startSeatPayment(admin: Admin, sellerId: string, auctionId: string): Promise<{ clientSecret: string; amountEur: number } | { error: string; full?: boolean }> {
  const offer = await seatOffer(admin, sellerId, auctionId);
  if (offer.state === "full") return { error: `${SEATS_FULL}.`, full: true };
  if (offer.state === "featured") return { error: "This car is already featured." };
  if (offer.state !== "available") return { error: offer.reason ?? "This car can't be featured." };
  const amountCents = Math.round(offer.priceEur * 100);

  // A pending attempt for the same amount is resumed.
  const { data: pending } = await admin
    .from("premium_seat_purchases")
    .select("*")
    .eq("auction_id", auctionId)
    .eq("seller_id", sellerId)
    .eq("status", "pending")
    .eq("amount_cents", amountCents)
    .order("created_at", { ascending: false })
    .limit(1)
    .returns<SeatPurchase[]>();
  if (pending?.[0]?.payment_intent_id) {
    const pi = await stripe.paymentIntents.retrieve(pending[0].payment_intent_id);
    if (["requires_payment_method", "requires_confirmation", "requires_action"].includes(pi.status) && pi.client_secret) {
      return { clientSecret: pi.client_secret, amountEur: amountCents / 100 };
    }
  }

  const { data: purchase, error } = await admin
    .from("premium_seat_purchases")
    .insert({ auction_id: auctionId, seller_id: sellerId, amount_cents: amountCents })
    .select("*")
    .single<SeatPurchase>();
  if (error || !purchase) return { error: "The payment couldn't start. Try again." };
  const [{ data: profile }, { data: a }] = await Promise.all([
    admin.from("profiles").select("stripe_customer_id").eq("id", sellerId).maybeSingle<{ stripe_customer_id: string | null }>(),
    admin.from("auctions").select("title").eq("id", auctionId).maybeSingle<{ title: string }>(),
  ]);
  const pi = await stripe.paymentIntents.create(
    {
      amount: amountCents,
      currency: "eur",
      ...(profile?.stripe_customer_id ? { customer: profile.stripe_customer_id } : {}),
      payment_method_types: ["card"],
      description: `Premium seat: ${a?.title ?? "car"}`,
      statement_descriptor_suffix: "FEATURED",
      metadata: { kind: "premium_seat", auction_id: auctionId, user_id: sellerId, purchase_id: purchase.id },
    },
    { idempotencyKey: `premium-seat:${purchase.id}` },
  );
  await admin.from("premium_seat_purchases").update({ payment_intent_id: pi.id }).eq("id", purchase.id);
  if (!pi.client_secret) return { error: "The payment couldn't start. Try again." };
  return { clientSecret: pi.client_secret, amountEur: amountCents / 100 };
}

/**
 * The payment succeeded (the confirm route or Stripe's webhook; both re-read the
 * PaymentIntent from Stripe). Idempotent. If the auction can no longer use the seat (it
 * ended or was withdrawn meanwhile) or every place was taken meanwhile, it's refunded.
 */
export async function finishSeatPayment(admin: Admin, pi: Stripe.PaymentIntent): Promise<"paid" | "refunded" | null> {
  if (pi.status !== "succeeded") return null;
  const { data: purchase } = await admin.from("premium_seat_purchases").select("*").eq("payment_intent_id", pi.id).maybeSingle<SeatPurchase>();
  if (!purchase || pi.amount !== purchase.amount_cents) return null;
  if (purchase.status === "paid" || purchase.status === "refunded") return purchase.status;

  const { data: a } = await admin.from("auctions").select(AUCTION_COLUMNS).eq("id", purchase.auction_id).maybeSingle<SeatAuction>();
  const { limit } = await seatSettings(admin);
  const usable = a && (a.status === "upcoming" || a.status === "live") && a.ends_at && Date.parse(a.ends_at) > Date.now();
  const room = (await activePaidSeats(admin)) < limit;

  const { data: claimed } = await admin
    .from("premium_seat_purchases")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", purchase.id)
    .in("status", ["pending", "failed"])
    .select("id");
  if (!claimed?.length) return null; // another caller finished it
  await ensureSeatInvoice(admin, purchase.id);
  await ensureSeatReceipt(admin, purchase.id);

  if (!usable || !room) {
    await refundSeat(admin, purchase.id, { reason: !usable ? "The auction couldn't be featured any more." : `${SEATS_FULL}.`, by: null, removeSeat: false });
    return "refunded";
  }
  await admin.from("auctions").update({ premium_seat_until: a!.ends_at, premium_seat_source: "paid" }).eq("id", a!.id);
  await admin.from("premium_seat_waitlist").delete().eq("auction_id", a!.id);
  await admin.from("notifications").insert({
    user_id: purchase.seller_id,
    type: "premium_seat_paid",
    auction_id: purchase.auction_id,
    data: { amount_cents: purchase.amount_cents, until: a!.ends_at },
  });
  return "paid";
}

/** Refunds a paid seat in full (credit note and refund receipt) and, unless told not to, removes the seat. */
export async function refundSeat(
  admin: Admin,
  purchaseId: string,
  { reason, by, removeSeat = true }: { reason: string; by: string | null; removeSeat?: boolean },
): Promise<{ ok: true } | { error: string }> {
  const { data: purchase } = await admin.from("premium_seat_purchases").select("*").eq("id", purchaseId).maybeSingle<SeatPurchase>();
  if (!purchase) return { error: "This purchase no longer exists." };
  if (purchase.status === "refunded") return { ok: true };
  if (purchase.status !== "paid" || !purchase.payment_intent_id) return { error: "Only a paid seat can be refunded." };
  let refund: Stripe.Refund;
  try {
    refund = await stripe.refunds.create({ payment_intent: purchase.payment_intent_id, amount: purchase.amount_cents }, { idempotencyKey: `premium-seat-refund:${purchase.id}` });
  } catch (e) {
    console.error("premium seat: refund failed", purchase.id, e);
    return { error: "Stripe couldn't refund it. Try again, or refund it in Stripe's dashboard." };
  }
  const at = new Date().toISOString();
  await admin
    .from("premium_seat_purchases")
    .update({ status: "refunded", refunded_at: at, refund_id: refund.id, refund_reason: reason, refunded_by: by })
    .eq("id", purchase.id)
    .eq("status", "paid");
  if (removeSeat) {
    await admin.from("auctions").update({ premium_seat_until: null, premium_seat_source: null }).eq("id", purchase.auction_id).eq("premium_seat_source", "paid");
  }
  await ensureSeatCreditNote(admin, purchase.id);
  await ensureSeatRefundReceipt(admin, purchase.id, { id: refund.id, at });
  await admin.from("notifications").insert({
    user_id: purchase.seller_id,
    type: "premium_seat_refunded",
    auction_id: purchase.auction_id,
    data: { amount_cents: purchase.amount_cents, reason },
  });
  await notifyFreedSeats(admin);
  return { ok: true };
}

/** The auction's paid seat (if any). */
export async function paidSeatOf(admin: Admin, auctionId: string): Promise<SeatPurchase | null> {
  const { data } = await admin.from("premium_seat_purchases").select("*").eq("auction_id", auctionId).eq("status", "paid").maybeSingle<SeatPurchase>();
  return data ?? null;
}

/** Withdrawn before it went live: refund the paid seat automatically. */
export async function refundSeatOnWithdrawal(admin: Admin, auctionId: string, statusBefore: string): Promise<void> {
  if (statusBefore === "live") return;
  const seat = await paidSeatOf(admin, auctionId);
  if (seat) await refundSeat(admin, seat.id, { reason: "The auction was withdrawn before it went live.", by: null });
}

/** "Notify me": tells the seller when a featured place frees up. */
export async function joinSeatWaitlist(admin: Admin, sellerId: string, auctionId: string): Promise<void> {
  await admin.from("premium_seat_waitlist").upsert({ auction_id: auctionId, seller_id: sellerId, created_at: new Date().toISOString(), notified_at: null }, { onConflict: "auction_id" });
}

/** A place is free: notify everyone waiting (once), whose auction can still be featured. */
export async function notifyFreedSeats(admin: Admin): Promise<number> {
  const { limit } = await seatSettings(admin);
  if ((await activePaidSeats(admin)) >= limit) return 0;
  const { data: waiting } = await admin
    .from("premium_seat_waitlist")
    .select("auction_id, seller_id, auction:auctions!inner(status, ends_at)")
    .is("notified_at", null)
    .in("auction.status", ["upcoming", "live"])
    .returns<{ auction_id: string; seller_id: string }[]>();
  if (!waiting?.length) return 0;
  await admin.from("notifications").insert(waiting.map((w) => ({ user_id: w.seller_id, type: "premium_seat_available", auction_id: w.auction_id, data: {} })));
  await admin.from("premium_seat_waitlist").update({ notified_at: new Date().toISOString() }).in("auction_id", waiting.map((w) => w.auction_id));
  return waiting.length;
}

// -----------------------------------------------------------------------------
// Documents: the same invoice and receipt series as the buyer's premium; the purchase's
// id stands where the buyer's payment id is. VAT: the car's country, included.
// -----------------------------------------------------------------------------
async function seatContext(admin: Admin, purchase: SeatPurchase) {
  const [{ data: a }, seller] = await Promise.all([
    admin.from("auctions").select(AUCTION_COLUMNS).eq("id", purchase.auction_id).maybeSingle<SeatAuction>(),
    partyContact(admin, purchase.seller_id),
  ]);
  return { a, seller, vat: vatRateFor(a?.location_country) };
}

const asPayment = (p: SeatPurchase) => ({ id: p.id, auction_id: p.auction_id, winner_id: p.seller_id });

export async function ensureSeatInvoice(admin: Admin, purchaseId: string): Promise<InvoiceRow | null> {
  const { data: found } = await admin.from("invoices").select("*").eq("buyer_payment_id", purchaseId).eq("kind", "invoice").maybeSingle<InvoiceRow>();
  if (found) return found;
  const { data: purchase } = await admin.from("premium_seat_purchases").select("*").eq("id", purchaseId).maybeSingle<SeatPurchase>();
  if (!purchase || (purchase.status !== "paid" && purchase.status !== "refunded")) return null;
  const { a, seller, vat } = await seatContext(admin, purchase);
  return issueInvoiceRow(admin, {
    kind: "invoice",
    payment: asPayment(purchase),
    creditedId: null,
    totalCents: purchase.amount_cents,
    vat,
    details: {
      issuer: { ...COMPANY, addressLines: [...COMPANY.addressLines] },
      buyer: { name: seller.fullName ?? "Biddr member", email: seller.email },
      line: { description: `Premium seat: ${a?.title ?? "car"}`, winningBid: null, basis: SEAT_DESCRIPTION, carCountry: vat.country },
      payments: [{ label: "Paid by card", amountCents: purchase.amount_cents, reference: purchase.payment_intent_id }],
      paidAt: purchase.paid_at,
      product: "premium_seat",
    },
  });
}

async function ensureSeatCreditNote(admin: Admin, purchaseId: string): Promise<InvoiceRow | null> {
  const { data: found } = await admin.from("invoices").select("*").eq("buyer_payment_id", purchaseId).eq("kind", "credit_note").maybeSingle<InvoiceRow>();
  if (found) return found;
  const invoice = await ensureSeatInvoice(admin, purchaseId);
  const { data: purchase } = await admin.from("premium_seat_purchases").select("*").eq("id", purchaseId).maybeSingle<SeatPurchase>();
  if (!invoice || !purchase || purchase.status !== "refunded") return null;
  return issueInvoiceRow(admin, {
    kind: "credit_note",
    payment: asPayment(purchase),
    creditedId: invoice.id,
    totalCents: -invoice.total_cents,
    vat: { country: invoice.vat_country, rate: Number(invoice.vat_rate) },
    details: {
      ...invoice.details,
      payments: [{ label: "Refunded to the card", amountCents: -invoice.total_cents, reference: purchase.refund_id }],
      paidAt: null,
      credits: { number: invoice.number, issuedAt: invoice.issued_at },
    },
  });
}

export async function ensureSeatReceipt(admin: Admin, purchaseId: string): Promise<ReceiptRow | null> {
  const { data: found } = await admin.from("receipts").select("*").eq("buyer_payment_id", purchaseId).eq("type", "payment").maybeSingle<ReceiptRow>();
  if (found) return storeAndNotify(admin, found);
  const { data: purchase } = await admin.from("premium_seat_purchases").select("*").eq("id", purchaseId).maybeSingle<SeatPurchase>();
  if (!purchase || (purchase.status !== "paid" && purchase.status !== "refunded") || !purchase.paid_at) return null;
  const invoice = await ensureSeatInvoice(admin, purchaseId);
  if (!invoice) return null;
  const { a, seller } = await seatContext(admin, purchase);
  const card = await cardOf(purchase.payment_intent_id);
  const charges: ReceiptCharge[] = [
    { kind: "card_charge", label: "Charged to card", amountCents: purchase.amount_cents, paymentIntent: purchase.payment_intent_id, ...card, at: card.at ?? purchase.paid_at },
  ];
  const details: ReceiptDetails = {
    payee: { ...COMPANY, addressLines: [...COMPANY.addressLines] },
    payer: { name: seller.fullName ?? "Biddr member", email: seller.email },
    reference: { invoiceNumber: invoice.number, auctionTitle: a?.title ?? "car", vin: a?.vin ?? null, auctionEndedAt: null },
    line: { description: `Premium seat: ${a?.title ?? "car"}`, winningBid: null, basis: SEAT_DESCRIPTION, premium: purchase.amount_cents / 100 },
    product: "premium_seat",
  };
  const { netCents, vatCents } = splitVat(purchase.amount_cents, Number(invoice.vat_rate));
  const { data, error } = await admin
    .rpc("issue_receipt", {
      p_type: "payment",
      p_buyer_payment_id: purchase.id,
      p_auction_id: purchase.auction_id,
      p_buyer_id: purchase.seller_id,
      p_invoice_id: invoice.id,
      p_refunds_receipt_id: null,
      p_stripe_refund_ids: [],
      p_amount: purchase.amount_cents,
      p_net_cents: netCents,
      p_vat_cents: vatCents,
      p_vat_rate: invoice.vat_rate,
      p_vat_country: invoice.vat_country,
      p_charges: charges,
      p_details: details,
      p_issued_at: purchase.paid_at,
    })
    .single<ReceiptRow>();
  if (error || !data) throw new Error(`issue_receipt failed: ${error?.message ?? "no row"}`);
  return storeAndNotify(admin, data);
}

async function ensureSeatRefundReceipt(admin: Admin, purchaseId: string, refund: { id: string; at: string }): Promise<ReceiptRow | null> {
  const original = await ensureSeatReceipt(admin, purchaseId);
  const { data: purchase } = await admin.from("premium_seat_purchases").select("*").eq("id", purchaseId).maybeSingle<SeatPurchase>();
  if (!original || !purchase) return null;
  const card = original.charges[0];
  const { netCents, vatCents } = splitVat(purchase.amount_cents, Number(original.vat_rate));
  const { data, error } = await admin
    .rpc("issue_receipt", {
      p_type: "refund",
      p_buyer_payment_id: purchase.id,
      p_auction_id: purchase.auction_id,
      p_buyer_id: purchase.seller_id,
      p_invoice_id: original.invoice_id,
      p_refunds_receipt_id: original.id,
      p_stripe_refund_ids: [refund.id],
      p_amount: purchase.amount_cents,
      p_net_cents: netCents,
      p_vat_cents: vatCents,
      p_vat_rate: original.vat_rate,
      p_vat_country: original.vat_country,
      p_charges: [
        {
          kind: "refund",
          label: "Refunded to card",
          amountCents: purchase.amount_cents,
          paymentIntent: purchase.payment_intent_id,
          charge: card?.charge ?? null,
          refund: refund.id,
          brand: card?.brand ?? null,
          last4: card?.last4 ?? null,
          at: refund.at,
        },
      ],
      p_details: { ...original.details, refunds: { receiptNumber: original.number, invoiceNumber: original.details.reference.invoiceNumber } },
      p_issued_at: refund.at,
    })
    .maybeSingle<ReceiptRow>();
  if (error) throw new Error(`issue_receipt failed: ${error.message}`);
  return data ? storeAndNotify(admin, data) : null;
}
