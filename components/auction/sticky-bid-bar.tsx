"use client";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/info-tip";
import { HELP } from "@/lib/help";
import { Countdown } from "./countdown";
import { formatEur } from "@/lib/format";
import { minNextBid } from "@/lib/pricing";
import { PREVIEW_TEXT } from "@/lib/listing-preview";
import { cn } from "@/lib/utils";
import type { BidUiState } from "./bid-box";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { contactLabel } from "./contact-seller";

/** Below the lg breakpoint (no sidebar), this bar pinned to the bottom of the viewport on the auction page. */
export function StickyBidBar({ auction, onPlaceBid, isLeading, wasOutbid, flash, initialNow, setAmount, preview = false, contact = null }: BidUiState) {
  const live = auction.status === "live" && !auction.is_demo && !preview;
  // Only while the auction is upcoming or live (the status updates live on this page).
  const showContact = Boolean(contact) && (auction.status === "upcoming" || auction.status === "live");
  return (
    <div data-sticky-bottom="bid" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-panel/95 pb-safe pt-3 backdrop-blur lg:hidden">
      <div className="container flex items-center gap-3">
        <div className={cn("min-w-0 flex-1 rounded-md", flash && "animate-bid-flash")}>
          <p className={cn("text-xs", wasOutbid && !isLeading && live ? "font-semibold text-signal" : "text-mute")}>
            {isLeading ? "Your high bid" : wasOutbid && live ? "You've been outbid" : auction.current_bid ? "Current bid" : "Starting bid"}
          </p>
          <p className="font-wide text-lg font-black leading-tight tabular">{formatEur(auction.current_bid ?? auction.starting_bid)}</p>
        </div>
        {preview ? (
          <p id="sticky-bid-preview-note" className="max-w-[9rem] text-right text-xs font-semibold leading-snug">
            {PREVIEW_TEXT.bidding}.
          </p>
        ) : (
          <div className="text-right">
            <p className="flex items-center justify-end gap-1 text-xs text-mute">
              {auction.status === "upcoming" ? "Opens in" : "Ends in"}
              {live || auction.status === "upcoming" ? (
                <InfoTip topic={HELP.extension} className="[@media(pointer:coarse)]:-mx-2.5" />
              ) : null}
            </p>
            <Countdown endsAt={auction.ends_at} startsAt={auction.starts_at} status={auction.status}
              initialNow={initialNow} className="font-wide text-lg font-black leading-tight" />
          </div>
        )}
        {showContact && contact ? (
          <Button asChild size="icon" variant="outline" className="size-12 shrink-0">
            <Link href={contact.href} aria-label={contactLabel(contact)}>
              <MessageCircle aria-hidden className="!size-5" />
            </Link>
          </Button>
        ) : null}
        <Button size="lg" className="shrink-0" disabled={!live || isLeading}
          aria-describedby={preview ? "sticky-bid-preview-note" : undefined}
          onClick={() => { setAmount(minNextBid(auction)); onPlaceBid(); }}>
          {auction.is_demo ? "Demo only" : isLeading ? "Leading" : "Place bid"}
        </Button>
      </div>
    </div>
  );
}
