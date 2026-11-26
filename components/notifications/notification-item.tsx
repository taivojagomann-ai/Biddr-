"use client";
import { useRouter } from "next/navigation";
import {
  AlarmClock,
  CircleCheck,
  CircleSlash,
  CreditCard,
  Eye,
  FileWarning,
  FileX,
  Gavel,
  MessageCircleQuestion,
  MessageSquareReply,
  PlayCircle,
  Send,
  Timer,
  TriangleAlert,
  Trophy,
  CircleX,
  type LucideIcon,
  Tag, CalendarCheck, ShieldCheck, Receipt } from "lucide-react";
import { RelativeTime } from "@/components/relative-time";
import { useTimeZone } from "@/hooks/use-time-zone";
import { notificationCopy, notificationHref } from "@/lib/notifications";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { NotificationRow, NotificationType } from "@/lib/types";
import { cn } from "@/lib/utils";

const ICONS: Record<NotificationType, LucideIcon> = {
  question: MessageCircleQuestion,
  answer: MessageSquareReply,
  outbid: Gavel,
  listing_approved: CircleCheck,
  listing_rejected: CircleX,
  auction_live: PlayCircle,
  auction_ended: Timer,
  auction_won: Trophy,
  listing_submitted: Send,
  watch_ending_soon: AlarmClock,
  watch_live: Eye,
  inspection_rejected: FileX,
  withdrawal_approved: CircleSlash,
  withdrawal_declined: CircleX,
  seller_decided: Send,
  inspection_decision_reminder: AlarmClock,
  inspection_decision_expired: CircleSlash,
  history_report_rejected: FileWarning,
  premium_due: CreditCard,
  premium_paid: CircleCheck,
  premium_failed: CreditCard,
  make_suggested: Tag,
  premium_reminder: AlarmClock,
  premium_unpaid: CircleSlash,
  buyer_did_not_pay: CircleSlash,
  second_chance_offer: Trophy,
  second_chance_closed: CircleX,
  bidding_unblocked: CircleCheck,
  new_message: MessageSquareReply,
  report_opened: FileWarning,
  report_resolved: CircleCheck,
  account_blocked: CircleSlash,
  selling_unblocked: CircleCheck,
  viewing_update: CalendarCheck,
  conversation_reported: FileWarning,
  messaging_unblocked: CircleCheck,
  identity_required: TriangleAlert,
  identity_verified: ShieldCheck,
  listing_on_hold: TriangleAlert,
  listing_needs_check: TriangleAlert,
  listing_edited: TriangleAlert,
  receipt_ready: Receipt,
};

/** Sets read_at on the user's own rows (the only column they may update). */
export async function markNotificationsRead(ids: string[]): Promise<boolean> {
  if (!ids.length) return true;
  const { error } = await getBrowserSupabase()
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .in("id", ids)
    .is("read_at", null);
  return !error;
}

/**
 * One notification as a link. Clicking marks it read, then navigates. A link to a
 * comment on the current page just changes the hash, so the comment gets focus.
 */
export function NotificationItem({
  n,
  now,
  onRead,
  onNavigate,
}: {
  n: NotificationRow;
  now: number;
  onRead: (id: string) => void;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const tz = useTimeZone();
  const { text, title } = notificationCopy(n, tz);
  const href = notificationHref(n);
  const Icon = ICONS[n.type];
  const unread = !n.read_at;

  async function open(e: React.MouseEvent<HTMLAnchorElement>) {
    // Let new-tab clicks through; still mark the item read.
    const newTab = e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1;
    // Stop the browser's own navigation before anything is awaited: after an await
    // preventDefault comes too late, the page starts unloading, and Safari cancels the
    // request that marks the item read (Chrome happens to let it finish).
    if (!newTab) e.preventDefault();
    if (unread) {
      onRead(n.id);
      const marking = markNotificationsRead([n.id]);
      if (!newTab) await marking;
    }
    if (newTab) return;
    onNavigate?.();
    const url = new URL(href, window.location.origin);
    if (url.pathname === window.location.pathname && url.hash) {
      window.location.hash = url.hash; // fires hashchange; the comment list focuses it
    } else {
      router.push(href);
    }
  }

  return (
    <a
      href={href}
      onClick={(e) => void open(e)}
      className={cn(
        "flex min-h-11 gap-3 rounded-md px-3 py-2.5 hover:bg-asphalt/60",
        unread && "bg-signal/5",
      )}
    >
      <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", unread ? "text-signal" : "text-mute")} />
      <span className="min-w-0 flex-1">
        <span className="flex items-start gap-2">
          <span className={cn("min-w-0 flex-1 text-sm", unread ? "font-semibold text-chalk" : "text-mute")}>{text}</span>
          {unread ? (
            <span className="shrink-0 rounded-sm bg-signal px-1.5 py-0.5 text-[11px] font-bold leading-none text-asphalt">New</span>
          ) : null}
        </span>
        {title ? <span className="mt-0.5 block truncate text-xs text-mute">{title}</span> : null}
        <RelativeTime iso={n.created_at} now={now} className="mt-0.5 block text-xs text-mute" />
      </span>
    </a>
  );
}
