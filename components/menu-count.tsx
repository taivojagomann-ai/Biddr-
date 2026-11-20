import { unansweredLabel } from "@/lib/unanswered-questions";

/**
 * The unanswered-question count after "My listings". The number is visible; the words
 * are for screen readers, so the link's name starts with what is seen (WCAG 2.5.3):
 * "My listings 2 unanswered questions".
 */
export function MenuCount({ count }: { count: number }) {
  const words = unansweredLabel(count).replace(/^\d+ /, "");
  return (
    <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-signal px-1.5 text-xs font-bold leading-none text-asphalt">
      {count}
      <span className="sr-only"> {words}</span>
    </span>
  );
}
