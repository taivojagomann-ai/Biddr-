"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { buyerPaymentOverdue, DESCRIPTION_MIN, REASONS, type ReportReason } from "@/lib/reports";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";

export type ReportResult = { ok: true; message: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

const input = z.object({
  conversationId: z.string().uuid(),
  reason: z.string(),
  description: z
    .string()
    .trim()
    .min(DESCRIPTION_MIN, `Describe the problem in at least ${DESCRIPTION_MIN} characters.`)
    .max(2000, "Keep the description under 2,000 characters."),
});

/** Report a problem with a sale: the buyer or the seller, after the premium is paid. Admins are told. */
export async function reportProblem(raw: unknown): Promise<ReportResult> {
  const { data: { user } } = await getServerSupabase().auth.getUser();
  if (!user) return { ok: false, error: "Your session has expired. Sign in again." };
  const parsed = input.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? "Check the form.", fieldErrors: issue ? { [String(issue.path[0])]: issue.message } : {} };
  }
  const admin = getAdminSupabase();
  const { data: conv } = await admin
    .from("conversations")
    .select("id, auction_id, buyer_payment_id, buyer_id, seller_id")
    .eq("id", parsed.data.conversationId)
    .maybeSingle<{ id: string; auction_id: string; buyer_payment_id: string; buyer_id: string; seller_id: string }>();
  if (!conv || (conv.buyer_id !== user.id && conv.seller_id !== user.id)) return { ok: false, error: "This sale isn't yours." };
  const role = conv.buyer_id === user.id ? "buyer" : "seller";
  const reason = parsed.data.reason as ReportReason;
  if (!REASONS[role].some((r) => r.value === reason)) {
    return { ok: false, error: "Choose what the problem is.", fieldErrors: { reason: "Choose what the problem is." } };
  }
  const { data: payment } = await admin.from("buyer_payments").select("status, paid_at").eq("id", conv.buyer_payment_id).maybeSingle<{ status: string; paid_at: string | null }>();
  if (!payment || payment.status !== "paid") return { ok: false, error: "Problems can be reported once the buyer's premium is paid." };
  if (reason === "buyer_not_paid" && !buyerPaymentOverdue(payment.paid_at)) {
    const msg = "The buyer has 7 days after the premium is paid to pay you for the car. You can report this after that.";
    return { ok: false, error: msg, fieldErrors: { reason: msg } };
  }

  const { data: report, error } = await admin
    .from("sale_reports")
    .insert({
      buyer_payment_id: conv.buyer_payment_id,
      auction_id: conv.auction_id,
      conversation_id: conv.id,
      reporter_id: user.id,
      reporter_role: role,
      reason,
      description: parsed.data.description,
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !report) {
    return { ok: false, error: error?.code === "23505" ? "You already have an open report for this sale." : "Your report wasn't sent. Try again." };
  }
  const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin").returns<{ id: string }[]>();
  const rows = (admins ?? [])
    .filter((a) => a.id !== user.id)
    .map((a) => ({ user_id: a.id, type: "report_opened", auction_id: conv.auction_id, actor_id: user.id, data: { report_id: report.id, role } }));
  if (rows.length) await admin.from("notifications").insert(rows);
  revalidatePath(`/account/messages/${conv.id}`);
  revalidatePath("/account/purchases");
  revalidatePath("/account/listings");
  return { ok: true, message: "Thanks. Biddr's team will look at it and reply here." };
}
