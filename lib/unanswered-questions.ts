import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Unanswered questions on a seller's upcoming and live listings: top-level comments
 * by someone else with no reply from the seller yet (DECISIONS.md point 8). Shown as a
 * count next to "My listings" in the menu and on each listing there. Comments are
 * public, so this reads them with the visitor's own client.
 */
export async function unansweredQuestions(supabase: SupabaseClient, sellerId: string): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const { data: auctions } = await supabase
    .from("auctions")
    .select("id")
    .eq("seller_id", sellerId)
    .in("status", ["upcoming", "live"])
    .returns<{ id: string }[]>();
  const ids = (auctions ?? []).map((a) => a.id);
  if (!ids.length) return counts;

  const { data: comments } = await supabase
    .from("comments")
    .select("id, auction_id, parent_id, is_seller_reply")
    .in("auction_id", ids)
    .returns<{ id: string; auction_id: string; parent_id: string | null; is_seller_reply: boolean }[]>();

  // A question is answered when the seller replied anywhere in its thread.
  const parentOf = new Map((comments ?? []).map((c) => [c.id, c.parent_id]));
  const rootOf = (id: string) => {
    let at = id;
    for (let i = 0; i < 50; i++) {
      const up = parentOf.get(at);
      if (!up) break;
      at = up;
    }
    return at;
  };
  const answered = new Set<string>();
  for (const c of comments ?? []) if (c.parent_id && c.is_seller_reply) answered.add(rootOf(c.id));
  for (const c of comments ?? []) {
    if (c.parent_id || c.is_seller_reply || answered.has(c.id)) continue;
    counts.set(c.auction_id, (counts.get(c.auction_id) ?? 0) + 1);
  }
  return counts;
}

export function totalUnanswered(counts: Map<string, number>): number {
  let total = 0;
  for (const n of counts.values()) total += n;
  return total;
}

/** "1 unanswered question" / "3 unanswered questions". */
export function unansweredLabel(n: number): string {
  return `${n} unanswered question${n === 1 ? "" : "s"}`;
}
