// The home page's featured carousel (DECISIONS.md point 9): live auctions with an active
// premium seat (always labelled "Featured"), plus live auctions ending within 24 hours.
// Most bids first; ties ending soonest first. Shared by the page (server) and the carousel.
import { AUCTION_CARD_COLUMNS, type AuctionCard } from "@/lib/types";

export const FEATURED_COLUMNS = `${AUCTION_CARD_COLUMNS},premium_seat_until,premium_seat_source` as const;
export type PremiumSeatSource = "paid" | "admin";
export type FeaturedCard = AuctionCard & { premium_seat_until: string | null; premium_seat_source: PremiumSeatSource | null };

/** Auctions ending within this window are featured. */
export const FEATURED_WINDOW_MS = 24 * 60 * 60 * 1000;
/** At most this many slides; premium seats always get theirs. */
export const FEATURED_MAX_SLIDES = 12;
/** Seconds between slides while playing. */
export const FEATURED_AUTOPLAY_MS = 5000;

export function hasPremiumSeat(a: Pick<FeaturedCard, "premium_seat_until">, now: number): boolean {
  return Boolean(a.premium_seat_until && Date.parse(a.premium_seat_until) > now);
}

/** Most bids first; ties: ending soonest first; then by id, so the order never flickers. */
export function compareFeatured(a: Pick<FeaturedCard, "bid_count" | "ends_at" | "id">, b: Pick<FeaturedCard, "bid_count" | "ends_at" | "id">): number {
  return (
    (b.bid_count ?? 0) - (a.bid_count ?? 0) ||
    (Date.parse(a.ends_at ?? "") || Infinity) - (Date.parse(b.ends_at ?? "") || Infinity) ||
    a.id.localeCompare(b.id)
  );
}

/** Which live auctions are featured now, in order, each once. */
export function pickFeatured(rows: FeaturedCard[], now: number): FeaturedCard[] {
  const seen = new Set<string>();
  const live = rows.filter((a) => {
    if (seen.has(a.id) || a.status !== "live" || !a.ends_at || Date.parse(a.ends_at) <= now) return false;
    seen.add(a.id);
    return hasPremiumSeat(a, now) || Date.parse(a.ends_at) - now <= FEATURED_WINDOW_MS;
  });
  const premium = live.filter((a) => hasPremiumSeat(a, now));
  const others = live.filter((a) => !hasPremiumSeat(a, now)).sort(compareFeatured).slice(0, Math.max(0, FEATURED_MAX_SLIDES - premium.length));
  return [...premium, ...others].sort(compareFeatured);
}
