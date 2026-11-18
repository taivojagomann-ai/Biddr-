// "Report a problem" after a sale (migration 0026, DECISIONS.md point 13).
import { SELLER_PAYMENT_DAYS } from "@/lib/settlement-constants";

export type ReportReason =
  | "seller_wont_hand_over" | "not_as_described" | "cant_reach_seller"
  | "buyer_not_paid" | "cant_reach_buyer" | "other";
export type ReportStatus = "open" | "in_review" | "resolved";
export type ReportOutcome = "resolved" | "sale_failed";

export const REASONS: Record<"buyer" | "seller", { value: ReportReason; label: string }[]> = {
  buyer: [
    { value: "seller_wont_hand_over", label: "The seller won't hand over the car" },
    { value: "not_as_described", label: "The car isn't as described" },
    { value: "cant_reach_seller", label: "I can't reach the seller" },
    { value: "other", label: "Other" },
  ],
  seller: [
    { value: "buyer_not_paid", label: "The buyer hasn't paid for the car" },
    { value: "cant_reach_buyer", label: "I can't reach the buyer" },
    { value: "other", label: "Other" },
  ],
};

export const REASON_LABELS: Record<ReportReason, string> = Object.fromEntries(
  [...REASONS.buyer, ...REASONS.seller].map((r) => [r.value, r.label]),
) as Record<ReportReason, string>;

export const STATUS_LABELS: Record<ReportStatus, string> = {
  open: "Open: Biddr will look at it soon",
  in_review: "In review",
  resolved: "Resolved",
};

export const DESCRIPTION_MIN = 20;

/** "The buyer hasn't paid for the car" can be chosen once the 7 days to pay have passed. */
export function buyerPaymentOverdue(paidAt: string | null, now = Date.now()): boolean {
  return Boolean(paidAt) && now > Date.parse(paidAt!) + SELLER_PAYMENT_DAYS * 86_400_000;
}

export interface ReportRow {
  id: string;
  buyer_payment_id: string;
  auction_id: string;
  conversation_id: string | null;
  reporter_id: string;
  reporter_role: "buyer" | "seller";
  reason: ReportReason;
  description: string;
  status: ReportStatus;
  outcome: ReportOutcome | null;
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
  created_at: string;
  updated_at: string;
}
