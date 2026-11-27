import type { EuCountry } from "@/lib/countries";
// Domain types mirroring supabase/migrations/0001_init.sql.
// Run `npm run db:types` to also generate the full Database type from your project.

/** Any of the 27 EU countries (DECISIONS.md, point 2; 0018 widened the database type). */
export type Country = EuCountry;
export type ConditionType = "clean" | "restored_accident";
export type AuctionStatus =
  | "draft" | "upcoming" | "live" | "ended" | "sold" | "reserve_not_met" | "rejected" | "withdrawn";
export type HoldStatus = "pending" | "authorized" | "released" | "captured" | "failed";
export type UserRole = "user" | "seller" | "admin";
export type InspectionCity = "Tallinn" | "Riga" | "Vilnius";
export type BodyStyle = "coupe" | "sedan" | "estate" | "hatchback" | "convertible" | "suv" | "other";
export type SellerType = "private" | "dealer";
/** An EU country, outside the EU, or "other_eu" (only on listings saved before 0018). */
export type RegistrationCountry = EuCountry | "other_eu" | "non_eu";

/** One row of auctions.service_history (0007). */
export interface ServiceRecord {
  date: string; // "YYYY-MM"
  mileage_km: number;
  description: string;
  workshop?: string | null;
}

export interface GalleryUrls {
  exterior: string[];
  interior: string[];
  mechanical: string[]; // engine bay + undercarriage
}

export interface Auction {
  id: string;
  seller_id: string;
  title: string;
  make: string;
  model: string;
  variant: string | null;
  year: number;
  vin: string;
  mileage_km: number;
  engine: string | null;
  transmission: string | null;
  drivetrain: string | null;
  exterior_color: string | null;
  location_city: string;
  location_country: Country;
  condition_type: ConditionType;
  damage_history_summary: string | null;
  inspection_partner_name: string | null;
  inspection_report_url: string | null;
  inspection_date: string | null;
  inspection_highlights: string[];
  /** The seller withdrew it while it was waiting for review (0015): stays private like a draft. */
  withdrawn_before_review: boolean;
  /** 'authorised_dealer' once an admin accepted the dealer's report (0014); the badge shows only then. */
  inspection_type: InspectionType | null;
  /** The selling dealer inspected the car itself (0017): shown as "Inspected by the selling dealer". */
  inspected_by_seller: boolean;
  /** An admin accepted the seller's carVertical vehicle history report (0020): "History report" badge and summary. */
  history_report_verified: boolean;
  /** The report's carVertical link, only when the seller allowed sharing and the report was accepted (0020). */
  history_report_public_link: string | null;
  /** 2 to 8 short lines written by the admin from the accepted report (0020). */
  history_summary: string[];
  before_photos_urls: string[];
  gallery_urls: GalleryUrls;
  video_url: string | null;
  starting_bid: number;
  has_reserve: boolean;
  /** The seller chose "Other": the make isn't in lib/data/car-makes.ts (0023). */
  make_other?: boolean;
  reserve_met: boolean;
  current_bid: number | null;
  leading_bidder_id: string | null;
  bid_count: number;
  min_bid_increment: number;
  starts_at: string | null;
  ends_at: string | null;
  status: AuctionStatus;
  /** Created by the admin "Demo data" tools; bidding is refused (0006). */
  is_demo: boolean;
  /** Number of members watching (0010), kept in step by database triggers. */
  watch_count: number;
  // Structured listing details (0007)
  body_style: BodyStyle | null;
  interior_color: string | null;
  seller_type: SellerType;
  dealer_name: string | null;
  dealer_registry_code: string | null;
  registration_country: RegistrationCountry | null;
  is_registered: boolean | null;
  owner_count: number | null;
  highlights: string[];
  equipment: string[];
  modifications: string[];
  known_flaws: string[];
  items_included: string[];
  no_known_flaws: boolean;
  no_modifications: boolean;
  service_history: ServiceRecord[];
  seller_notes: string | null;
  created_at: string;
  updated_at: string;
  /** 0035: premium seat in the featured carousel (labelled "Featured"). */
  premium_seat_until?: string | null;
  premium_seat_source?: "paid" | "admin" | null;
}

