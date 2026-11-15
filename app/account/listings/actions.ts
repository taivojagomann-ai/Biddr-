"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { checkReportPaths } from "@/lib/report-files";
import { REPORT_BUCKET, newReportSchema } from "@/lib/sell";
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
