"use client";
import { useSyncExternalStore } from "react";
import { formatExactTime, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

const noopSubscribe = () => () => undefined;

/** false during server rendering and hydration, true afterwards. */
function useIsHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

/**
 * "5m ago" with the exact time on hover. Dates older than a week depend on the
 * time zone, so the server and the hydration render use UTC (identical on both
 * sides); right after hydration it switches to the user's own time zone.
 */
export function RelativeTime({ iso, now, className }: { iso: string; now: number; className?: string }) {
  const hydrated = useIsHydrated();
  const timeZone = hydrated ? undefined : "UTC";
  return (
    <time
      dateTime={iso}
      title={hydrated ? formatExactTime(iso) : `${formatExactTime(iso, "UTC")} UTC`}
      className={cn("tabular", className)}
    >
      {timeAgo(iso, now, timeZone)}
    </time>
  );
}
