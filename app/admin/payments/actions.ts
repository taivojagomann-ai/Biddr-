"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logAdminAction, requireAdmin } from "@/lib/admin";
import type { AdminResult } from "@/lib/admin-schemas";
import { ensureCreditNote } from "@/lib/invoice/issue";
import { settleBuyerPayment, type BuyerPaymentRow } from "@/lib/settlement";
import { stripe } from "@/lib/stripe";

const NOT_ALLOWED: AdminResult = { ok: false, error: "You don't have access to do this. Sign in as an admin." };
const idSchema = z.object({ paymentId: z.string().uuid() });

function refresh(auctionId: string) {
  revalidatePath("/admin/payments");
  revalidatePath(`/admin/auctions/${auctionId}`);
  revalidatePath("/account/purchases");
  revalidatePath("/account/listings");
}

async function load(db: Awaited<ReturnType<typeof requireAdmin>> & object, id: string) {
  const { data } = await db.db.from("buyer_payments").select("*").eq("id", id).maybeSingle<BuyerPaymentRow>();
  return data;
}

/** Charges again now (failed, needs-authentication or stuck pending payments). */
export async function retryCharge(input: unknown): Promise<AdminResult> {
  const ctx = await requireAdmin();
  if (!ctx) return NOT_ALLOWED;
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This payment no longer exists. Reload the page." };
  const row = await load(ctx, parsed.data.paymentId);
  if (!row) return { ok: false, error: "This payment no longer exists. Reload the page." };
  if (!["failed", "action_required", "pending"].includes(row.status)) {
    return { ok: false, error: "Only pending, failed or needs-authentication payments can be retried." };
  }
  const { error } = await ctx.db
    .from("buyer_payments")
    .update({ status: "pending", last_attempt_at: null, failure_reason: null, due_at: null })
    .eq("id", row.id);
  if (error) return { ok: false, error: "That didn't save. Try again." };
  const status = await settleBuyerPayment(ctx.db, row.id, ["pending"]);
  await logAdminAction(ctx, row.auction_id, "payment.retry", { payment_id: row.id, from: row.status, result: status });
  refresh(row.auction_id);
  const words: Record<string, string> = {
    paid: "Charged. The premium is paid.",
    action_required: "The bank needs the winner to confirm the payment. They've been asked to.",
    failed: "The charge failed again. The winner has been told.",
    pending: "Stripe didn't answer. It will be retried automatically.",
  };
  return { ok: true, message: words[status ?? "pending"] ?? "Retried." };
}

const cancelSchema = idSchema.extend({
  reason: z.string().trim().min(10, "Give a reason (at least 10 characters).").max(500, "Keep the reason under 500 characters."),
});

/** Stops collecting the premium (e.g. the sale fell through). Releases what's still held. */
export async function cancelPayment(input: unknown): Promise<AdminResult> {
  const ctx = await requireAdmin();
  if (!ctx) return NOT_ALLOWED;
  const parsed = cancelSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? "Check the form.", fieldErrors: issue ? { [String(issue.path[0])]: issue.message } : {} };
  }
  const row = await load(ctx, parsed.data.paymentId);
  if (!row) return { ok: false, error: "This payment no longer exists. Reload the page." };
  if (row.status === "paid") return { ok: false, error: "This premium is already paid. Refund it instead." };
  if (row.status === "cancelled" || row.status === "refunded" || row.status === "unpaid") return { ok: false, error: "This payment is already closed." };

  // Best effort: nothing left half-open in Stripe.
  if (row.remainder_payment_intent_id) {
    await stripe.paymentIntents.cancel(row.remainder_payment_intent_id).catch(() => undefined);
  }
  if (row.hold_payment_intent_id && row.captured_from_hold === null) {
    await stripe.paymentIntents.cancel(row.hold_payment_intent_id).catch(() => undefined);
    await ctx.db.from("bid_holds").update({ status: "released" }).eq("stripe_payment_intent_id", row.hold_payment_intent_id).eq("status", "authorized");
  }
  const { error } = await ctx.db
    .from("buyer_payments")
    .update({ status: "cancelled", failure_reason: `Cancelled by Biddr: ${parsed.data.reason}`, due_at: null })
    .eq("id", row.id);
  if (error) return { ok: false, error: "That didn't save. Try again." };
  await logAdminAction(ctx, row.auction_id, "payment.cancel", { payment_id: row.id, from: row.status, reason: parsed.data.reason });
  refresh(row.auction_id);
  return { ok: true, message: "Cancelled. Nothing more will be charged." };
}

/** Refunds a paid premium in full (the part taken from the hold and the rest). */
export async function refundPremium(input: unknown): Promise<AdminResult> {
  const ctx = await requireAdmin();
  if (!ctx) return NOT_ALLOWED;
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This payment no longer exists. Reload the page." };
  const row = await load(ctx, parsed.data.paymentId);
  if (!row) return { ok: false, error: "This payment no longer exists. Reload the page." };
  if (row.status !== "paid") return { ok: false, error: "Only a paid premium can be refunded." };

  const captured = row.captured_from_hold ?? 0;
  const refunds: string[] = [];
  try {
    if (captured > 0 && row.hold_payment_intent_id) {
      const r = await stripe.refunds.create(
        { payment_intent: row.hold_payment_intent_id, amount: captured * 100, reason: "requested_by_customer" },
        { idempotencyKey: `premium-refund:${row.id}:hold` },
      );
      refunds.push(r.id);
    }
    if (row.premium_amount - captured > 0 && row.remainder_payment_intent_id) {
      const r = await stripe.refunds.create(
        { payment_intent: row.remainder_payment_intent_id, reason: "requested_by_customer" },
        { idempotencyKey: `premium-refund:${row.id}:rest` },
      );
      refunds.push(r.id);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Stripe refused the refund.";
    await logAdminAction(ctx, row.auction_id, "payment.refund_failed", { payment_id: row.id, error: message });
    return { ok: false, error: `Stripe refused the refund: ${message}` };
  }
  const { error } = await ctx.db.from("buyer_payments").update({ status: "refunded" }).eq("id", row.id);
  if (error) return { ok: false, error: "The refund went through in Stripe, but the status didn't save. Reload the page." };
  // The credit note that cancels the invoice. If this fails, the settlement job issues it later.
  const creditNote = await ensureCreditNote(ctx.db, row.id).catch((e) => {
    console.error("invoice: credit note failed", row.id, e);
    return null;
  });
  await logAdminAction(ctx, row.auction_id, "payment.refund", {
    payment_id: row.id,
    amount: row.premium_amount,
    refunds,
    credit_note: creditNote?.number ?? null,
  });
  refresh(row.auction_id);
  return { ok: true, message: "Refunded. Stripe returns the money to the winner's card." };
}
