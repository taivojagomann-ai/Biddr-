// Domain types mirroring supabase/migrations/0001_init.sql.
// Run `npm run db:types` to also generate the full Database type from your project.

export type Country = "EE" | "LV" | "LT";
export type ConditionType = "clean" | "restored_accident";
export type AuctionStatus =
  | "draft" | "upcoming" | "live" | "ended" | "sold" | "reserve_not_met" | "rejected" | "withdrawn";
export type HoldStatus = "pending" | "authorized" | "released" | "captured" | "failed";
export type UserRole = "user" | "seller" | "admin";
export type InspectionCity = "Tallinn" | "Riga" | "Vilnius";

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
  before_photos_urls: string[];
  gallery_urls: GalleryUrls;
  video_url: string | null;
  starting_bid: number;
  has_reserve: boolean;
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
  created_at: string;
  updated_at: string;
}

/** Admin-only row in auction_private. Never select this with the browser client. */
export interface AuctionPrivate {
  auction_id: string;
  reserve_price: number | null;
  admin_notes: string | null;
  inspection_city: InspectionCity | null;
  requested_reserve: number | null;
  inspection_preferred_dates: string | null;
  contact_notes: string | null;
  rejection_reason: string | null;
}

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
  "id,title,make,model,year,mileage_km,location_city,location_country,condition_type,inspection_partner_name,gallery_urls,starting_bid,has_reserve,reserve_met,current_bid,bid_count,ends_at,starts_at,status,is_demo" as const;

export type AuctionCard = Pick<
  Auction,
  | "id" | "title" | "make" | "model" | "year" | "mileage_km" | "location_city" | "location_country"
  | "condition_type" | "inspection_partner_name" | "gallery_urls" | "starting_bid" | "has_reserve"
  | "reserve_met" | "current_bid" | "bid_count" | "ends_at" | "starts_at" | "status" | "is_demo"
>;

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

export interface HoldResponse {
  status: "authorized" | "requires_payment";
  clientSecret?: string;
  paymentIntentId?: string;
  amountEur: number;
}
