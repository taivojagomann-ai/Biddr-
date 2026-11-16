"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkReportPaths } from "@/lib/report-files";
import { REPORT_BUCKET, newReportSchema } from "@/lib/sell";
import { newHistoryReportSchema } from "@/lib/history-report";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";
import {
  DECISION_ERRORS,
  WITHDRAW_ERRORS,
  requestWithdrawalSchema,
  withdrawSchema,
  type WithdrawResult,
} from "@/lib/withdraw";

const FAILED = "That didn't work. Check your connection and try again.";

function fail(message: string | undefined): WithdrawResult {
  return { ok: false, error: (message && WITHDRAW_ERRORS[message]) ?? FAILED };
}

/** Waiting for review or Scheduled: the seller withdraws directly (seller_withdraw checks ownership and status). */
export async function withdrawListing(input: unknown): Promise<WithdrawResult> {
  const parsed = withdrawSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? FAILED };
  const { auctionId, reason } = parsed.data;
  // The user's own client: auth.uid() inside the function is the seller.
  const { error } = await getServerSupabase().rpc("seller_withdraw", { p_auction_id: auctionId, p_reason: reason || null });
  if (error) return fail(error.message);
  revalidatePath("/account/listings");
  revalidatePath(`/auctions/${auctionId}`);
  return { ok: true, message: "Listing withdrawn." };
}

/** Live: the seller can only ask; an admin decides. */
export async function requestWithdrawal(input: unknown): Promise<WithdrawResult> {
  const parsed = requestWithdrawalSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? FAILED };
  const { auctionId, reason } = parsed.data;
  const { error } = await getServerSupabase().rpc("seller_request_withdrawal", { p_auction_id: auctionId, p_reason: reason });
  if (error) return fail(error.message);
  revalidatePath("/account/listings");
  return { ok: true, message: "Withdrawal requested. The Biddr team will reply soon." };
}

// -----------------------------------------------------------------------------
// After a rejected dealer report (0016): the seller chooses how to continue.
// -----------------------------------------------------------------------------
export type NewReportResult = WithdrawResult & { fieldErrors?: Record<string, string> };

