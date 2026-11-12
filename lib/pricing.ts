/** Mirrors public.buyers_premium(): 5% of the hammer price, min €350, max €3,500. */
export const PREMIUM_RATE = 0.05;
export const PREMIUM_MIN = 350;
export const PREMIUM_MAX = 3500;

export function buyersPremium(amount: number): number {
  return Math.min(PREMIUM_MAX, Math.max(PREMIUM_MIN, Math.round(amount * PREMIUM_RATE)));
}

export function minNextBid(a: { current_bid: number | null; starting_bid: number; min_bid_increment: number }): number {
  return a.current_bid === null ? a.starting_bid : a.current_bid + a.min_bid_increment;
}

export const QUICK_INCREMENTS = [250, 500, 1000] as const;
