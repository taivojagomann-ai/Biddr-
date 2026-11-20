"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logAdminAction, requireAdmin } from "@/lib/admin";
import type { AdminResult } from "@/lib/admin-schemas";

const NOT_ALLOWED: AdminResult = { ok: false, error: "You don't have access to do this. Sign in as an admin." };
const reason = z.string().trim().min(10, "Give a reason (at least 10 characters).").max(500, "Keep the reason under 500 characters.");

type Db = NonNullable<Awaited<ReturnType<typeof requireAdmin>>>["db"];
type Conv = { id: string; auction_id: string; buyer_id: string; seller_id: string; status: string };

async function loadConversation(db: Db, id: string) {
  const { data } = await db.from("conversations").select("id, auction_id, buyer_id, seller_id, status").eq("id", id).maybeSingle<Conv>();
  return data;
}

function fail(parsed: z.SafeParseError<unknown>): AdminResult {
  const issue = parsed.error.issues[0];
  return { ok: false, error: issue?.message ?? "Check the form.", fieldErrors: issue ? { [String(issue.path[0])]: issue.message } : {} };
}

const closeSchema = z.object({ conversationId: z.string().uuid(), reason });

/**
 * Close conversation: no new messages, viewings or phone numbers from either party.
 * Biddr support posts a short note in it; the open reports on it are marked handled.
 */
export async function closeConversation(input: unknown): Promise<AdminResult> {
  const ctx = await requireAdmin();
  if (!ctx) return NOT_ALLOWED;
  const parsed = closeSchema.safeParse(input);
  if (!parsed.success) return fail(parsed);
  const conv = await loadConversation(ctx.db, parsed.data.conversationId);
  if (!conv) return { ok: false, error: "This conversation no longer exists." };
  if (conv.status === "closed") return { ok: false, error: "This conversation is already closed. Reload the page." };
  const now = new Date().toISOString();
  await ctx.db.from("conversations").update({ status: "closed", closed_at: now }).eq("id", conv.id);
  const { data: msg } = await ctx.db
    .from("messages")
    .insert({ conversation_id: conv.id, sender_id: ctx.adminId, sender_role: "support", body: "Biddr closed this conversation." })
    .select("created_at")
    .single<{ created_at: string }>();
  if (msg) await ctx.db.from("conversations").update({ last_message_at: msg.created_at }).eq("id", conv.id);
  await ctx.db.from("conversation_reports").update({ resolved_at: now, resolved_by: ctx.adminId }).eq("conversation_id", conv.id).is("resolved_at", null);
  await logAdminAction(ctx, conv.auction_id, "conversation.close", { conversation_id: conv.id, reason: parsed.data.reason });
  revalidatePath("/admin/messages");
  return { ok: true, message: "Closed. Neither party can write in it any more." };
}

const blockSchema = z.object({ conversationId: z.string().uuid(), userId: z.string().uuid(), reason });

/** Block user from messaging: they can't contact sellers or send messages anywhere until an admin lifts it (Admin → Users). */
export async function blockMessaging(input: unknown): Promise<AdminResult> {
  const ctx = await requireAdmin();
  if (!ctx) return NOT_ALLOWED;
  const parsed = blockSchema.safeParse(input);
  if (!parsed.success) return fail(parsed);
  const conv = await loadConversation(ctx.db, parsed.data.conversationId);
  if (!conv || (conv.buyer_id !== parsed.data.userId && conv.seller_id !== parsed.data.userId)) {
    return { ok: false, error: "This member isn't part of the conversation." };
  }
  const { data } = await ctx.db
    .from("profiles")
    .update({ messaging_blocked_at: new Date().toISOString(), messaging_block_reason: parsed.data.reason })
    .eq("id", parsed.data.userId)
    .is("messaging_blocked_at", null)
    .select("id");
  if (!data?.length) return { ok: false, error: "This member is already blocked from messaging." };
  await ctx.db.from("notifications").insert({
    user_id: parsed.data.userId,
    type: "account_blocked",
    auction_id: conv.auction_id,
    data: { kind: "messaging", reason: parsed.data.reason },
  });
  await logAdminAction(ctx, conv.auction_id, "user.block_messaging", {
    user_id: parsed.data.userId,
    conversation_id: conv.id,
    reason: parsed.data.reason,
  });
  revalidatePath("/admin/messages");
  revalidatePath("/admin/users");
  return { ok: true, message: "Blocked from messaging. They've been told; lift it on Admin → Users." };
}

const resolveSchema = z.object({ conversationId: z.string().uuid() });

/** Nothing to do: the open reports on this conversation are marked handled (it leaves the list). */
export async function resolveConversationReports(input: unknown): Promise<AdminResult> {
  const ctx = await requireAdmin();
  if (!ctx) return NOT_ALLOWED;
  const parsed = resolveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This conversation no longer exists." };
  const conv = await loadConversation(ctx.db, parsed.data.conversationId);
  if (!conv) return { ok: false, error: "This conversation no longer exists." };
  const { data } = await ctx.db
    .from("conversation_reports")
    .update({ resolved_at: new Date().toISOString(), resolved_by: ctx.adminId })
    .eq("conversation_id", conv.id)
    .is("resolved_at", null)
    .select("id");
  if (!data?.length) return { ok: false, error: "There are no open reports on it. Reload the page." };
  await logAdminAction(ctx, conv.auction_id, "conversation.reports_resolved", { conversation_id: conv.id, reports: data.length });
  revalidatePath("/admin/messages");
  return { ok: true, message: "Marked as handled." };
}
