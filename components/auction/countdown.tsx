"use client";
import { useCountdown } from "@/hooks/use-server-clock";
import { formatCountdown } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { AuctionStatus } from "@/lib/types";

interface CountdownProps {
  endsAt: string | null;
  startsAt?: string | null;
  status: AuctionStatus;
  initialNow: number;
  className?: string;
}

export function Countdown({ endsAt, startsAt, status, initialNow, className }: CountdownProps) {
  const target = status === "upcoming" ? startsAt ?? null : endsAt;
  const { remaining, isFinalMinutes, isUnderHour, isOver } = useCountdown(target, initialNow);

  if (status === "sold") return <span className={className}>Sold</span>;
  if (status === "reserve_not_met") return <span className={className}>Reserve not met</span>;
  if (status === "ended") return <span className={className}>Ended</span>;
  if (status === "withdrawn") return <span className={className}>Withdrawn</span>;
  if (status === "rejected" || status === "draft") return <span className={className}>Not scheduled</span>;

  // Local clock hit zero but the database hasn't closed it yet (a late bid may have extended it).
  if (status === "live" && isOver) {
    return <span className={cn("text-signal", className)} aria-live="polite">Closing…</span>;
  }

  return (
    <time
      dateTime={target ?? undefined}
      className={cn("tabular", status === "live" && (isFinalMinutes || isUnderHour) && "text-signal", className)}
    >
      {status === "upcoming" && <span className="mr-1 text-mute">Opens in</span>}
      {formatCountdown(remaining)}
    </time>
  );
}
