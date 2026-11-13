// Home page search (?q=). The matching itself happens in Postgres
// (search_auctions / search_suggestions, migration 0012).
import type { FeedStatus } from "@/lib/feed";

export const SEARCH_MAX_LENGTH = 100;
/** Suggestions start from this many characters. */
export const SUGGEST_MIN_LENGTH = 2;
export const SEARCH_DEBOUNCE_MS = 300;

/** Cleans ?q=: trimmed, single spaces, at most SEARCH_MAX_LENGTH characters. Empty -> "". */
export function parseSearchQuery(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? "").replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX_LENGTH);
}

/** "No live results for “bmw”." and so on, per tab. */
export function noResultsText(status: FeedStatus, query: string): string {
  const q = `“${query}”`;
  switch (status) {
    case "newest":
      return `No newly listed results for ${q}.`;
    case "ending":
      return `No results ending in 24h for ${q}.`;
    case "upcoming":
      return `No upcoming results for ${q}.`;
    case "past":
      return `No past results for ${q}.`;
    default:
      return `No live results for ${q}.`;
  }
}

export function resultsCountText(count: number, query: string): string {
  return `${count} ${count === 1 ? "result" : "results"} for “${query}”.`;
}