/** Admin-only row in auction_private. Never select this with the browser client. */
export interface AuctionPrivate {
  auction_id: string;
  reserve_price: number | null;
  admin_notes: string | null;
  /** 0013, no longer used (Biddr partner bookings were replaced by dealer reports in 0014). */
  inspection_requested: boolean | null;
  /** No longer used since 0014. */
  inspection_city: InspectionCity | null;
  requested_reserve: number | null;
  inspection_preferred_dates: string | null;
  contact_notes: string | null;
  rejection_reason: string | null;
  // Authorised dealer inspection report (0014). Private: only admins and the server read these.
  /** true: the seller uploaded a report; false: listed without one; null: submitted before 0014. */
  dealer_inspection_provided: boolean | null;
  dealer_name: string | null;
  dealer_city: string | null;
  /** EU country code */
  dealer_country: string | null;
  dealer_inspection_date: string | null;
  dealer_inspection_mileage_km: number | null;
  /** Paths in the private inspection-uploads bucket: <user id>/<draft id>/<uuid>.<ext> */
  dealer_report_paths: string[];
  inspection_review_status: InspectionReviewStatus | null;
  inspection_review_note: string | null;
  inspection_reviewed_by: string | null;
  inspection_reviewed_at: string | null;
  // Seller withdrawals (0015)
  /** Why the seller withdrew, or why they asked to withdraw a live auction. */
  withdraw_reason: string | null;
  withdraw_requested_at: string | null;
  /** Only for live auctions, where the seller can only ask. */
  withdraw_request_status: WithdrawRequestStatus | null;
  // The seller's choice after a rejected dealer report (0016)
  /** True from "Reject report" until the seller chooses (or the deadline withdraws the listing). */
  seller_decision_required: boolean;
  seller_decision_deadline: string | null;
  seller_decision: SellerInspectionDecision | null;
  seller_decision_at: string | null;
  /** The admin confirmed the inspecting dealer is the selling dealer (0017). */
  inspected_by_seller: boolean;
  // The seller's carVertical vehicle history report and its review (0020)
  /** true: the seller added a report; false or null: no report. */
  history_report_provided: boolean | null;
  /** Files in the private inspection-uploads bucket, under the seller's folder. */
  history_report_paths: string[];
  /** The report's carVertical share link (https, carvertical.com). */
  history_report_link: string | null;
  /** The seller allowed buyers to open the report itself. */
  history_report_share_allowed: boolean;
  history_review_status: "pending" | "accepted" | "rejected" | null;
  /** The reason given to the seller when the report was rejected. */
  history_review_note: string | null;
  history_reviewed_by: string | null;
  history_reviewed_at: string | null;
}

export type SellerInspectionDecision = "new_report" | "without_inspection";

export type WithdrawRequestStatus = "pending" | "approved" | "declined";

export type InspectionReviewStatus = "pending" | "accepted" | "rejected";
/** auctions.inspection_type (0014): set when an admin accepted an authorised dealer's report. */
export type InspectionType = "authorised_dealer";

/** Row in admin_actions (service role only). */
export interface AdminActionRow {
  id: string;
  admin_id: string | null;
  auction_id: string | null;
  action: string;
  details: Record<string, unknown>;
  created_at: string;
}

/** Columns the feed needs; keeps list queries light. */
export const AUCTION_CARD_COLUMNS =
  "id,title,make,model,year,mileage_km,location_city,location_country,condition_type,inspection_partner_name,gallery_urls,starting_bid,has_reserve,reserve_met,current_bid,bid_count,ends_at,starts_at,status,is_demo,watch_count,inspection_type" as const;

