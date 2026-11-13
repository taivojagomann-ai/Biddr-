// Shared by Server and Client Components, so this file has no client directive:
// values exported from a client module become client references on the server.
import type { AuctionCard } from "@/lib/types";

export const STATUS_TABS = [
  { value: "live", label: "Live" },
  { value: "newest", label: "Newly listed" },
  { value: "ending", label: "Ending in 24h" },
  { value: "upcoming", label: "Coming up" },
  { value: "past", label: "Past results" },
] as const;

export type FeedStatus = (typeof STATUS_TABS)[number]["value"];

export function parseFeedStatus(v: string | undefined): FeedStatus {
  return STATUS_TABS.some((t) => t.value === v) ? (v as FeedStatus) : "live";
}

export function tabLabel(status: FeedStatus): string {
  return STATUS_TABS.find((t) => t.value === status)?.label ?? "Auctions";
}

type Sortable = Pick<AuctionCard, "starts_at" | "ends_at">;
const time = (v: string | null) => (v ? Date.parse(v) : Number.POSITIVE_INFINITY);

/**
 * Each tab's order, the same as its database query. The feed re-applies it after
 * Realtime updates (e.g. a late bid moving ends_at), so the order stays right.
 */
export function compareForTab(status: FeedStatus): (a: Sortable, b: Sortable) => number {
  switch (status) {
    case "live":
    case "ending":
      return (a, b) => time(a.ends_at) - time(b.ends_at);
    case "newest":
      return (a, b) => time(b.starts_at) - time(a.starts_at);
    case "upcoming":
      return (a, b) => time(a.starts_at) - time(b.starts_at);
    case "past":
      return (a, b) => time(b.ends_at) - time(a.ends_at);
  }
}

export const NEW_LISTING_MS = 24 * 60 * 60 * 1000;

/** Went live in the last 24 hours (bidding has opened, so not upcoming or draft). */
export function isNewListing(a: Pick<AuctionCard, "starts_at" | "status">, now: number): boolean {
  if (!a.starts_at || a.status === "upcoming" || a.status === "draft") return false;
  const started = Date.parse(a.starts_at);
  return started <= now && now - started < NEW_LISTING_MS;
}
