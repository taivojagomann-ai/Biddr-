"use server";
import { revalidatePath } from "next/cache";
import { getServerSupabase } from "@/lib/supabase/server";
import { WITHDRAW_ERRORS, requestWithdrawalSchema, withdrawSchema, type WithdrawResult } from "@/lib/withdraw";

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
