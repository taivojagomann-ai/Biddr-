"use client";
import Link from "next/link";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Info, X } from "lucide-react";
import type { HelpTopic } from "@/lib/help";
import { cn } from "@/lib/utils";

const POPOVER_WIDTH = 288;
const GAP = 8;

/**
 * An "i" button that opens a short explanation: a popover next to the button from
 * 640px, a bottom sheet on phones. Opens on click/tap and Enter/Space (it's a real
 * button), closes with Escape, the close button or a tap outside, and returns focus
 * to the button. Rendered in a portal so blurred or fixed parents (the sticky bid
 * bar) can't clip it; Tab stays inside while it's open.
 */
export function InfoTip({ topic, className }: { topic: HelpTopic; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLSpanElement>(null);
  const id = useId();
  const textId = `${id}-text`;

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus({ preventScroll: true });
  }, []);

  // Desktop placement: below the button (above if there's no room), kept on screen.
  const place = useCallback(() => {
    const b = buttonRef.current?.getBoundingClientRect();
    const panel = panelRef.current;
    if (!b || !panel || window.innerWidth < 640) {
      setPos(null);
      return;
    }
    const h = panel.offsetHeight;
    const below = b.bottom + GAP;
    const top = below + h > window.innerHeight - GAP && b.top - GAP - h > GAP ? b.top - GAP - h : below;
    const left = Math.min(Math.max(GAP, b.left + b.width / 2 - POPOVER_WIDTH / 2), window.innerWidth - POPOVER_WIDTH - GAP);
    setPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  // Move focus in on the next frame, once the popover has been placed and is visible
  // (an element that's still visibility:hidden can't take focus).
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => panelRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
        return;
      }
      if (e.key === "Tab" && panelRef.current) {
        // Keep Tab within the tip (close button and "Learn more").
        const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>("a[href], button"));
        const first = items[0];
        const last = items[items.length - 1];
        if (!first || !last) return;
        if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    const onPointer = (e: PointerEvent) => {
      const t = e.target;
      if (!(t instanceof Node)) return;
      if (panelRef.current?.contains(t) || buttonRef.current?.contains(t)) return;
      close();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, close, place]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label={topic.label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => (open ? close() : setOpen(true))}
        className={cn(
          // 24x24 target (WCAG 2.5.8), 44x44 on touch screens; the icon stays small.
          "inline-flex size-6 shrink-0 items-center justify-center rounded-full align-middle text-mute hover:text-chalk",
          "[@media(pointer:coarse)]:-my-2.5 [@media(pointer:coarse)]:size-11",
          open && "text-chalk",
          className,
        )}
      >
        <Info aria-hidden className="size-4" />
      </button>
      {open
        ? createPortal(
            <span
              ref={panelRef}
              role="dialog"
              aria-label={topic.label}
              aria-describedby={textId}
              tabIndex={-1}
              style={pos ? { top: pos.top, left: pos.left, width: POPOVER_WIDTH } : undefined}
              className={cn(
                "z-[70] block border border-line bg-panel text-left text-sm text-chalk shadow-2xl outline-none",
                // Phones: bottom sheet. From 640px: popover placed next to the button.
                "fixed inset-x-0 bottom-0 rounded-t-xl px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4",
                "sm:inset-x-auto sm:bottom-auto sm:rounded-lg sm:p-4",
                !pos && "sm:invisible",
              )}
            >
              <span className="flex items-start justify-between gap-3">
                <span className="font-semibold">{topic.label}</span>
                <button
                  type="button"
                  onClick={() => close()}
                  aria-label="Close"
                  className="-m-2 inline-flex size-11 shrink-0 items-center justify-center rounded-md text-mute hover:text-chalk sm:size-8"
                >
                  <X aria-hidden className="size-4" />
                </button>
              </span>
              <span id={textId} className="mt-1 block leading-relaxed text-mute">
                {topic.text}
              </span>
              <Link
                href={topic.href}
                onClick={() => close(false)}
                className="mt-2 inline-flex min-h-11 items-center font-semibold text-chalk underline underline-offset-4 hover:text-signal sm:min-h-0"
              >
                Learn more<span className="sr-only">: {topic.label.replace(/\?$/, "")}</span>
              </Link>
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
