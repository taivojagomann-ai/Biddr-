// Wording and links for notifications (0009). The database stores only the type
// and ids/data, so all text is built here and can be translated later.
// Shared by the header bell and /account/notifications.
import { formatDateTime } from "@/lib/zoned-time";
import { formatEur } from "@/lib/format";
import type { NotificationRow, NotificationType } from "@/lib/types";

export const NOTIFICATION_COLUMNS =
  "id,type,auction_id,comment_id,actor_id,data,read_at,created_at,auction:auctions(title)" as const;

export const BELL_LIMIT = 20;
export const PAGE_SIZE = 50;

const TYPES: readonly NotificationType[] = [
  "question", "answer", "outbid", "listing_approved", "listing_rejected",
  "auction_live", "auction_ended", "auction_won", "listing_submitted",
  "watch_ending_soon", "watch_live", "inspection_rejected",
  "withdrawal_approved", "withdrawal_declined",
  "seller_decided", "inspection_decision_reminder", "inspection_decision_expired",
  "history_report_rejected",
  "premium_due", "premium_paid", "premium_failed", "make_suggested",
  "premium_reminder", "premium_unpaid", "buyer_did_not_pay", "second_chance_offer", "second_chance_closed", "bidding_unblocked",
  "new_message", "report_opened", "report_resolved", "account_blocked", "selling_unblocked",
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

/** `tz`: the viewer's time zone for dates in the text (useTimeZone() in components). */
export function notificationCopy(n: NotificationRow, tz = "UTC"): NotificationCopy {
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
      return withTitle(starts ? `Your listing was approved. Bidding starts ${formatDateTime(starts, tz)}.` : "Your listing was approved.");
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
    case "withdrawal_approved":
      return withTitle("Your withdrawal request was approved. The auction is withdrawn.");
    case "withdrawal_declined": {
      const note = str(n.data.note);
      return withTitle(`Your withdrawal request was declined${note ? `: ${note}` : "."}`);
    }
    case "inspection_rejected": {
      const reason = str(n.data.reason);
      return withTitle(`Your inspection report wasn't accepted${reason ? `: ${reason}` : ""}. Choose how to continue.`);
    }
    case "seller_decided":
      return titled(
        `${car}: seller chose ${n.data.decision === "new_report" ? "a new report" : "to list without an inspection"}`,
      );
    case "inspection_decision_reminder": {
      const deadline = str(n.data.deadline);
      return withTitle(
        `Please choose how to continue${deadline ? ` by ${formatDateTime(deadline, tz)}` : " soon"}: upload a new inspection report or list without an inspection. Otherwise the listing is withdrawn.`,
      );
    }
    case "inspection_decision_expired":
      return withTitle("Your listing was withdrawn: no response after the inspection report was rejected.");
    case "premium_due": {
      const due = str(n.data.due_at);
      const by = due ? ` by ${formatDateTime(due, tz)}` : "";
      return withTitle(
        n.data.reason === "failed"
          ? `Your card was declined for the buyer's premium. Please pay it on My purchases${by}.`
          : `Your bank needs you to confirm the buyer's premium. Please complete the payment on My purchases${by}.`,
      );
    }
    case "premium_paid":
      return withTitle(
        n.data.role === "seller"
          ? "The buyer paid the buyer's premium. Their contact details are on My listings."
          : "Buyer's premium paid. The seller's contact details are on My purchases.",
      );
    case "make_suggested":
      return withTitle(`New make suggested: ${str(n.data.make) ?? "unknown"}`);
    case "premium_reminder": {
      const due = str(n.data.due_at);
      return withTitle(
        `Reminder: please pay the buyer's premium on My purchases${due ? ` by ${formatDateTime(due, tz)}` : ""}. Otherwise the sale is cancelled and your bidding is blocked.`,
      );
    }
    case "premium_unpaid":
      return withTitle("The buyer's premium wasn't paid in time, so the sale is cancelled and your bidding is blocked.");
    case "buyer_did_not_pay":
      return n.data.role === "admin"
        ? titled(`${car}: the buyer didn't pay the buyer's premium in time`)
        : withTitle("The buyer didn't pay the buyer's premium in time. Choose what to do next on My listings.");
    case "second_chance_offer": {
      const amount = num(n.data.amount);
      const until = str(n.data.expires_at);
      return withTitle(
        `Second chance: you can buy this car${amount !== null ? ` for ${formatEur(amount)}` : ""}. Answer on My purchases${until ? ` by ${formatDateTime(until, tz)}` : ""}.`,
      );
    }
    case "second_chance_closed":
      return withTitle(
        n.data.outcome === "declined"
          ? "The next bidder declined your offer. You can relist the car on My listings."
          : "The next bidder didn't accept and pay in time. You can relist the car on My listings.",
      );
    case "bidding_unblocked":
      return titled("Your bidding is unblocked. You can bid again.");
    case "new_message":
      return withTitle(
        n.data.from === "support"
          ? "New message from Biddr support"
          : n.data.role === "seller"
            ? "New message from the buyer"
            : "New message from the seller",
      );
    case "report_opened":
      return titled(`${car}: ${n.data.role === "seller" ? "the seller" : "the buyer"} reported a problem`);
    case "report_resolved":
      return withTitle("Biddr has reviewed the problem you reported. See the decision in your messages.");
    case "account_blocked": {
      const reason = str(n.data.reason);
      return titled(
        `${n.data.kind === "selling" ? "You can no longer list cars" : "Your bidding is blocked"}${reason ? `: ${reason}` : "."}`,
      );
    }
    case "selling_unblocked":
      return titled("You can list cars again.");
    case "premium_failed":
      return titled(`${car}: the buyer's premium charge failed${str(n.data.reason) ? ` (${str(n.data.reason)})` : ""}`);
    case "history_report_rejected": {
      const reason = str(n.data.reason);
      return withTitle(
        `Your vehicle history report wasn't accepted${reason ? `: ${reason}` : ""}. Upload another report or correct the description.`,
      );
    }
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
    case "inspection_rejected":
    case "inspection_decision_reminder":
    case "inspection_decision_expired":
    case "history_report_rejected":
    case "withdrawal_approved":
    case "withdrawal_declined":
      return "/account/listings";
    case "listing_submitted":
    case "seller_decided":
    case "make_suggested":
      return a ? `/admin/auctions/${a}` : "/admin";
    case "premium_due":
    case "premium_reminder":
    case "premium_unpaid":
    case "second_chance_offer":
      return "/account/purchases";
    case "buyer_did_not_pay":
      return n.data.role === "admin" ? "/admin/payments?status=unpaid" : "/account/listings";
    case "second_chance_closed":
      return "/account/listings";
    case "bidding_unblocked":
      return "/";
    case "new_message":
    case "report_resolved":
      return str(n.data.conversation_id) ? `/account/messages/${str(n.data.conversation_id)}` : "/account/messages";
    case "report_opened":
      return str(n.data.report_id) ? `/admin/reports/${str(n.data.report_id)}` : "/admin/reports";
    case "account_blocked":
      return "/account/setup";
    case "selling_unblocked":
      return "/sell";
    case "premium_paid":
      return n.data.role === "seller" ? "/account/listings" : "/account/purchases";
    case "premium_failed":
      return "/admin/payments";
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
