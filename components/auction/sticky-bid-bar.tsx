"use client";
import { Button } from "@/components/ui/button";
import { Countdown } from "./countdown";
import { formatEur } from "@/lib/format";
import { minNextBid } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import type { BidUiState } from "./bid-box";

/** Below the lg breakpoint (no sidebar), this bar pinned to the bottom of the viewport on the auction page. */
export function StickyBidBar({ auction, onPlaceBid, isLeading, flash, initialNow, setAmount }: BidUiState) {
  const live = auction.status === "live";
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel/95 pb-safe pt-3 backdrop-blur lg:hidden">
      <div className="container flex items-center gap-3">
        <div className={cn("min-w-0 flex-1 rounded-md", flash && "animate-bid-flash")}>
          <p className="text-[11px] text-mute">{isLeading ? "Your high bid" : auction.current_bid ? "Current bid" : "Starting bid"}</p>
          <p className="font-wide text-lg font-black leading-tight tabular">{formatEur(auction.current_bid ?? auction.starting_bid)}</p>
        </div>
        <div className="text-right">
          <p className="text-[11px] text-mute">{auction.status === "upcoming" ? "Opens in" : "Ends in"}</p>
          <Countdown endsAt={auction.ends_at} startsAt={auction.starts_at} status={auction.status}
            initialNow={initialNow} className="font-wide text-lg font-black leading-tight" />
        </div>
        <Button size="lg" className="shrink-0" disabled={!live || isLeading}
          onClick={() => { setAmount(minNextBid(auction)); onPlaceBid(); }}>
          {isLeading ? "Leading" : "Place bid"}
        </Button>
      </div>
    </div>
  );
}
