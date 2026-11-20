import { unansweredLabel } from "@/lib/unanswered-questions";

/** "1 unread conversation" / "3 unread conversations". */
export function unreadLabel(n: number): string {
  return `${n} unread conversation${n === 1 ? "" : "s"}`;
}

/**
 * A count after a menu item: unanswered questions after "My listings", unread
 * conversations after "Messages". The number is visible; the words are for screen
 * readers, so the link's name starts with what is seen (WCAG 2.5.3):
 * "My listings 2 unanswered questions", "Messages 1 unread conversation".
 */
export function MenuCount({ count, kind = "unanswered" }: { count: number; kind?: "unanswered" | "unread" }) {
  const words = (kind === "unread" ? unreadLabel(count) : unansweredLabel(count)).replace(/^\d+ /, "");
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-signal px-1.5 text-xs font-bold leading-none text-asphalt">
      {count}
      <span className="sr-only"> {words}</span>
    </span>
  );
}
