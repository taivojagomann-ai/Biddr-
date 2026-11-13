"use client";
import { useEffect, useSyncExternalStore } from "react";
import { ensureClockSync, serverNow, subscribeClockOffset } from "@/hooks/use-server-clock";

/**
 * One shared timer that fires at the start of every minute (server clock),
 * for relative times like "5m ago" that don't need to re-render every second.
 * Countdowns keep using the 1 Hz ticker in use-server-clock.ts.
 */
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;
let unsubscribeOffset: (() => void) | null = null;
let snapshot = serverNow();

function tick() {
  snapshot = serverNow();
  listeners.forEach((l) => l());
  schedule();
}

/** Re-arms the timer for the next minute boundary. setTimeout chains don't drift like setInterval. */
function schedule() {
  if (timer) clearTimeout(timer);
  if (listeners.size === 0) {
    timer = null;
    return;
  }
  const msToNextMinute = 60_000 - (serverNow() % 60_000);
  // +20 ms so we land just after the boundary, never just before it.
  timer = setTimeout(tick, msToNextMinute + 20);
}

// Background tabs throttle timers; catch up as soon as the tab is visible again.
function onVisibility() {
  if (document.visibilityState === "visible") tick();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    unsubscribeOffset = subscribeClockOffset(tick); // offset arrived: correct the time and re-align
    document.addEventListener("visibilitychange", onVisibility);
    tick();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      if (timer) clearTimeout(timer);
      timer = null;
      unsubscribeOffset?.();
      unsubscribeOffset = null;
      document.removeEventListener("visibilitychange", onVisibility);
    }
  };
}

/**
 * Current time in ms (server-clock corrected) that updates once a minute, at the
 * start of the minute. Returns `initialNow` during server rendering and hydration,
 * so the first client render matches the HTML.
 */
export function useMinuteNow(initialNow: number): number {
  useEffect(ensureClockSync, []);
  return useSyncExternalStore(subscribe, () => snapshot, () => initialNow);
}
