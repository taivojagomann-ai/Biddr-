"use client";
import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => undefined;
const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

/**
 * The viewer's own IANA time zone. "UTC" during server rendering and hydration
 * (so both render the same text), the browser's zone right after.
 */
export function useTimeZone(): string {
  return useSyncExternalStore(noopSubscribe, browserZone, () => "UTC");
}
