import "server-only";
import { ensureInvoice, issueMissingInvoices } from "@/lib/invoice/issue";
import Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HOLD_AMOUNT_EUR, stripe } from "@/lib/stripe";

/**
 * The winner pays the buyer's premium (DECISIONS.md point 5 and 11). For each
 * buyer_payments row:
 *  1. Capture min(premium, €500) from the winner's card hold, if it's still valid
 *     (a partial capture releases the rest of the hold).
 *  2. Charge whatever is left (premium above €500, or the full premium when the
 *     hold expired or was released) off-session to the card saved with the hold.
 *  3. Needs authentication → 'action_required' (72 hours to pay on the site);
 *     declined or no card → 'failed'; all done → 'paid'.
 * Idempotent: each attempt claims the row first, and Stripe calls carry
 * idempotency keys, so a retry never charges twice.
 */

export type BuyerPaymentStatus = "pending" | "paid" | "action_required" | "failed" | "refunded" | "cancelled" | "unpaid";

export interface BuyerPaymentRow {
  id: string;
  auction_id: string;
  winner_id: string;
  seller_id: string;
  winning_bid: number;
  premium_amount: number;
  hold_payment_intent_id: string | null;
  captured_from_hold: number | null;
  remainder_payment_intent_id: string | null;
  status: BuyerPaymentStatus;
  due_at: string | null;
  paid_at: string | null;
  failure_reason: string | null;
  receipt_url: string | null;
  attempts: number;
  last_attempt_at: string | null;
  created_at: string;
  /** 0025: the reminder 24 hours before due_at, when it went unpaid, and the seller's "Sale completed". */
  reminder_sent_at?: string | null;
  unpaid_at?: string | null;
  sale_completed_at?: string | null;
  /** Set when this sale is a second-chance offer to the next bidder. */
  second_chance_offer_id?: string | null;
}

import { PAYMENT_DUE_HOURS, REMINDER_HOURS, SECOND_CHANCE_HOURS } from "@/lib/settlement-constants";
export { PAYMENT_DUE_HOURS, REMINDER_HOURS, SECOND_CHANCE_HOURS, SELLER_PAYMENT_DAYS } from "@/lib/settlement-constants";
/** A claimed attempt older than this is considered abandoned and can be retried. */
const CLAIM_MS = 2 * 60 * 1000;

type Admin = SupabaseClient;

async function auctionTitle(admin: Admin, auctionId: string): Promise<string> {
  const { data } = await admin.from("auctions").select("title").eq("id", auctionId).maybeSingle<{ title: string }>();
  return data?.title ?? "your car";
}

async function notify(admin: Admin, rows: { user_id: string; type: string; auction_id: string; data?: Record<string, unknown> }[]) {
  if (!rows.length) return;
  const { error } = await admin.from("notifications").insert(rows.map((r) => ({ ...r, data: r.data ?? {} })));
  if (error) console.error("settlement: notification failed", error);
}

async function adminIds(admin: Admin): Promise<string[]> {
  const { data } = await admin.from("profiles").select("id").eq("role", "admin").returns<{ id: string }[]>();
  return (data ?? []).map((a) => a.id);
}

function receiptOf(pi: Stripe.PaymentIntent): string | null {
  const charge = pi.latest_charge;
  return charge && typeof charge === "object" ? (charge.receipt_url ?? null) : null;
}

/** Claims a row for one attempt (status must be one of `from`). Returns null if someone else has it. */
async function claim(admin: Admin, id: string, from: BuyerPaymentStatus[]): Promise<BuyerPaymentRow | null> {
  const { data: current } = await admin.from("buyer_payments").select("*").eq("id", id).maybeSingle<BuyerPaymentRow>();
  if (!current || !from.includes(current.status)) return null;
  const cutoff = new Date(Date.now() - CLAIM_MS).toISOString();
  const { data } = await admin
    .from("buyer_payments")
    .update({ attempts: current.attempts + 1, last_attempt_at: new Date().toISOString() })
    .eq("id", id)
    .eq("attempts", current.attempts) // nobody else started an attempt meanwhile
    .or(`last_attempt_at.is.null,last_attempt_at.lt.${cutoff}`)
    .select("*")
    .returns<BuyerPaymentRow[]>();
  return data?.[0] ?? null;
}

async function update(admin: Admin, id: string, values: Partial<BuyerPaymentRow>) {
  const { error } = await admin.from("buyer_payments").update(values).eq("id", id);
  if (error) throw new Error(`buyer_payments update failed: ${error.message}`);
}

