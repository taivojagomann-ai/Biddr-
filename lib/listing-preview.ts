// Listing previews: the seller's own view of a listing before it is published.
// No "use client" here; the sell form (client) and the auction page (server) both use it.
import { listingColumns, parseSubmission, type SellInput } from "@/lib/sell";
import type { Auction } from "@/lib/types";

export const PREVIEW_TEXT = {
  sellBanner: "Preview: this is how buyers will see your listing.",
  privateBanner: "Preview: only you can see this.",
  waiting: "Waiting for review.",
  bidding: "Bidding opens after review",
  comments: "Questions open when the auction starts",
  inspection: "Inspection will be added after your car is inspected",
} as const;

/** Statuses whose page is a preview: only the seller and admins can open it. */
export function isPreviewStatus(status: Auction["status"]): boolean {
  return status === "draft" || status === "rejected";
}

/**
 * The auction a submission would create, built with the same column mapping as the
 * submit action. Nothing is saved. Returns null when the form doesn't validate.
 * The confirmation tick is only needed to submit, not to preview.
 */
export function previewAuction(input: SellInput, sellerId: string): Auction | null {
  const parsed = parseSubmission({ ...input, confirmed: true });
  if (!parsed.success) return null;
  const now = new Date().toISOString();
  return {
    ...listingColumns(parsed),
    id: parsed.data.draftId,
    seller_id: sellerId,
    inspection_partner_name: null,
    inspection_report_url: null,
    inspection_date: null,
    inspection_highlights: [],
    has_reserve: parsed.data.reserve !== null,
    reserve_met: false,
    current_bid: null,
    leading_bidder_id: null,
    bid_count: 0,
    min_bid_increment: 250,
    starts_at: null,
    ends_at: null,
    status: "draft",
    is_demo: false,
    watch_count: 0,
    created_at: now,
    updated_at: now,
  };
}
