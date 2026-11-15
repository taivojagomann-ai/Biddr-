"use client";
import { useTimeZone } from "@/hooks/use-time-zone";
import { formatDate, formatDateTime } from "@/lib/zoned-time";

/**
 * An absolute date and time in the viewer's own time zone with its abbreviation,
 * e.g. "Fri, 13 Nov 2026, 20:00 CET" (`dateOnly`: "13 November 2026").
 * Server-rendered pages use this so the time isn't fixed to the server's zone.
 */
export function LocalDateTime({ iso, dateOnly = false, className }: { iso: string | null | undefined; dateOnly?: boolean; className?: string }) {
  const tz = useTimeZone();
  if (!iso) return <span className={className}>Not set</span>;
  return (
    <time dateTime={iso} className={className}>
      {dateOnly ? formatDate(iso, tz) : formatDateTime(iso, tz)}
    </time>
  );
}
