"use client";
// One shared, in-memory state per auction for "am I watching" and the watcher
// count, so every Watch button and count on a page stays in sync (title row, bid
// box, cards), including counts arriving over Realtime.
import { useSyncExternalStore } from "react";

export interface WatchEntry {
  /** null until a Watch button (which knows the server value) has seeded it. */
  watching: boolean | null;
  count: number;
}

const entries = new Map<string, WatchEntry>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

/**
 * Called while rendering, so it never notifies. `watching` is only set if still
 * unknown (the first Watch button wins); the count is only set for a new entry.
 */
export function seedWatch(id: string, watching: boolean | null, count: number) {
  const current = entries.get(id);
  if (!current) entries.set(id, { watching, count: Math.max(0, count) });
  else if (current.watching === null && watching !== null) entries.set(id, { ...current, watching });
}

/** Server truth for the count (initial props and Realtime). */
export function setWatchCount(id: string, count: number) {
  const current = entries.get(id);
  if (current && current.count === count) return;
  entries.set(id, { watching: current?.watching ?? null, count: Math.max(0, count) });
  emit();
}

export function setWatching(id: string, watching: boolean) {
  const current = entries.get(id) ?? { watching: null, count: 0 };
  if (current.watching === watching) return;
  entries.set(id, { watching, count: Math.max(0, current.count + (watching ? 1 : -1)) });
  emit();
}

export function useWatch(id: string, fallback: WatchEntry): WatchEntry {
  return useSyncExternalStore(
    subscribe,
    () => entries.get(id) ?? fallback,
    () => fallback,
  );
}
