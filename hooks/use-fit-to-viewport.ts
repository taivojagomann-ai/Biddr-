"use client";
import { useLayoutEffect, type RefObject } from "react";

/**
 * While `open`, caps the element's height at the space between its top edge and the
 * bottom of the screen, so its end (e.g. the bell's "See all") is never cut off. A
 * fixed max-height can't do this: the header isn't always at the top of the screen
 * (the test-mode banner sits above it), and its backdrop blur makes "fixed" children
 * position against the header, not the screen. A smaller max-height from the
 * element's own CSS (e.g. 70vh on desktop) still applies.
 */
export function useFitToViewport(ref: RefObject<HTMLElement>, open: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!open || !el) return;
    const fit = () => {
      el.style.maxHeight = "";
      const own = getComputedStyle(el).maxHeight;
      const top = el.getBoundingClientRect().top;
      const bottom = window.visualViewport?.height ?? window.innerHeight;
      const room = Math.max(160, Math.floor(bottom - top));
      el.style.maxHeight = `${own === "none" ? room : Math.min(room, parseFloat(own))}px`;
    };
    fit();
    window.addEventListener("resize", fit);
    window.addEventListener("scroll", fit, { passive: true });
    window.visualViewport?.addEventListener("resize", fit);
    return () => {
      window.removeEventListener("resize", fit);
      window.removeEventListener("scroll", fit);
      window.visualViewport?.removeEventListener("resize", fit);
      el.style.maxHeight = "";
    };
  }, [ref, open]);
}
