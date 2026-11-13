/** Maps stable error codes raised by place_bid / API routes to user-facing copy. */
export type BidErrorCode =
  | "NOT_AUTHENTICATED" | "NOT_VERIFIED" | "HOLD_REQUIRED" | "AUCTION_NOT_FOUND" | "AUCTION_NOT_LIVE"
  | "AUCTION_ENDED" | "OWN_AUCTION" | "ALREADY_LEADING" | "BID_TOO_LOW" | "INVALID_AMOUNT" | "DEMO_AUCTION"
  | "PROFILE_INCOMPLETE" | "TERMS_NOT_ACCEPTED" | "TERMS_VERSION_MISMATCH";

const MESSAGES: Record<BidErrorCode, string> = {
  NOT_AUTHENTICATED: "Sign in to place a bid.",
  NOT_VERIFIED: "Confirm your card to become a verified bidder.",
  HOLD_REQUIRED: "Place the refundable security hold before your first bid on this car.",
  AUCTION_NOT_FOUND: "This auction no longer exists.",
  AUCTION_NOT_LIVE: "Bidding hasn't opened on this car yet.",
  AUCTION_ENDED: "Bidding has closed on this car.",
  OWN_AUCTION: "You can't bid on your own car.",
  ALREADY_LEADING: "You already have the high bid.",
  BID_TOO_LOW: "Someone bid first. Raise your bid to at least the new minimum.",
  INVALID_AMOUNT: "Enter a bid in whole euros.",
  DEMO_AUCTION: "This is a demo listing. Bidding is turned off.",
  PROFILE_INCOMPLETE: "Finish your profile before you bid: add your username, full name, country and phone.",
  TERMS_NOT_ACCEPTED: "Accept the bidding terms before you bid.",
  TERMS_VERSION_MISMATCH: "The bidding terms have just been updated. Read the new version and accept it to continue.",
};

export function isBidErrorCode(v: string): v is BidErrorCode {
  return v in MESSAGES;
}

export function bidErrorMessage(raw: string | undefined): string {
  if (raw && isBidErrorCode(raw)) return MESSAGES[raw];
  return "Your bid didn't go through. Check your connection and try again.";
}
