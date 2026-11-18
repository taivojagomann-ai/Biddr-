"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logAdminAction, requireAdmin } from "@/lib/admin";
import type { AdminResult } from "@/lib/admin-schemas";
import { MESSAGE_MAX } from "@/lib/messages";
import type { ReportRow } from "@/lib/reports";

const NOT_ALLOWED: AdminResult = { ok: false, error: "You don't have access to do this. Sign in as an admin." };
const reportId = z.object({ reportId: z.string().uuid() });

function refresh(id: string) {
  revalidatePath("/admin/reports");
  revalidatePath(`/admin/reports/${id}`);
}

async function load(db: NonNullable<Awaited<ReturnType<typeof requireAdmin>>>["db"], id: string) {
  const { data } = await db.from("sale_reports").select("*").eq("id", id).maybeSingle<ReportRow>();
  return data;
}

async function supportMessage(db: NonNullable<Awaited<ReturnType<typeof requireAdmin>>>["db"], adminId: string, report: ReportRow, body: string) {
  if (!report.conversation_id) return false;
  const { data: conv } = await db.from("conversations").select("id, auction_id, buyer_id, seller_id").eq("id", report.conversation_id).maybeSingle<{ id: string; auction_id: string; buyer_id: string; seller_id: string }>();
  if (!conv) return false;
  const { data: msg, error } = await db
    .from("messages")
    .insert({ conversation_id: conv.id, sender_id: adminId, sender_role: "support", body })
    .select("created_at")
    .single<{ created_at: string }>();
  if (error || !msg) return false;
  await db.from("conversations").update({ last_message_at: msg.created_at }).eq("id", conv.id);
  await db.from("notifications").insert(
    [conv.buyer_id, conv.seller_id].map((u) => ({ user_id: u, type: "new_message", auction_id: conv.auction_id, data: { conversation_id: conv.id, from: "support" } })),
  );
  return true;
}

export async function markInReview(input: unknown): Promise<AdminResult> {
  const ctx = await requireAdmin();
  if (!ctx) return NOT_ALLOWED;
  const parsed = reportId.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This report no longer exists." };
  const { data } = await ctx.db.from("sale_reports").update({ status: "in_review" }).eq("id", parsed.data.reportId).eq("status", "open").select("auction_id");
  if (!data?.length) return { ok: false, error: "This report isn't open any more. Reload the page." };
  await logAdminAction(ctx, data[0]!.auction_id as string, "report.in_review", { report_id: parsed.data.reportId });
  refresh(parsed.data.reportId);
  return { ok: true, message: "Marked as in review." };
}

const messageSchema = reportId.extend({
  body: z.string().trim().min(1, "Write a message.").max(MESSAGE_MAX, "Keep the message under 2,000 characters."),
});

/** A message from "Biddr support" in the conversation: both parties see it and are notified. */
export async function sendSupportMessage(input: unknown): Promise<AdminResult> {
  const ctx = await requireAdmin();
  if (!ctx) return NOT_ALLOWED;
  const parsed = messageSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the message.", fieldErrors: { body: parsed.error.issues[0]?.message ?? "" } };
  const report = await load(ctx.db, parsed.data.reportId);
  if (!report || report.status === "resolved") return { ok: false, error: "This report is resolved. Reload the page." };
  if (!(await supportMessage(ctx.db, ctx.adminId, report, parsed.data.body))) return { ok: false, error: "The message wasn't sent. Try again." };
  await logAdminAction(ctx, report.auction_id, "report.message", { report_id: report.id });
  refresh(report.id);
  return { ok: true, message: "Sent. Both the buyer and the seller see it." };
}

const resolveSchema = reportId.extend({
  outcome: z.enum(["resolved", "sale_failed"], { errorMap: () => ({ message: "Choose the outcome." }) }),
  resolution: z.string().trim().min(10, "Explain the decision (at least 10 characters).").max(2000, "Keep it under 2,000 characters."),
});

/** Closes the report with a decision the reporter sees; it's also posted to the conversation. */
export async function resolveReport(input: unknown): Promise<AdminResult> {
  const ctx = await requireAdmin();
  if (!ctx) return NOT_ALLOWED;
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? "Check the form.", fieldErrors: issue ? { [String(issue.path[0])]: issue.message } : {} };
  }
  const report = await load(ctx.db, parsed.data.reportId);
  if (!report || report.status === "resolved") return { ok: false, error: "This report is already resolved. Reload the page." };
  const { error } = await ctx.db
    .from("sale_reports")
    .update({
      status: "resolved",
      outcome: parsed.data.outcome,
      resolution: parsed.data.resolution,
      resolved_by: ctx.adminId,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", report.id)
    .neq("status", "resolved");
  if (error) return { ok: false, error: "That didn't save. Try again." };
  if (parsed.data.outcome === "sale_failed") {
    await ctx.db.from("buyer_payments").update({ sale_failed_at: new Date().toISOString() }).eq("id", report.buyer_payment_id).is("sale_failed_at", null);
  }
  await supportMessage(ctx.db, ctx.adminId, report, `Biddr's decision on the reported problem: ${parsed.data.resolution}`);
  await ctx.db.from("notifications").insert({
    user_id: report.reporter_id,
    type: "report_resolved",
    auction_id: report.auction_id,
    data: { report_id: report.id, conversation_id: report.conversation_id },
  });
  await logAdminAction(ctx, report.auction_id, "report.resolve", { report_id: report.id, outcome: parsed.data.outcome });
  refresh(report.id);
  return { ok: true, message: "Resolved. The reporter has been told, and the decision is in the conversation." };
}

const blockSchema = reportId.extend({
  kind: z.enum(["bidding", "selling"]),
  reason: z.string().trim().min(10, "Give a reason (at least 10 characters).").max(500, "Keep the reason under 500 characters."),
});

/** Blocks the buyer from bidding or the seller from selling, from a report. */
export async function blockParty(input: unknown): Promise<AdminResult> {
  const ctx = await requireAdmin();
  if (!ctx) return NOT_ALLOWED;
  const parsed = blockSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? "Check the form.", fieldErrors: issue ? { [String(issue.path[0])]: issue.message } : {} };
  }
  const report = await load(ctx.db, parsed.data.reportId);
  if (!report) return { ok: false, error: "This report no longer exists." };
  const { data: payment } = await ctx.db.from("buyer_payments").select("winner_id, seller_id").eq("id", report.buyer_payment_id).maybeSingle<{ winner_id: string; seller_id: string }>();
  if (!payment) return { ok: false, error: "This sale no longer exists." };
  const userId = parsed.data.kind === "bidding" ? payment.winner_id : payment.seller_id;
  const values =
    parsed.data.kind === "bidding"
      ? { bidding_blocked_at: new Date().toISOString(), bidding_block_reason: parsed.data.reason }
      : { selling_blocked_at: new Date().toISOString(), selling_block_reason: parsed.data.reason };
  const { error } = await ctx.db.from("profiles").update(values).eq("id", userId);
  if (error) return { ok: false, error: "That didn't save. Try again." };
  await ctx.db.from("notifications").insert({ user_id: userId, type: "account_blocked", data: { kind: parsed.data.kind, reason: parsed.data.reason } });
  await logAdminAction(ctx, report.auction_id, parsed.data.kind === "bidding" ? "user.block_bidding" : "user.block_selling", {
    report_id: report.id,
    user_id: userId,
    reason: parsed.data.reason,
  });
  refresh(report.id);
  revalidatePath("/admin/users");
  return { ok: true, message: parsed.data.kind === "bidding" ? "The buyer is blocked from bidding." : "The seller is blocked from selling." };
}
