"use client";
import { useState } from "react";
import { formatEur } from "@/lib/format";
import { useMinuteNow } from "@/hooks/use-minute-now";
import { RelativeTime } from "@/components/relative-time";
import { cn } from "@/lib/utils";
import type { BidHistoryRow } from "@/lib/types";

export function BidHistory({ bids, currentUserId, initialNow }: { bids: BidHistoryRow[]; currentUserId: string | null; initialNow: number }) {
  const [expanded, setExpanded] = useState(false);
  const now = useMinuteNow(initialNow);
  const shown = expanded ? bids : bids.slice(0, 8);

  return (
    <section aria-labelledby="history-heading" className="rounded-xl border border-line bg-panel">
      <h2 id="history-heading" className="border-b border-line px-4 py-3 font-bold">Bid history</h2>
      {bids.length === 0 ? (
        <p className="p-4 text-sm text-mute">No bids yet. The first bid starts at the opening price.</p>
      ) : (
        <ol className="divide-y divide-line">
          {shown.map((b, i) => (
            <li key={b.id} className={cn("flex items-center justify-between gap-3 px-4 py-2.5 text-sm", i === 0 && "bg-signal/5")}>
              <span className="min-w-0 truncate">
                <span className={cn("font-semibold", i === 0 && "text-signal")}>
                  {b.bidder_id === currentUserId ? "You" : b.username ?? "Bidder"}
                </span>
                {b.country && <span className="ml-1.5 text-mute">{b.country}</span>}
              </span>
              <span className="flex shrink-0 items-baseline gap-3">
                <RelativeTime iso={b.created_at} now={now} className="text-xs text-mute" />
                <span className="font-bold tabular">{formatEur(b.amount)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
      {bids.length > 8 && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="w-full border-t border-line px-4 py-2.5 text-sm text-mute hover:text-chalk">
          {expanded ? "Show fewer" : `Show all ${bids.length} bids`}
        </button>
      )}
    </section>
  );
}
