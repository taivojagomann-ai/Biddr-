// Wording and links for notifications (0009). The database stores only the type
// and ids/data, so all text is built here and can be translated later.
// Shared by the header bell and /account/notifications.
import { formatBaltic } from "@/lib/baltic-time";
import { formatEur } from "@/lib/format";
import type { NotificationRow, NotificationType } from "@/lib/types";

export const NOTIFICATION_COLUMNS =
  "id,type,auction_id,comment_id,actor_id,data,read_at,created_at,auction:auctions(title)" as const;

export const BELL_LIMIT = 20;
export const PAGE_SIZE = 50;

const TYPES: readonly NotificationType[] = [
  "question", "answer", "outbid", "listing_approved", "listing_rejected",
  "auction_live", "auction_ended", "auction_won", "listing_submitted",
  "watch_ending_soon", "watch_live",
];

export function isNotificationType(v: unknown): v is NotificationType {
  return typeof v === "string" && (TYPES as readonly string[]).includes(v);
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

export interface NotificationCopy {
  /** One line, e.g. "You've been outbid on 2019 BMW M2 Competition (new bid €38,750)". */
  text: string;
  /** Car title for the second line, when the text doesn't already contain it. */
  title: string | null;
}

export function notificationCopy(n: NotificationRow): NotificationCopy {
  const title = n.auction?.title ?? null;
  const car = title ?? "a car";
  const withTitle = (text: string): NotificationCopy => ({ text, title });
  const titled = (text: string): NotificationCopy => ({ text, title: null });

  switch (n.type) {
    case "question":
      return titled(`New question on ${car}`);
    case "answer":
      return withTitle("The seller answered your question");
    case "outbid": {
      const amount = num(n.data.amount);
      return titled(`You've been outbid on ${car}${amount !== null ? ` (new bid ${formatEur(amount)})` : ""}`);
    }
    case "listing_approved": {
      const starts = str(n.data.starts_at);
      return withTitle(starts ? `Your listing was approved. Bidding starts ${formatBaltic(starts)}.` : "Your listing was approved.");
    }
    case "listing_rejected":
      return withTitle("Your listing wasn't accepted");
    case "auction_live":
      return withTitle("Your auction is live");
    case "auction_ended": {
      const bid = num(n.data.final_bid);
      const status = str(n.data.status);
      if (status === "sold" && bid !== null) return withTitle(`Your auction ended: sold for ${formatEur(bid)}`);
      if (status === "reserve_not_met") {
        return withTitle(`Your auction ended below the reserve${bid !== null ? ` (high bid ${formatEur(bid)})` : ""}`);
      }
      return withTitle(bid === null ? "Your auction ended with no bids" : "Your auction ended");
    }
    case "auction_won": {
      const bid = num(n.data.final_bid);
      return titled(`You won ${car}${bid !== null ? ` for ${formatEur(bid)}` : ""}`);
    }
    case "listing_submitted":
      return withTitle("New car submitted for review");
    case "watch_ending_soon":
      return titled(`${car} ends in less than an hour`);
    case "watch_live":
      return titled(`${car} is now live`);
  }
}

/** Where a notification leads. */
export function notificationHref(n: NotificationRow): string {
  const a = n.auction_id;
  switch (n.type) {
    case "question":
    case "answer":
      return a ? `/auctions/${a}${n.comment_id ? `#comment-${n.comment_id}` : ""}` : "/account/notifications";
    case "outbid":
    case "watch_ending_soon":
    case "watch_live":
    case "auction_live":
    case "auction_ended":
    case "auction_won":
      return a ? `/auctions/${a}` : "/account/notifications";
    case "listing_approved":
    case "listing_rejected":
      return "/account/listings";
    case "listing_submitted":
      return a ? `/admin/auctions/${a}` : "/admin";
  }
}

/** Defensive parse of rows from the API or Realtime (unknown types are dropped). */
export function asNotificationRows(rows: unknown): NotificationRow[] {
  if (!Array.isArray(rows)) return [];
  return rows.filter((r): r is NotificationRow => {
    if (typeof r !== "object" || r === null) return false;
    const o = r as Record<string, unknown>;
    return typeof o.id === "string" && isNotificationType(o.type) && typeof o.created_at === "string";
  }).map((r) => ({ ...r, data: typeof r.data === "object" && r.data !== null ? r.data : {} }));
}

/** "9+" above nine. */
export function badgeCount(n: number): string {
  return n > 9 ? "9+" : String(n);
}
