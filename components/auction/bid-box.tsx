"use client";
import { Gavel, Info, TimerReset } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Countdown } from "./countdown";
import { ReserveBadge } from "./badges";
import { formatEur } from "@/lib/format";
import { buyersPremium, minNextBid, QUICK_INCREMENTS } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import type { Auction } from "@/lib/types";

export interface BidUiState {
  auction: Auction;
  amount: number;
  setAmount: (n: number) => void;
  onPlaceBid: () => void;
  isLeading: boolean;
  wasOutbid: boolean;
  justExtended: boolean;
  flash: boolean;
  initialNow: number;
  holdEur: number;
}

export function BidBox({ auction, amount, setAmount, onPlaceBid, isLeading, wasOutbid, justExtended, flash, initialNow, holdEur }: BidUiState) {
  const live = auction.status === "live";
  const minNext = minNextBid(auction);
  const tooLow = amount < minNext;

  return (
    <section aria-labelledby="bid-heading" className="rounded-xl border border-line bg-panel">
      <h2 id="bid-heading" className="sr-only">Bidding</h2>

      <div className="grid grid-cols-2 border-b border-line">
        <div className={cn("p-4", flash && "animate-bid-flash")}>
          <p className="text-xs text-mute">{auction.current_bid ? "Current bid" : "Starting bid"}</p>
          <p className="font-wide text-2xl font-black tabular" aria-live="polite">
            {formatEur(auction.current_bid ?? auction.starting_bid)}
          </p>
          <p className="text-xs text-mute">{auction.bid_count} {auction.bid_count === 1 ? "bid" : "bids"}</p>
        </div>
        <div className="border-l border-line p-4">
          <p className="text-xs text-mute">{auction.status === "upcoming" ? "Opens" : "Time left"}</p>
          <Countdown endsAt={auction.ends_at} startsAt={auction.starts_at} status={auction.status}
            initialNow={initialNow} className="font-wide text-2xl font-black" />
          <ReserveBadge hasReserve={auction.has_reserve} reserveMet={auction.reserve_met} className="mt-1 inline-block" />
        </div>
      </div>

      <div className="flex flex-col gap-3 p-4" aria-live="polite">
        {justExtended && (
          <p className="flex items-center gap-2 rounded-md bg-signal/10 px-3 py-2 text-sm text-signal">
            <TimerReset className="size-4" aria-hidden /> A late bid added 2 minutes to the clock.
          </p>
        )}
        {isLeading && live && (
          <p className="rounded-md bg-verified/10 px-3 py-2 text-sm font-semibold text-verified">You have the high bid.</p>
        )}
        {wasOutbid && !isLeading && live && (
          <p className="rounded-md bg-signal/10 px-3 py-2 text-sm font-semibold text-signal">You&apos;ve been outbid.</p>
        )}
      </div>

      {live ? (
        <div className="flex flex-col gap-3 px-4 pb-4">
          <div className="grid grid-cols-3 gap-2">
            {QUICK_INCREMENTS.map((inc) => {
              const target = Math.max(minNext, (auction.current_bid ?? auction.starting_bid) + inc);
              return (
                <Button key={inc} type="button" variant="outline" size="sm" onClick={() => setAmount(target)}
                  aria-label={`Set bid to ${formatEur(target)}`}>
                  +{formatEur(inc)}
                </Button>
              );
            })}
          </div>

          <label htmlFor="bid-amount" className="text-sm text-mute">Your bid (minimum {formatEur(minNext)})</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-mute">€</span>
            <Input id="bid-amount" inputMode="numeric" pattern="[0-9]*" className="h-12 pl-7 font-wide text-lg font-bold tabular"
              value={amount ? String(amount) : ""}
              onChange={(e) => setAmount(Number(e.target.value.replace(/\D/g, "")) || 0)}
              aria-invalid={tooLow} aria-describedby="bid-premium" />
          </div>

          <p id="bid-premium" className="text-xs text-mute">
            {tooLow
              ? `Enter at least ${formatEur(minNext)}.`
              : `If you win, you pay ${formatEur(amount + buyersPremium(amount))}, including the ${formatEur(buyersPremium(amount))} buyer's premium.`}
          </p>

          <Button size="lg" onClick={onPlaceBid} disabled={tooLow || isLeading}>
            <Gavel aria-hidden />
            {isLeading ? "You're leading" : `Bid ${formatEur(amount || minNext)}`}
          </Button>

          <p className="flex gap-2 text-xs text-mute">
            <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Before your first bid we place a refundable {formatEur(holdEur)} hold on your card. It is released when the auction ends unless you win.
          </p>
        </div>
      ) : (
        <p className="px-4 pb-4 text-sm text-mute">
          {auction.status === "upcoming"
            ? "Bidding opens when the timer runs out. Ask the seller questions below in the meantime."
            : auction.status === "withdrawn"
              ? "This auction was withdrawn. No one won the car, and all bids were cancelled."
              : "This auction has closed."}
        </p>
      )}
    </section>
  );
}
