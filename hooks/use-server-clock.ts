"use client";
import { useEffect, useSyncExternalStore } from "react";
import { getBrowserSupabase } from "@/lib/supabase/client";

/**
 * One shared 1 Hz ticker plus a server clock offset.
 * Timers are display-only: the database decides when an auction ends.
 */
let offsetMs = 0;
let synced = false;
let syncing: Promise<void> | null = null;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let snapshot = Date.now();

function tick() {
  snapshot = Date.now() + offsetMs;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!timer) {
    tick();
    timer = setInterval(tick, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

async function syncOffset(): Promise<void> {
  const t0 = Date.now();
  const { data, error } = await getBrowserSupabase().rpc("server_time");
  const t1 = Date.now();
  if (error || typeof data !== "string") return;
  // Assume symmetric latency.
  offsetMs = new Date(data).getTime() - (t0 + (t1 - t0) / 2);
  synced = true;
  tick();
}

/** Current time in ms, corrected to the database clock. */
export function useServerNow(initial: number): number {
  useEffect(() => {
    if (!synced && !syncing) syncing = syncOffset().finally(() => { syncing = null; });
  }, []);
  return useSyncExternalStore(subscribe, () => snapshot, () => initial);
}

export function useCountdown(endsAt: string | null, initialNow: number) {
  const now = useServerNow(initialNow);
  const end = endsAt ? new Date(endsAt).getTime() : 0;
  const remaining = Math.max(0, end - now);
  return {
    remaining,
    isFinalMinutes: remaining > 0 && remaining <= 2 * 60 * 1000,
    isUnderHour: remaining > 0 && remaining <= 60 * 60 * 1000,
    isOver: endsAt !== null && remaining === 0,
  };
}