/** Marks the payment paid and tells the winner and the seller. */
async function markPaid(admin: Admin, row: BuyerPaymentRow, receipt: string | null) {
  await update(admin, row.id, {
    status: "paid",
    paid_at: new Date().toISOString(),
    failure_reason: null,
    due_at: null,
    receipt_url: receipt ?? row.receipt_url,
  });
  await notify(admin, [
    { user_id: row.winner_id, type: "premium_paid", auction_id: row.auction_id, data: { role: "winner", amount: row.premium_amount } },
    { user_id: row.seller_id, type: "premium_paid", auction_id: row.auction_id, data: { role: "seller" } },
  ]);
  // A second-chance sale: the offer is done.
  if (row.second_chance_offer_id) {
    await admin.from("second_chance_offers").update({ status: "paid" }).eq("id", row.second_chance_offer_id);
  }
  // The invoice for the whole premium. If this fails, the settlement job issues it later.
  await ensureInvoice(admin, row.id).catch((e) => console.error("invoice: issuing failed", row.id, e));
}

async function needsWinner(admin: Admin, row: BuyerPaymentRow, kind: "action_required" | "failed", reason: string, remainderPi: string | null) {
  const due = new Date(Date.now() + PAYMENT_DUE_HOURS * 3600 * 1000).toISOString();
  await update(admin, row.id, {
    status: kind,
    failure_reason: reason,
    due_at: due,
    ...(remainderPi ? { remainder_payment_intent_id: remainderPi } : {}),
  });
  await notify(admin, [
    { user_id: row.winner_id, type: "premium_due", auction_id: row.auction_id, data: { reason: kind, due_at: due, amount: row.premium_amount } },
  ]);
  if (kind === "failed") {
    const admins = (await adminIds(admin)).filter((id) => id !== row.winner_id);
    await notify(admin, admins.map((id) => ({ user_id: id, type: "premium_failed", auction_id: row.auction_id, data: { reason } })));
  }
}

/** One settlement attempt for a claimed row. */
async function settle(admin: Admin, row: BuyerPaymentRow): Promise<BuyerPaymentStatus> {
  const premiumCents = row.premium_amount * 100;
  let captured = row.captured_from_hold;
  let paymentMethod: string | null = null;
  let receipt: string | null = row.receipt_url;

  // 1. The hold.
  if (captured === null) {
    captured = 0;
    if (row.hold_payment_intent_id) {
      const hold = await stripe.paymentIntents.retrieve(row.hold_payment_intent_id);
      paymentMethod = typeof hold.payment_method === "string" ? hold.payment_method : (hold.payment_method?.id ?? null);
      if (hold.status === "requires_capture") {
        const amount = Math.min(premiumCents, hold.amount_capturable || HOLD_AMOUNT_EUR * 100);
        const done = await stripe.paymentIntents.capture(
          hold.id,
          { amount_to_capture: amount, expand: ["latest_charge"] },
          { idempotencyKey: `premium-capture:${row.id}` },
        );
        captured = Math.round((done.amount_received ?? amount) / 100);
        receipt = receiptOf(done) ?? receipt;
        await admin.from("bid_holds").update({ status: "captured" }).eq("stripe_payment_intent_id", hold.id);
      } else if (hold.status === "succeeded") {
        captured = Math.round((hold.amount_received ?? 0) / 100); // captured on an earlier attempt
      } else {
        // Expired or released: nothing to capture; the full premium is charged below.
        await admin.from("bid_holds").update({ status: "released" }).eq("stripe_payment_intent_id", hold.id).in("status", ["pending", "authorized"]);
      }
    }
    captured = Math.min(captured, row.premium_amount);
    await update(admin, row.id, { captured_from_hold: captured, receipt_url: receipt });
  }

  // 2. The remainder, off-session.
  const remainder = row.premium_amount - captured;
  if (remainder <= 0) {
    await markPaid(admin, row, receipt);
    return "paid";
  }
  if (row.remainder_payment_intent_id) {
    const existing = await stripe.paymentIntents.retrieve(row.remainder_payment_intent_id, { expand: ["latest_charge"] });
    if (existing.status === "succeeded") {
      await markPaid(admin, row, receiptOf(existing));
      return "paid";
    }
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", row.winner_id)
    .maybeSingle<{ stripe_customer_id: string | null }>();
  const customer = profile?.stripe_customer_id ?? null;
  if (!paymentMethod && row.hold_payment_intent_id) {
    const hold = await stripe.paymentIntents.retrieve(row.hold_payment_intent_id);
    paymentMethod = typeof hold.payment_method === "string" ? hold.payment_method : (hold.payment_method?.id ?? null);
  }
  if (!paymentMethod && customer) {
    const list = await stripe.paymentMethods.list({ customer, type: "card", limit: 1 });
    paymentMethod = list.data[0]?.id ?? null;
  }
  if (!customer || !paymentMethod) {
    await needsWinner(admin, row, "failed", "No saved card to charge.", null);
    return "failed";
  }

  const title = await auctionTitle(admin, row.auction_id);
  try {
    const pi = await stripe.paymentIntents.create(
      {
        amount: remainder * 100,
        currency: "eur",
        customer,
        payment_method: paymentMethod,
        payment_method_types: ["card"],
        off_session: true,
        confirm: true,
        description: `Buyer's premium: ${title}`,
        statement_descriptor_suffix: "PREMIUM",
        metadata: { kind: "buyer_premium", auction_id: row.auction_id, user_id: row.winner_id, buyer_payment_id: row.id },
        expand: ["latest_charge"],
      },
      { idempotencyKey: `premium-remainder:${row.id}:${row.attempts}` },
    );
    await update(admin, row.id, { remainder_payment_intent_id: pi.id });
    if (pi.status === "succeeded") {
      await markPaid(admin, row, receiptOf(pi) ?? receipt);
      return "paid";
    }
    await needsWinner(admin, row, "action_required", "Your bank needs you to confirm this payment.", pi.id);
    return "action_required";
  } catch (e) {
    if (e instanceof Stripe.errors.StripeCardError) {
      const pi = (e.raw as { payment_intent?: { id?: string } } | undefined)?.payment_intent?.id ?? null;
      if (e.code === "authentication_required") {
        await needsWinner(admin, row, "action_required", "Your bank needs you to confirm this payment.", pi);
        return "action_required";
      }
      await needsWinner(admin, row, "failed", e.message || "The card was declined.", pi);
      return "failed";
    }
    throw e;
  }
}

/** Runs one attempt for a row in one of the given states. Returns the new status, or null if not attempted. */
export async function settleBuyerPayment(admin: Admin, id: string, from: BuyerPaymentStatus[] = ["pending"]): Promise<BuyerPaymentStatus | null> {
  const row = await claim(admin, id, from);
  if (!row) return null;
  try {
    return await settle(admin, row);
  } catch (e) {
    // Network or Stripe outage: stay 'pending' so the scheduler retries.
    const message = e instanceof Error ? e.message : String(e);
    console.error("settlement: attempt failed", id, message);
    await admin.from("buyer_payments").update({ failure_reason: `Retrying: ${message}`.slice(0, 500) }).eq("id", id);
    return "pending";
  }
}

/** Settles every pending payment (oldest first). */
export async function settlePending(
  admin: Admin,
  limit = 25,
): Promise<{
  attempted: number;
  results: Record<string, number>;
  deadlines: { reminded: number; expired: number; offersExpired: number };
  invoices: number;
}> {
  const { data } = await admin
    .from("buyer_payments")
    .select("id")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit)
    .returns<{ id: string }[]>();
  const results: Record<string, number> = {};
  for (const r of data ?? []) {
    const status = (await settleBuyerPayment(admin, r.id)) ?? "skipped";
    results[status] = (results[status] ?? 0) + 1;
  }
  // Reminders, payments past their deadline, and expired second-chance offers.
  const deadlines = await processDeadlines(admin);
  // Invoices that couldn't be issued when the premium was paid (or refunded).
  const invoices = await issueMissingInvoices(admin);
  return { attempted: data?.length ?? 0, results, deadlines, invoices };
}

