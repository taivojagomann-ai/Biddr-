"use client";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type ViewerPhoto = {
  src: string;
  /** Section name, e.g. "Exterior". */
  section: string;
  /** 1-based number within the section, and the section's photo count. */
  n: number;
  total: number;
  alt: string;
};

type View = { s: number; x: number; y: number };
const FIT: View = { s: 1, x: 0, y: 0 };
const SWIPE_PX = 60;
const CLOSE_PX = 100;
const DOUBLE_TAP_MS = 300;

/**
 * The large photo viewer: a full-screen dialog over the auction page.
 * - Every gesture has a button or key: swipe = Previous/Next buttons and ←/→;
 *   pinch and wheel = Zoom in/out buttons and +/−; swipe down = Close and Escape;
 *   panning a zoomed photo = moving the mouse, ←↑→↓, or zooming in at a chosen point
 *   (click or double-tap there), which needs no dragging.
 * - Opening, closing, the address hash and returning focus are handled by the gallery.
 */
export function PhotoViewer({
  photos,
  index,
  carTitle,
  onIndexChange,
  onClose,
  onCloseAutoFocus,
}: {
  photos: ViewerPhoto[];
  index: number;
  carTitle: string;
  onIndexChange: (i: number) => void;
  onClose: () => void;
  onCloseAutoFocus: () => void;
}) {
  const photo = photos[index]!;
  const stageRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const thumbsRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(FIT);
  const viewRef = useRef(view);
  viewRef.current = view;
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  const [gesturing, setGesturing] = useState(false);
  const [swipe, setSwipe] = useState({ dx: 0, dy: 0 });
  const [announce, setAnnounce] = useState("");

  const zoomed = view.s > 1.01;

  // The photo's size on screen at "fit" (as large as possible without cropping).
  const fit = natural && stage.w && stage.h ? Math.min(stage.w / natural.w, stage.h / natural.h) : 1;
  const contentW = natural ? natural.w * fit : stage.w;
  const contentH = natural ? natural.h * fit : stage.h;
  /** Zoom factor that shows the photo at 100% of its real size (at least 2× for small photos). */
  const realSize = natural ? Math.max(1 / fit, 2) : 2;
  const maxScale = Math.max(realSize * 2, 4);

  const clamp = useCallback(
    (v: View): View => {
      const s = Math.min(Math.max(v.s, 1), maxScale);
      const mx = Math.max(0, (contentW * s - stage.w) / 2);
      const my = Math.max(0, (contentH * s - stage.h) / 2);
      return { s, x: Math.min(mx, Math.max(-mx, v.x)), y: Math.min(my, Math.max(-my, v.y)) };
    },
    [contentW, contentH, stage.w, stage.h, maxScale],
  );

  /** Zooms to scale s keeping the point p (relative to the stage centre) still. */
  const zoomAt = useCallback(
    (s: number, p = { x: 0, y: 0 }, from = viewRef.current) => {
      const ratio = Math.min(Math.max(s, 1), maxScale) / from.s;
      setView(clamp({ s: from.s * ratio, x: p.x - (p.x - from.x) * ratio, y: p.y - (p.y - from.y) * ratio }));
    },
    [clamp, maxScale],
  );

  const go = useCallback(
    (d: number) => onIndexChange((index + d + photos.length) % photos.length),
    [index, onIndexChange, photos.length],
  );

  // A new photo starts at fit; its size is read once it loads.
  useLayoutEffect(() => {
    setView(FIT);
    setNatural(null);
    setSwipe({ dx: 0, dy: 0 });
  }, [index]);

  // Announce the photo once navigation settles (not on every step of fast key repeats).
  useEffect(() => {
    const t = setTimeout(() => setAnnounce(`${photo.section}, photo ${photo.n} of ${photo.total}`), 400);
    return () => clearTimeout(t);
  }, [photo.section, photo.n, photo.total]);

  // Load the neighbours ahead of time.
  useEffect(() => {
    for (const d of [1, -1]) {
      const p = photos[(index + d + photos.length) % photos.length];
      if (p) new window.Image().src = p.src;
    }
  }, [index, photos]);

  // Keep the active thumbnail in view.
  useEffect(() => {
    const strip = thumbsRef.current;
    const thumb = strip?.querySelector<HTMLElement>(`[data-thumb="${index}"]`);
    if (strip && thumb) strip.scrollLeft = thumb.offsetLeft - (strip.clientWidth - thumb.offsetWidth) / 2;
  }, [index]);

  // Stage size, kept up to date on rotate and resize.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const point = (e: { clientX: number; clientY: number }) => {
    const r = stageRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
  };

  // Mouse wheel and trackpad pinch (a wheel event with ctrlKey) zoom at the pointer.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0025));
      zoomAt(viewRef.current.s * factor, point(e));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  // Touch, pen and mouse: swipe, pinch, double-tap, drag to pan.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ start: { x: number; y: number }; from: View; moved: number; type: string; pinched: boolean } | null>(null);
  const pinch = useRef<{ dist: number; mid: { x: number; y: number }; from: View } | null>(null);
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);

  const pinchState = () => {
    const [a, b] = [...pointers.current.values()];
    return { dist: Math.hypot(a!.x - b!.x, a!.y - b!.y), mid: { x: (a!.x + b!.x) / 2, y: (a!.y + b!.y) / 2 } };
  };

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // The Previous/Next buttons sit on the stage: their presses are clicks, not gestures.
    if ((e.target as HTMLElement).closest("button")) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, point(e));
    setGesturing(true);
    if (pointers.current.size === 2) {
      pinch.current = { ...pinchState(), from: viewRef.current };
      if (drag.current) drag.current.pinched = true;
      setSwipe({ dx: 0, dy: 0 });
    } else if (pointers.current.size === 1) {
      drag.current = { start: point(e), from: viewRef.current, moved: 0, type: e.pointerType, pinched: false };
    }
  }

  function onPointerMove(e: React.PointerEvent) {
    const p = point(e);
    // A zoomed photo follows the mouse, no button needed: the edge under the pointer comes into view.
    if (e.pointerType === "mouse" && !pointers.current.has(e.pointerId)) {
      if (viewRef.current.s > 1.01 && stage.w && stage.h) {
        const v = viewRef.current;
        const mx = Math.max(0, (contentW * v.s - stage.w) / 2);
        const my = Math.max(0, (contentH * v.s - stage.h) / 2);
        setView({ s: v.s, x: (-p.x / (stage.w / 2)) * mx, y: (-p.y / (stage.h / 2)) * my });
      }
      return;
    }
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, p);
    if (pinch.current && pointers.current.size >= 2) {
      const now = pinchState();
      const from = pinch.current.from;
      const s = from.s * (now.dist / pinch.current.dist);
      const ratio = Math.min(Math.max(s, 1), maxScale) / from.s;
      const m0 = pinch.current.mid;
      setView(clamp({ s: from.s * ratio, x: now.mid.x - (m0.x - from.x) * ratio, y: now.mid.y - (m0.y - from.y) * ratio }));
      return;
    }
    const d = drag.current;
    if (!d) return;
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;
    d.moved = Math.max(d.moved, Math.hypot(dx, dy));
    if (d.from.s > 1.01) {
      if (d.type !== "mouse") setView(clamp({ ...d.from, x: d.from.x + dx, y: d.from.y + dy }));
    } else if (!d.pinched && d.type !== "mouse") {
      // Not zoomed: the photo follows the finger (sideways to change photo, down to close).
      setSwipe(Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy: Math.max(0, dy) });
    }
  }

  function onPointerUp(e: React.PointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    const p = point(e);
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 1 && pinch.current) {
      // One finger lifted from a pinch: the other one carries on panning.
      pinch.current = null;
      const [rest] = [...pointers.current.values()];
      if (drag.current) drag.current = { ...drag.current, start: rest!, from: viewRef.current };
      return;
    }
    if (pointers.current.size > 0) return;
    pinch.current = null;
    setGesturing(false);
    const d = drag.current;
    drag.current = null;
    setSwipe({ dx: 0, dy: 0 });
    if (!d) return;
    if (viewRef.current.s < 1.02 && viewRef.current.s !== 1) setView(FIT);
    if (d.pinched) return;
    const dx = p.x - d.start.x;
    const dy = p.y - d.start.y;

    if (d.from.s <= 1.01 && d.type !== "mouse") {
      if (Math.abs(dx) > SWIPE_PX && Math.abs(dx) > Math.abs(dy)) return go(dx < 0 ? 1 : -1);
      if (dy > CLOSE_PX && dy > Math.abs(dx)) return onClose();
    }
    if (d.moved > 10) return;

    // A click (mouse) or double-tap (touch, pen) zooms in at that point, or back out.
    if (d.type === "mouse") {
      if (viewRef.current.s > 1.01) setView(FIT);
      else zoomAt(realSize, p, FIT);
      return;
    }
    const now = performance.now();
    const t = lastTap.current;
    if (t && now - t.t < DOUBLE_TAP_MS && Math.hypot(p.x - t.x, p.y - t.y) < 30) {
      lastTap.current = null;
      if (viewRef.current.s > 1.01) setView(FIT);
      else zoomAt(realSize, p, FIT);
    } else {
      lastTap.current = { t: now, ...p };
    }
  }

  function onPointerCancel(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size === 0) {
      pinch.current = null;
      drag.current = null;
      setGesturing(false);
      setSwipe({ dx: 0, dy: 0 });
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const step = 80;
    const v = viewRef.current;
    if (e.key === "+" || e.key === "=") zoomAt(v.s * 1.5);
    else if (e.key === "-" || e.key === "_") zoomAt(v.s / 1.5);
    else if (e.key === "0") setView(FIT);
    // Zoomed: the arrow keys move around the photo. Otherwise ←/→ change the photo.
    else if (v.s > 1.01 && e.key.startsWith("Arrow")) {
      const dx = e.key === "ArrowLeft" ? step : e.key === "ArrowRight" ? -step : 0;
      const dy = e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
      setView(clamp({ ...v, x: v.x + dx, y: v.y + dy }));
    } else if (e.key === "ArrowLeft") go(-1);
    else if (e.key === "ArrowRight") go(1);
    else return;
    e.preventDefault();
  }

  const swipeShift = swipe.dx || swipe.dy;
  const imgTransform = swipeShift
    ? `translate3d(${swipe.dx}px, ${swipe.dy}px, 0)`
    : `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.s})`;

  const iconButton =
    "inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-40";

  return (
    <DialogPrimitive.Root open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          data-photo-viewer=""
          onKeyDown={onKeyDown}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            closeRef.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            onCloseAutoFocus();
          }}
          className="fixed inset-0 z-[60] flex flex-col bg-black text-white outline-none"
          style={{
            paddingTop: "env(safe-area-inset-top)",
            paddingBottom: "env(safe-area-inset-bottom)",
            paddingLeft: "env(safe-area-inset-left)",
            paddingRight: "env(safe-area-inset-right)",
          }}
        >
          <DialogPrimitive.Title className="sr-only">Photos of {carTitle}</DialogPrimitive.Title>

          <header className="flex items-center gap-2 px-2 py-2 sm:px-4">
            <p className="min-w-0 flex-1 truncate text-sm">
              <span className="font-semibold">{photo.section}</span>{" "}
              <span className="tabular text-white/80">
                {photo.n} / {photo.total}
              </span>
            </p>
            <button type="button" className={iconButton} onClick={() => zoomAt(view.s / 1.5)} disabled={!zoomed} aria-label="Zoom out">
              <ZoomOut className="size-5" aria-hidden />
            </button>
            <button type="button" className={iconButton} onClick={() => zoomAt(view.s * 1.5)} disabled={view.s >= maxScale - 0.01} aria-label="Zoom in">
              <ZoomIn className="size-5" aria-hidden />
            </button>
            <button ref={closeRef} type="button" className={iconButton} onClick={onClose} aria-label="Close">
              <X className="size-6" aria-hidden />
            </button>
          </header>

          <div
            ref={stageRef}
            data-viewer-stage=""
            className={cn("relative min-h-0 flex-1 touch-none select-none overflow-hidden", zoomed ? "cursor-zoom-out" : "cursor-zoom-in")}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- the original file, at full resolution */}
            <img
              key={photo.src + index}
              src={photo.src}
              alt={photo.alt}
              draggable={false}
              data-scale={view.s.toFixed(2)}
              onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
              className={cn(
                "absolute inset-0 h-full w-full object-contain",
                !gesturing && "motion-safe:transition-transform motion-safe:duration-200",
              )}
              style={{ transform: imgTransform, opacity: swipe.dy ? Math.max(0.3, 1 - swipe.dy / 400) : 1 }}
            />
            {photos.length > 1 ? (
              <>
                <button
                  type="button"
                  onClick={() => go(-1)}
                  aria-label="Previous photo"
                  className={cn(iconButton, "absolute left-2 top-1/2 -translate-y-1/2 bg-black/60 sm:left-4 sm:size-12")}
                >
                  <ChevronLeft className="size-6" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => go(1)}
                  aria-label="Next photo"
                  className={cn(iconButton, "absolute right-2 top-1/2 -translate-y-1/2 bg-black/60 sm:right-4 sm:size-12")}
                >
                  <ChevronRight className="size-6" aria-hidden />
                </button>
              </>
            ) : null}
          </div>

          {photos.length > 1 ? (
            <div ref={thumbsRef} className="relative hidden gap-2 overflow-x-auto px-4 py-3 [scrollbar-width:thin] sm:flex">
              {photos.map((p, i) => (
                <button
                  key={i}
                  type="button"
                  data-thumb={i}
                  onClick={() => onIndexChange(i)}
                  aria-label={`Show ${p.section.toLowerCase()} photo ${p.n} of ${p.total}`}
                  aria-current={i === index ? "true" : undefined}
                  className={cn(
                    "relative h-14 w-20 shrink-0 overflow-hidden rounded border-2",
                    i === index ? "border-signal" : "border-transparent opacity-60 hover:opacity-100",
                  )}
                >
                  <Image src={p.src} alt="" fill sizes="80px" draggable={false} className="object-cover" />
                </button>
              ))}
            </div>
          ) : null}

          <p className="sr-only" aria-live="polite" aria-atomic="true">
            {announce}
          </p>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
