// Seller withdrawals (0015). No "use client": used by server actions and client dialogs.
import { z } from "zod";
import type { AuctionStatus } from "@/lib/types";

export const REQUEST_REASON_MIN = 20;
export const REASON_MAX = 1000;

export const LIVE_WITHDRAW_NOTE =
  "Bidders have already committed to this car, so live auctions can only be withdrawn by the Biddr team for a good reason, such as damage or a sale elsewhere.";

/** What the seller can do on /account/listings for a listing in this status. */
export function withdrawOption(status: AuctionStatus, requestStatus: string | null): "withdraw" | "request" | "requested" | null {
  if (status === "draft" || status === "upcoming") return "withdraw";
  if (status === "live") return requestStatus === "pending" ? "requested" : "request";
  return null;
}

const id = z.string().uuid("This link is broken. Reload the page.");

export const withdrawSchema = z.object({
  auctionId: id,
  reason: z.string().trim().max(REASON_MAX, `Keep the reason under ${REASON_MAX.toLocaleString("en-IE")} characters.`),
});

export const requestWithdrawalSchema = z.object({
  auctionId: id,
  reason: z
    .string()
    .trim()
    .min(REQUEST_REASON_MIN, `Explain why in at least ${REQUEST_REASON_MIN} characters.`)
    .max(REASON_MAX, `Keep the reason under ${REASON_MAX.toLocaleString("en-IE")} characters.`),
});

export type WithdrawResult = { ok: true; message: string } | { ok: false; error: string };

/** Error codes raised by seller_withdraw / seller_request_withdrawal, in plain words. */
export const WITHDRAW_ERRORS: Record<string, string> = {
  NOT_AUTHENTICATED: "Your session has expired. Sign in again.",
  AUCTION_NOT_FOUND: "This listing no longer exists.",
  NOT_OWNER: "You can only withdraw your own listings.",
  NOT_WITHDRAWABLE: "This listing can't be withdrawn any more. Reload the page to see its status.",
  NOT_LIVE: "This auction isn't live any more. Reload the page to see its status.",
  REASON_LENGTH: `Explain why in ${REQUEST_REASON_MIN} to ${REASON_MAX.toLocaleString("en-IE")} characters.`,
  REASON_TOO_LONG: `Keep the reason under ${REASON_MAX.toLocaleString("en-IE")} characters.`,
  ALREADY_REQUESTED: "You've already asked to withdraw this auction. The Biddr team will reply soon.",
};

/** Error codes from seller_inspection_decision (0016), in plain words. */
export const DECISION_ERRORS: Record<string, string> = {
  NOT_AUTHENTICATED: "Your session has expired. Sign in again.",
  AUCTION_NOT_FOUND: "This listing no longer exists.",
  NOT_OWNER: "You can only decide for your own listings.",
  NOT_DRAFT: "This listing isn't waiting for review any more. Reload the page to see its status.",
  NO_DECISION_NEEDED: "You've already chosen how to continue. Reload the page to see the status.",
  NEW_REPORT_NEEDS_UPLOAD: "Upload the new report to choose this.",
  INVALID_DECISION: "Choose one of the options.",
};