/**
 * Deadlines (DECISIONS.md point 12), run with every settlement pass (every 5 minutes):
 * - 24 hours before a payment that needs the winner is due: one reminder.
 * - Past due: the winner's sale is cancelled as "Buyer didn't pay" (status 'unpaid'),
 *   what was taken from the hold is kept (and invoiced), the winner is blocked from
 *   bidding, and the seller and admins are told. A second-chance buyer who doesn't pay
 *   isn't blocked: their payment is just cancelled and the seller is told.
 * - Second-chance offers not answered within 48 hours expire.
 */
export async function processDeadlines(admin: Admin): Promise<{ reminded: number; expired: number; offersExpired: number }> {
  const now = new Date();
  const nowIso = now.toISOString();
  let reminded = 0;
  let expired = 0;
  let offersExpired = 0;

  const soon = new Date(now.getTime() + REMINDER_HOURS * 3600 * 1000).toISOString();
  const { data: dueSoon } = await admin
    .from("buyer_payments")
    .select("*")
    .in("status", ["action_required", "failed"])
    .is("reminder_sent_at", null)
    .gt("due_at", nowIso)
    .lte("due_at", soon)
    .limit(100)
    .returns<BuyerPaymentRow[]>();
  for (const row of dueSoon ?? []) {
    const { data: claimed } = await admin
      .from("buyer_payments")
      .update({ reminder_sent_at: nowIso })
      .eq("id", row.id)
      .is("reminder_sent_at", null)
      .select("id");
    if (!claimed?.length) continue;
    await notify(admin, [{ user_id: row.winner_id, type: "premium_reminder", auction_id: row.auction_id, data: { due_at: row.due_at } }]);
    reminded += 1;
  }

  const { data: overdue } = await admin
    .from("buyer_payments")
    .select("*")
    .in("status", ["action_required", "failed"])
    .lte("due_at", nowIso)
    .limit(50)
    .returns<BuyerPaymentRow[]>();
  for (const row of overdue ?? []) {
    try {
      if (await expirePayment(admin, row)) expired += 1;
    } catch (e) {
      console.error("settlement: expiring a payment failed", row.id, e);
    }
  }

  const { data: offers } = await admin
    .from("second_chance_offers")
    .update({ status: "expired" })
    .eq("status", "pending")
    .lte("expires_at", nowIso)
    .select("auction_id, seller_id")
    .returns<{ auction_id: string; seller_id: string }[]>();
  for (const o of offers ?? []) {
    await notify(admin, [{ user_id: o.seller_id, type: "second_chance_closed", auction_id: o.auction_id, data: { outcome: "expired" } }]);
    offersExpired += 1;
  }
  return { reminded, expired, offersExpired };
}