export type AuctionCard = Pick<
  Auction,
  | "id" | "title" | "make" | "model" | "year" | "mileage_km" | "location_city" | "location_country"
  | "condition_type" | "inspection_partner_name" | "gallery_urls" | "starting_bid" | "has_reserve"
  | "reserve_met" | "current_bid" | "bid_count" | "ends_at" | "starts_at" | "status" | "is_demo" | "watch_count" | "inspection_type"
>;

/**
 * auctions.search_text / search_words (0012) are kept by a trigger and only used
 * inside the search functions; the app never reads or writes them.
 *
 * One row of search_auctions(p_query, p_tab, p_country, p_condition, p_limit, p_offset):
 * the card columns, the row's position and the total number of matches.
 */
export type AuctionSearchRow = AuctionCard & { sort_rank: number; total_count: number };

/** One row of search_suggestions(p_query, p_limit): a make, or a make + model (+ variant). */
export interface SearchSuggestion {
  label: string;
  make: string;
  model: string | null;
  variant: string | null;
  listing_count: number;
}

export interface BidHistoryRow {
  id: string;
  amount: number;
  created_at: string;
  bidder_id: string;
  username: string | null;
  country: Country | null;
}

/** Comment select with author join. Lives here (not in a client module) so server code can use it. */
export const COMMENT_COLUMNS =
  "id,auction_id,user_id,parent_id,content,is_seller_reply,created_at,author:profiles!comments_user_id_fkey(username,role)" as const;

export interface CommentRow {
  id: string;
  auction_id: string;
  user_id: string;
  parent_id: string | null;
  content: string;
  is_seller_reply: boolean;
  created_at: string;
  author: { username: string | null; role: UserRole } | null;
}

export interface PlaceBidResult {
  bid_id: string;
  current_bid: number;
  bid_count: number;
  ends_at: string;
  extended: boolean;
  min_next: number;
}

export type NotificationType =
  | "question" | "answer" | "outbid" | "listing_approved" | "listing_rejected"
  | "auction_live" | "auction_ended" | "auction_won" | "listing_submitted"
  | "watch_ending_soon" | "watch_live" | "inspection_rejected"
  | "withdrawal_approved" | "withdrawal_declined"
  | "seller_decided" | "inspection_decision_reminder" | "inspection_decision_expired"
  | "history_report_rejected"
  | "premium_due" | "premium_paid" | "premium_failed" | "make_suggested"
  | "premium_reminder" | "premium_unpaid" | "buyer_did_not_pay" | "second_chance_offer" | "second_chance_closed"
  | "bidding_unblocked" | "new_message" | "report_opened" | "report_resolved" | "account_blocked" | "selling_unblocked"
  | "viewing_update" | "conversation_reported" | "messaging_unblocked"
  | "identity_required" | "identity_verified" | "listing_on_hold" | "listing_needs_check" | "listing_edited"
  | "receipt_ready";

/** A row of public.notifications (0009) with the car title joined in. */
export interface NotificationRow {
  id: string;
  type: NotificationType;
  auction_id: string | null;
  comment_id: string | null;
  actor_id: string | null;
  data: Record<string, unknown>;
  read_at: string | null;
  created_at: string;
  auction: { title: string } | null;
}

/** What the signed-in user still needs before bidding (bidder_status(), 0008). */
export interface BidderStatus {
  profile_complete: boolean;
  terms_accepted: boolean;
  current_version: string;
  /** Didn't pay a buyer's premium in time (0025): can't place holds or bids until an admin lifts it. */
  blocked?: boolean;
  blocked_reason?: string | null;
}

/** Error codes for bidder requirements, from the database or /api/stripe/hold. */
export type BidderRequirementCode = "PROFILE_INCOMPLETE" | "TERMS_NOT_ACCEPTED" | "BIDDING_BLOCKED";

export interface HoldResponse {
  status: "authorized" | "requires_payment";
  clientSecret?: string;
  paymentIntentId?: string;
  amountEur: number;
}
