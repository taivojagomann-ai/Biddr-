import "server-only";
import type { SellerInfo } from "@/components/auction/seller-card";
import { getServerSupabase } from "@/lib/supabase/server";
import type { Auction, Country } from "@/lib/types";

/**
 * The public seller card for an auction. Reads only public columns (profiles'
 * column grants hide full name and phone) with the visitor's own client.
 */
export async function loadSellerInfo(
  a: Pick<Auction, "seller_id" | "seller_type" | "dealer_name" | "dealer_registry_code">,
): Promise<SellerInfo> {
  const supabase = getServerSupabase();
  const [{ data: profile }, listedRes, soldRes] = await Promise.all([
    supabase
      .from("profiles")
      .select("username, country, created_at")
      .eq("id", a.seller_id)
      .maybeSingle<{ username: string | null; country: Country | null; created_at: string }>(),
    supabase
      .from("auctions")
      .select("id", { count: "exact", head: true })
      .eq("seller_id", a.seller_id)
      .in("status", ["upcoming", "live", "ended", "sold", "reserve_not_met"]),
    supabase.from("auctions").select("id", { count: "exact", head: true }).eq("seller_id", a.seller_id).eq("status", "sold"),
  ]);
  return {
    username: profile?.username ?? null,
    country: profile?.country ?? null,
    memberSince: profile?.created_at ?? null,
    sellerType: a.seller_type === "dealer" ? "dealer" : "private",
    dealerName: a.dealer_name,
    dealerRegistryCode: a.dealer_registry_code,
    listed: listedRes.count ?? 0,
    sold: soldRes.count ?? 0,
  };
}