/** Closes one payment past its deadline. Returns the new status, or null if someone else already did. */
async function expirePayment(admin: Admin, row: BuyerPaymentRow): Promise<BuyerPaymentStatus | null> {
  // Paid at the last minute? Then it's paid. Otherwise make sure it can't be paid any more.
  if (row.remainder_payment_intent_id) {
    const pi = await stripe.paymentIntents.retrieve(row.remainder_payment_intent_id, { expand: ["latest_charge"] }).catch(() => null);
    if (pi?.status === "succeeded") {
      await markPaid(admin, row, receiptOf(pi));
      return "paid";
    }
    if (pi && pi.status !== "canceled") await stripe.paymentIntents.cancel(pi.id).catch(() => undefined);
  }

  const secondChance = row.second_chance_offer_id ?? null;
  const nowIso = new Date().toISOString();
  const { data: done } = await admin
    .from("buyer_payments")
    .update({
      status: secondChance ? "cancelled" : "unpaid",
      unpaid_at: nowIso,
      due_at: null,
      failure_reason: secondChance
        ? `Not paid within ${SECOND_CHANCE_HOURS} hours of the second-chance offer.`
        : `Not paid within ${PAYMENT_DUE_HOURS} hours.`,
    })
    .eq("id", row.id)
    .in("status", ["action_required", "failed"])
    .select("id");
  if (!done?.length) return null;

  if (secondChance) {
    await admin.from("second_chance_offers").update({ status: "expired" }).eq("id", secondChance).in("status", ["pending", "accepted"]);
    await notify(admin, [{ user_id: row.seller_id, type: "second_chance_closed", auction_id: row.auction_id, data: { outcome: "expired" } }]);
    return "cancelled";
  }

  const title = await auctionTitle(admin, row.auction_id);
  await admin
    .from("profiles")
    .update({ bidding_blocked_at: nowIso, bidding_block_reason: `The buyer's premium for ${title} wasn't paid in time.` })
    .eq("id", row.winner_id)
    .is("bidding_blocked_at", null);
  const admins = (await adminIds(admin)).filter((id) => id !== row.winner_id);
  await notify(admin, [
    { user_id: row.winner_id, type: "premium_unpaid", auction_id: row.auction_id, data: { kept: row.captured_from_hold ?? 0 } },
    { user_id: row.seller_id, type: "buyer_did_not_pay", auction_id: row.auction_id, data: { role: "seller" } },
    ...admins.map((id) => ({ user_id: id, type: "buyer_did_not_pay", auction_id: row.auction_id, data: { role: "admin" } })),
  ]);
  // What was taken from the hold is kept: it gets an invoice.
  if ((row.captured_from_hold ?? 0) > 0) {
    await ensureInvoice(admin, row.id).catch((e) => console.error("invoice: issuing failed", row.id, e));
  }
  return "unpaid";
}

/**
 * The winner paid on the site (Complete payment) or Stripe reported a succeeded
 * premium payment: mark the row paid if this PaymentIntent belongs to it.
 */
export async function finishWithPaymentIntent(admin: Admin, pi: Stripe.PaymentIntent): Promise<boolean> {
  if (pi.metadata?.kind !== "buyer_premium" || pi.status !== "succeeded") return false;
  const { data: row } = await admin
    .from("buyer_payments")
    .select("*")
    .eq("id", pi.metadata.buyer_payment_id ?? "")
    .maybeSingle<BuyerPaymentRow>();
  if (!row || row.winner_id !== pi.metadata.user_id) return false;
  if (row.status === "paid") return true;
  if (!["pending", "action_required", "failed"].includes(row.status)) return false;
  const expected = (row.premium_amount - (row.captured_from_hold ?? 0)) * 100;
  if ((pi.amount_received ?? pi.amount) < expected) return false;
  await update(admin, row.id, { remainder_payment_intent_id: pi.id });
  await markPaid(admin, row, receiptOf(pi));
  return true;
}