/** "List without an inspection": seller_inspection_decision checks ownership, status and that a choice is due. */
export async function listWithoutInspection(input: unknown): Promise<WithdrawResult> {
  const parsed = z.object({ auctionId: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "This link is broken. Reload the page." };
  const { error } = await getServerSupabase().rpc("seller_inspection_decision", {
    p_auction_id: parsed.data.auctionId,
    p_decision: "without_inspection",
  });
  if (error) return { ok: false, error: DECISION_ERRORS[error.message] ?? FAILED };
  revalidatePath("/account/listings");
  revalidatePath(`/auctions/${parsed.data.auctionId}`);
  return { ok: true, message: "Done. Your listing will be reviewed without a dealer inspection." };
}

/**
 * "Upload a new report": replaces the rejected report, sends it back for review
 * ('pending') and records the choice. Files must be in the seller's own folder for
 * this listing: <user id>/<auction id>/.
 */
export async function submitNewReport(input: unknown): Promise<NewReportResult> {
  const parsed = newReportSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { ok: false, error: "Check the highlighted fields.", fieldErrors };
  }
  const v = parsed.data;

  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: DECISION_ERRORS.NOT_AUTHENTICATED! };

  // The user's own client: RLS returns the row only to its seller (or an admin).
  const { data: auction } = await supabase
    .from("auctions")
    .select("id, seller_id, status")
    .eq("id", v.auctionId)
    .maybeSingle<{ id: string; seller_id: string; status: string }>();
  if (!auction) return { ok: false, error: DECISION_ERRORS.AUCTION_NOT_FOUND! };
  if (auction.seller_id !== user.id) return { ok: false, error: DECISION_ERRORS.NOT_OWNER! };
  if (auction.status !== "draft") return { ok: false, error: DECISION_ERRORS.NOT_DRAFT! };

  const admin = getAdminSupabase();
  const { data: priv } = await admin
    .from("auction_private")
    .select("seller_decision_required, dealer_report_paths")
    .eq("auction_id", v.auctionId)
    .maybeSingle<{ seller_decision_required: boolean; dealer_report_paths: string[] | null }>();
  if (!priv?.seller_decision_required) return { ok: false, error: DECISION_ERRORS.NO_DECISION_NEEDED! };

  if (!(await checkReportPaths(v.reportPaths, `${user.id}/${v.auctionId}`))) {
    return {
      ok: false,
      error: "One of the report files didn't upload correctly.",
      fieldErrors: { reportFiles: "One of the report files didn't upload correctly. Remove it and add it again." },
    };
  }

  const now = new Date().toISOString();
  const { data: updated, error } = await admin
    .from("auction_private")
    .update({
      dealer_inspection_provided: true,
      dealer_name: v.name,
      dealer_city: v.city,
      dealer_country: v.country,
      dealer_inspection_date: v.date,
      dealer_inspection_mileage_km: v.mileageKm,
      dealer_report_paths: v.reportPaths,
      inspection_review_status: "pending",
      inspection_review_note: null,
      inspection_reviewed_by: null,
      inspection_reviewed_at: null,
      seller_decision: "new_report",
      seller_decision_at: now,
      seller_decision_required: false,
    })
    .eq("auction_id", v.auctionId)
    .eq("seller_decision_required", true) // not twice, and not after the deadline job
    .select("auction_id");
  if (error || !updated?.length) return { ok: false, error: error ? FAILED : DECISION_ERRORS.NO_DECISION_NEEDED! };

  // The rejected report is replaced: remove its files (personal details we no longer need).
  const old = (priv.dealer_report_paths ?? []).filter((p) => !v.reportPaths.includes(p));
  if (old.length) {
    const { error: removeError } = await admin.storage.from(REPORT_BUCKET).remove(old);
    if (removeError) console.error("removing the rejected report files failed", removeError);
  }

  // Tell every admin (not the seller, if an admin sells).
  const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin").returns<{ id: string }[]>();
  const rows = (admins ?? [])
    .filter((a) => a.id !== user.id)
    .map((a) => ({ user_id: a.id, type: "seller_decided", auction_id: v.auctionId, actor_id: user.id, data: { decision: "new_report" } }));
  if (rows.length) {
    const { error: notifyError } = await admin.from("notifications").insert(rows);
    if (notifyError) console.error("seller_decided notification failed", notifyError);
  }

  revalidatePath("/account/listings");
  revalidatePath(`/auctions/${v.auctionId}`);
  revalidatePath(`/admin/auctions/${v.auctionId}`);
  return { ok: true, message: "New report sent. We'll check it and let you know." };
}

// -----------------------------------------------------------------------------
// After a rejected vehicle history report (0020): the seller uploads another
// report or corrects the damage description, while the listing is in review.
// Either sends the history report back to Biddr's team ('pending').
// -----------------------------------------------------------------------------
type OwnDraft = { userId: string } | { error: string };

/** The signed-in seller's own listing, still waiting for review, with a rejected history report. */
async function ownDraftWithRejectedHistory(auctionId: string): Promise<OwnDraft> {
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: DECISION_ERRORS.NOT_AUTHENTICATED! };
  const { data: auction } = await supabase
    .from("auctions")
    .select("id, seller_id, status")
    .eq("id", auctionId)
    .maybeSingle<{ id: string; seller_id: string; status: string }>();
  if (!auction) return { error: DECISION_ERRORS.AUCTION_NOT_FOUND! };
  if (auction.seller_id !== user.id) return { error: "You can only change your own listings." };
  if (auction.status !== "draft") return { error: DECISION_ERRORS.NOT_DRAFT! };
  const { data: priv } = await getAdminSupabase()
    .from("auction_private")
    .select("history_review_status")
    .eq("auction_id", auctionId)
    .maybeSingle<{ history_review_status: string | null }>();
  if (priv?.history_review_status !== "rejected") {
    return { error: "Your history report is already waiting for review. Reload the page to see the status." };
  }
  return { userId: user.id };
}

