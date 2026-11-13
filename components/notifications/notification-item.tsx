"use client";
import { useRouter } from "next/navigation";
import {
  CheckCircle2,
  Gavel,
  MessageCircleQuestion,
  MessageSquareReply,
  PlayCircle,
  Send,
  Timer,
  Trophy,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { RelativeTime } from "@/components/relative-time";
import { notificationCopy, notificationHref } from "@/lib/notifications";
import { getBrowserSupabase } from "@/lib/supabase/client";
import type { NotificationRow, NotificationType } from "@/lib/types";
import { cn } from "@/lib/utils";

const ICONS: Record<NotificationType, LucideIcon> = {
  question: MessageCircleQuestion,
  answer: MessageSquareReply,
  outbid: Gavel,
  listing_approved: CheckCircle2,
  listing_rejected: XCircle,
  auction_live: PlayCircle,
  auction_ended: Timer,
  auction_won: Trophy,
  listing_submitted: Send,
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
  const { text, title } = notificationCopy(n);
  const href = notificationHref(n);
  const Icon = ICONS[n.type];
  const unread = !n.read_at;

  async function open(e: React.MouseEvent<HTMLAnchorElement>) {
    // Let new-tab clicks through; still mark the item read.
    const newTab = e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1;
    if (unread) {
      onRead(n.id);
      const marking = markNotificationsRead([n.id]);
      if (!newTab) await marking;
    }
    if (newTab) return;
    e.preventDefault();
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
