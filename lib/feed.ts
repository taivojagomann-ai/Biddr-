// Shared by Server and Client Components, so this file has no client directive:
// values exported from a client module become client references on the server.
export const STATUS_TABS = [
  { value: "live", label: "Live" },
  { value: "ending", label: "Ending in 24h" },
  { value: "upcoming", label: "Coming up" },
  { value: "past", label: "Past results" },
] as const;

export type FeedStatus = (typeof STATUS_TABS)[number]["value"];

export function parseFeedStatus(v: string | undefined): FeedStatus {
  return STATUS_TABS.some((t) => t.value === v) ? (v as FeedStatus) : "live";
}