async function notifyAdminsHistoryResubmitted(auctionId: string, actor: string) {
  const admin = getAdminSupabase();
  const { data: admins } = await admin.from("profiles").select("id").eq("role", "admin").returns<{ id: string }[]>();
  const rows = (admins ?? []).filter((a) => a.id !== actor).map((a) => ({ user_id: a.id, type: "listing_submitted", auction_id: auctionId, actor_id: actor, data: { history_report: true } }));
  if (rows.length) {
    const { error } = await admin.from("notifications").insert(rows);
    if (error) console.error("history report resubmitted notification failed", error);
  }
}

/** Another carVertical report: files in the seller's folder for this listing, and/or a share link. */
export async function submitNewHistoryReport(input: unknown): Promise<NewReportResult> {
  const parsed = newHistoryReportSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[String(issue.path[0] ?? "form")] ??= issue.message;
    return { ok: false, error: "Check the highlighted fields.", fieldErrors };
  }
  const v = parsed.data;
  const own = await ownDraftWithRejectedHistory(v.auctionId);
  if ("error" in own) return { ok: false, error: own.error };

  const paths = v.historyFiles.map((f) => f.path);
  if (paths.length && !(await checkReportPaths(paths, `${own.userId}/${v.auctionId}`))) {
    return {
      ok: false,
      error: "One of the report files didn't upload correctly.",
      fieldErrors: { historyFiles: "One of the report files didn't upload correctly. Remove it and add it again." },
    };
  }

  const admin = getAdminSupabase();
  const { data: before } = await admin
    .from("auction_private")
    .select("history_report_paths")
    .eq("auction_id", v.auctionId)
    .maybeSingle<{ history_report_paths: string[] | null }>();
  const { data: updated, error } = await admin
    .from("auction_private")
    .update({
      history_report_provided: true,
      history_report_paths: paths,
      history_report_link: v.historyLink || null,
      history_report_share_allowed: v.historyShareAllowed,
      // The rejection reason stays until the next review, so My listings can show what happened.
      history_review_status: "pending",
    })
    .eq("auction_id", v.auctionId)
    .eq("history_review_status", "rejected")
    .select("auction_id");
  if (error || !updated?.length) return { ok: false, error: FAILED };

  // The rejected report's files are replaced: remove them.
  const old = (before?.history_report_paths ?? []).filter((p) => !paths.includes(p));
  if (old.length) {
    const { error: removeError } = await admin.storage.from(REPORT_BUCKET).remove(old);
    if (removeError) console.error("removing the rejected history report files failed", removeError);
  }

  await notifyAdminsHistoryResubmitted(v.auctionId, own.userId);
  revalidatePath("/account/listings");
  revalidatePath(`/admin/auctions/${v.auctionId}`);
  return { ok: true, message: "New history report sent. Biddr's team will check it." };
}

const damageSummarySchema = z.object({
  auctionId: z.string().uuid("This link is broken. Reload the page."),
  damageSummary: z
    .string()
    .trim()
    .min(40, "Describe the damage and the repair: at least 40 characters.")
    .max(4000, "Keep the summary under 4,000 characters."),
});

/** Corrected damage description, so it matches the history report. The seller's own client writes it (RLS: own drafts only). */
export async function updateDamageSummary(input: unknown): Promise<NewReportResult> {
  const parsed = damageSummarySchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "Check the highlighted field.", fieldErrors: { damageSummary: parsed.error.issues[0]?.message ?? FAILED } };
  }
  const v = parsed.data;
  const own = await ownDraftWithRejectedHistory(v.auctionId);
  if ("error" in own) return { ok: false, error: own.error };

  const { data, error } = await getServerSupabase()
    .from("auctions")
    .update({ damage_history_summary: v.damageSummary })
    .eq("id", v.auctionId)
    .eq("status", "draft")
    .select("id");
  if (error || !data?.length) return { ok: false, error: FAILED };

  const { error: privError } = await getAdminSupabase()
    .from("auction_private")
    .update({ history_review_status: "pending" })
    .eq("auction_id", v.auctionId)
    .eq("history_review_status", "rejected");
  if (privError) return { ok: false, error: FAILED };

  await notifyAdminsHistoryResubmitted(v.auctionId, own.userId);
  revalidatePath("/account/listings");
  revalidatePath(`/admin/auctions/${v.auctionId}`);
  return { ok: true, message: "Description updated. Biddr's team will check your history report again." };
}
