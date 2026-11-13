"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { RealtimePostgresInsertPayload, RealtimePostgresUpdatePayload } from "@supabase/supabase-js";
import { BidBox, type BidUiState } from "./bid-box";
import { BidHistory } from "./bid-history";
import { BidModal } from "./bid-modal";
import { Comments } from "./comments";
import { StickyBidBar } from "./sticky-bid-bar";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { formatEur } from "@/lib/format";
import { minNextBid } from "@/lib/pricing";
import { COMMENT_COLUMNS, type Auction, type BidHistoryRow, type CommentRow, type PlaceBidResult } from "@/lib/types";

interface AuctionLiveProps {
  initialAuction: Auction;
  initialBids: BidHistoryRow[];
  initialComments: CommentRow[];
  userId: string | null;
  initialHasHold: boolean;
  initialNow: number;
  holdEur: number;
  /** Server-rendered, non-interactive sections (gallery, specs, video) */
  children: React.ReactNode;
}

/**
 * Owns all live state on the auction page. One Realtime channel per page:
 * - auctions UPDATE (filtered to this id): price, count, end time, status
 * - comments INSERT (filtered to this auction)
 * On every (re)subscribe we refetch, so updates missed while offline aren't lost.
 */
export function AuctionLive({
  initialAuction, initialBids, initialComments, userId, initialHasHold, initialNow, holdEur, children,
}: AuctionLiveProps) {
  const supabase = getBrowserSupabase();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [auction, setAuction] = useState(initialAuction);
  const [bids, setBids] = useState(initialBids);
  const [comments, setComments] = useState(initialComments);
  const [hasHold, setHasHold] = useState(initialHasHold);
  const [amount, setAmount] = useState(() => minNextBid(initialAuction));
  const [modalOpen, setModalOpen] = useState(false);
  const [flash, setFlash] = useState(false);
  const [justExtended, setJustExtended] = useState(false);
  const [wasOutbid, setWasOutbid] = useState(false);
  // One polite live region for the whole page, so each change is announced once,
  // on phones (no sidebar) as well as desktop.
  const [announcement, setAnnouncement] = useState("");

  const prev = useRef(initialAuction);

  const refreshBids = useCallback(async () => {
    const { data } = await supabase.rpc("get_bid_history", { p_auction_id: initialAuction.id, p_limit: 100 }).returns<BidHistoryRow[]>();
    if (data) setBids(data);
  }, [supabase, initialAuction.id]);

  const applyAuction = useCallback((next: Auction) => {
    const before = prev.current;
    const messages: string[] = [];
    if (next.bid_count > before.bid_count && next.current_bid) {
      messages.push(next.leading_bidder_id === userId ? `Your bid of ${formatEur(next.current_bid)} is the high bid.` : `New bid: ${formatEur(next.current_bid)}.`);
    }
    if (next.bid_count > before.bid_count) {
      setFlash(true);
      setTimeout(() => setFlash(false), 700);
      void refreshBids();
      // Keep the input at or above the new minimum unless the user already typed more.
      setAmount((a) => Math.max(a, minNextBid(next)));
    }
    if (before.ends_at && next.ends_at && new Date(next.ends_at) > new Date(before.ends_at) && before.status === "live") {
      setJustExtended(true);
      setTimeout(() => setJustExtended(false), 8000);
      messages.push("A late bid added 2 minutes to the clock.");
    }
    if (userId && before.leading_bidder_id === userId && next.leading_bidder_id !== userId) {
      setWasOutbid(true);
      messages.unshift("You've been outbid.");
    }
    if (before.status !== next.status && next.status !== "live") {
      messages.push(next.status === "sold" ? "The auction has ended. The car is sold." : "The auction has ended.");
    }
    if (messages.length) setAnnouncement(messages.join(" "));
    prev.current = next;
    setAuction(next);
  }, [refreshBids, userId]);

  const refetchAll = useCallback(async () => {
    const { data } = await supabase.from("auctions").select("*").eq("id", initialAuction.id).single<Auction>();
    if (data) applyAuction(data);
    void refreshBids();
  }, [supabase, initialAuction.id, applyAuction, refreshBids]);

  useEffect(() => {
    const channel = supabase
      .channel(`auction:${initialAuction.id}`)
      .on("postgres_changes",
        { event: "UPDATE", schema: "public", table: "auctions", filter: `id=eq.${initialAuction.id}` },
        (payload: RealtimePostgresUpdatePayload<Auction>) => applyAuction(payload.new))
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "comments", filter: `auction_id=eq.${initialAuction.id}` },
        async (payload: RealtimePostgresInsertPayload<{ id: string }>) => {
          // The payload has no author; fetch the row with its profile join.
          const { data } = await supabase.from("comments").select(COMMENT_COLUMNS).eq("id", payload.new.id).single<CommentRow>();
          if (data) setComments((list) => (list.some((c) => c.id === data.id) ? list : [...list, data]));
        })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void refetchAll();
      });

    return () => { void supabase.removeChannel(channel); };
  }, [supabase, initialAuction.id, applyAuction, refetchAll]);

  // Returning from a 3-D Secure redirect: record the hold, then reopen the modal.
  useEffect(() => {
    const piId = searchParams.get("payment_intent");
    if (searchParams.get("hold") !== "return" || !piId) return;
    void (async () => {
      const res = await fetch("/api/stripe/hold/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentIntentId: piId }),
      });
      router.replace(`/auctions/${initialAuction.id}`, { scroll: false });
      if (res.ok) {
        setHasHold(true);
        setModalOpen(true);
      }
    })();
  }, [searchParams, router, initialAuction.id]);

  const onBidPlaced = useCallback((r: PlaceBidResult) => {
    setWasOutbid(false);
    // Optimistic merge; the Realtime UPDATE will confirm the same values.
    applyAuction({ ...prev.current, current_bid: r.current_bid, bid_count: r.bid_count, ends_at: r.ends_at, leading_bidder_id: userId });
    setAmount(r.min_next);
  }, [applyAuction, userId]);

  const isLeading = Boolean(userId && auction.leading_bidder_id === userId);

  const ui: BidUiState = {
    auction, amount, setAmount, onPlaceBid: () => setModalOpen(true),
    isLeading, wasOutbid, justExtended, flash, initialNow, holdEur,
  };

  return (
    <>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-10">
          {children}
          <div className="lg:hidden"><BidHistory bids={bids} currentUserId={userId} initialNow={initialNow} /></div>
          <Comments auctionId={auction.id} sellerId={auction.seller_id} comments={comments} currentUserId={userId}
            initialNow={initialNow}
            onPosted={(c) => setComments((list) => (list.some((x) => x.id === c.id) ? list : [...list, c]))} />
        </div>

        <aside className="hidden lg:block">
          <div className="sticky top-20 flex flex-col gap-4">
            <BidBox {...ui} />
            <BidHistory bids={bids} currentUserId={userId} initialNow={initialNow} />
          </div>
        </aside>
      </div>

      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <StickyBidBar {...ui} />

      <BidModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        auction={auction}
        amount={amount}
        setAmount={setAmount}
        userId={userId}
        hasHold={hasHold}
        onHoldAuthorized={() => setHasHold(true)}
        onBidPlaced={onBidPlaced}
        holdEur={holdEur}
      />
    </>
  );
}
