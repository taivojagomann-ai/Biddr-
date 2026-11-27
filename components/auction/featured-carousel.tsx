"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RealtimePostgresUpdatePayload } from "@supabase/supabase-js";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useServerNow } from "@/hooks/use-server-clock";
import { FEATURED_AUTOPLAY_MS, compareFeatured, hasPremiumSeat, type FeaturedCard } from "@/lib/featured";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { FeaturedLot } from "./featured-lot";

/**
 * The home page's featured carousel (DECISIONS.md point 9). One slide per featured car,
 * side by side with native scroll snap (swipe on touch, like the gallery), arrows on the
 * edges, left/right keys. Plays every 5 seconds and keeps playing after the user moves it
 * (arrows, swipe); it pauses only while a mouse pointer is over it, while keyboard focus is
 * inside, during a touch, and never plays with prefers-reduced-motion. Realtime bids update the slides; a car that
 * closes leaves at once; re-sorting by bids waits until nobody is interacting, so a slide
 * never jumps away while someone looks at it.
 */
export function FeaturedCarousel({
  initial,
  initialNow,
  userId,
  watchedIds,
}: {
  initial: FeaturedCard[];
  initialNow: number;
  userId: string | null;
  watchedIds: string[];
}) {
  const [items, setItems] = useState(initial);
  const [current, setCurrent] = useState(0);
  const [hovering, setHovering] = useState(false);
  const [focusInside, setFocusInside] = useState(false);
  const [touching, setTouching] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  /** The user moved the carousel (announce slides politely); autoplay keeps it quiet. */
  const [userMoved, setUserMoved] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const currentId = useRef<string | null>(initial[0]?.id ?? null);
  const now = useServerNow(initialNow);
  const watched = useMemo(() => new Set(watchedIds), [watchedIds]);

  useEffect(() => setItems(initial), [initial]);

  // Closed (or closing) cars leave at once; the list keeps its order until re-sorted.
  const visible = useMemo(() => items.filter((a) => a.status === "live" && a.ends_at && Date.parse(a.ends_at) > now), [items, now]);
  const interacting = hovering || focusInside || touching;

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  // Realtime: bids, extensions and closing.
  useEffect(() => {
    const supabase = getBrowserSupabase();
    const channel = supabase
      .channel("featured:auctions")
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "auctions" }, (payload: RealtimePostgresUpdatePayload<FeaturedCard>) => {
        const n = payload.new;
        setItems((list) =>
          list.map((a) =>
            a.id === n.id
              ? {
                  ...a,
                  current_bid: n.current_bid,
                  bid_count: n.bid_count,
                  ends_at: n.ends_at,
                  status: n.status,
                  reserve_met: n.reserve_met,
                  watch_count: n.watch_count,
                  premium_seat_until: n.premium_seat_until ?? a.premium_seat_until,
                }
              : a,
          ),
        );
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, []);

  /** While the carousel scrolls itself to a slide, scroll events mustn't pick the slide. */
  const scrollTarget = useRef<number | null>(null);
  const scrollToIndex = useCallback(
    (i: number, smooth: boolean) => {
      const track = trackRef.current;
      if (!track) return;
      // Already there: no scroll event will come, so nothing to wait for.
      scrollTarget.current = Math.abs(track.scrollLeft - i * track.clientWidth) < 2 ? null : i;
      track.scrollTo({ left: i * track.clientWidth, behavior: smooth && !reducedMotion ? "smooth" : "auto" });
    },
    [reducedMotion],
  );

  // Re-sort by bids only while nobody is interacting; stay on the same car.
  useEffect(() => {
    if (interacting) return;
    const sorted = [...items].sort(compareFeatured);
    if (sorted.every((a, i) => a.id === items[i]?.id)) return;
    setItems(sorted);
  }, [items, interacting]);

  // Keep showing the same car when the list changes (a car left, or the order changed).
  useEffect(() => {
    const at = visible.findIndex((a) => a.id === currentId.current);
    const next = at >= 0 ? at : Math.min(current, Math.max(0, visible.length - 1));
    if (next !== current) {
      setCurrent(next);
      scrollToIndex(next, false);
    }
    currentId.current = visible[next]?.id ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when the visible list changes
  }, [visible.map((a) => a.id).join(",")]);

  const goTo = useCallback(
    (i: number, byUser: boolean) => {
      if (!visible.length) return;
      const n = (i + visible.length) % visible.length;
      setCurrent(n);
      currentId.current = visible[n]!.id;
      if (byUser) setUserMoved(true);
      scrollToIndex(n, true);
    },
    [visible, scrollToIndex],
  );

  // Autoplay. Each move (by itself or by the user) starts the 5 seconds again, so after
  // clicking an arrow it carries on from that car.
  const playing = visible.length > 1 && !reducedMotion && !touching && !hovering && !focusInside;
  // The clock re-renders the carousel every second (and with it goTo), so the timer must
  // depend only on whether it plays and which slide is shown, or it would restart forever.
  const goToRef = useRef(goTo);
  goToRef.current = goTo;
  useEffect(() => {
    if (!playing) return;
    const t = setTimeout(() => {
      setUserMoved(false);
      goToRef.current(current + 1, false);
    }, FEATURED_AUTOPLAY_MS);
    return () => clearTimeout(t);
  }, [playing, current]);

  // Swipes and scrolls (scroll snap) set the current slide.
  const onScroll = () => {
    const track = trackRef.current;
    if (!track || !track.clientWidth) return;
    const i = Math.round(track.scrollLeft / track.clientWidth);
    if (scrollTarget.current !== null) {
      // Our own scroll: done once it arrives; a touch takes over at once.
      if (i === scrollTarget.current && Math.abs(track.scrollLeft - i * track.clientWidth) < 2) scrollTarget.current = null;
      if (!touching) return;
      scrollTarget.current = null;
    }
    if (i !== current && visible[i]) {
      setCurrent(i);
      currentId.current = visible[i]!.id;
      if (touching) setUserMoved(true);
    }
  };

  if (!visible.length) return null;
  const total = visible.length;

  return (
    <section
      aria-roledescription="carousel"
      aria-label="Featured cars"
      data-featured-carousel
      data-current={current + 1}
      className="relative"
      // Only a real mouse pauses it: a tap fires emulated mouse events that never "leave",
      // which used to stop the carousel for good on phones.
      onPointerEnter={(e) => {
        if (e.pointerType === "mouse") setHovering(true);
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setHovering(false);
      }}
      // Only keyboard focus pauses it: a clicked arrow keeps focus, and that used to stop it.
      onFocusCapture={(e) => {
        if ((e.target as Element).matches(":focus-visible")) setFocusInside(true);
      }}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocusInside(false);
      }}
      onTouchStart={() => setTouching(true)}
      onTouchEnd={() => setTouching(false)}
      onTouchCancel={() => setTouching(false)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") {
          e.preventDefault();
          goTo(current - 1, true);
        } else if (e.key === "ArrowRight") {
          e.preventDefault();
          goTo(current + 1, true);
        }
      }}
    >
      <div
        ref={trackRef}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory overflow-x-auto scroll-smooth [scrollbar-width:none] motion-reduce:scroll-auto [&::-webkit-scrollbar]:hidden"
      >
        {visible.map((a, i) => (
          <div
            key={a.id}
            role="group"
            aria-roledescription="slide"
            aria-label={`Slide ${i + 1} of ${total}`}
            data-slide={a.id}
            aria-hidden={i !== current}
            // Off-screen slides can't be tabbed into (only the shown car's links and buttons).
            ref={(el) => {
              if (el) el.toggleAttribute("inert", i !== current);
            }}
            className="w-full shrink-0 snap-start snap-always"
          >
            <FeaturedLot auction={a} initialNow={initialNow} userId={userId} watching={watched.has(a.id)} premium={hasPremiumSeat(a, now)} />
          </div>
        ))}
      </div>

      {total > 1 ? (
        <>
          <button
            type="button"
            aria-label="Previous featured car"
            onClick={() => goTo(current - 1, true)}
            className="absolute left-2 top-[calc((100vw-2rem)*0.3125)] z-20 grid size-11 -translate-y-1/2 md:top-1/2 place-items-center rounded-full border border-field bg-asphalt/85 text-chalk backdrop-blur hover:border-chalk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            <ChevronLeft aria-hidden className="size-5" />
          </button>
          <button
            type="button"
            aria-label="Next featured car"
            onClick={() => goTo(current + 1, true)}
            className="absolute right-2 top-[calc((100vw-2rem)*0.3125)] z-20 grid size-11 -translate-y-1/2 md:top-1/2 place-items-center rounded-full border border-field bg-asphalt/85 text-chalk backdrop-blur hover:border-chalk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-signal"
          >
            <ChevronRight aria-hidden className="size-5" />
          </button>
        </>
      ) : null}

      {/* Announces the slide when the user moves the carousel; quiet while it plays by itself. */}
      <p aria-live={userMoved ? "polite" : "off"} className="sr-only">
        {`Slide ${current + 1} of ${total}: ${visible[current]?.title ?? ""}`}
      </p>
    </section>
  );
}
