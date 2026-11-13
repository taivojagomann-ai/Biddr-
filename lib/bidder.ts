import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { BidderRequirementCode, BidderStatus } from "@/lib/types";

function isBidderStatus(v: unknown): v is BidderStatus {
  return (
    typeof v === "object" && v !== null &&
    typeof (v as BidderStatus).profile_complete === "boolean" &&
    typeof (v as BidderStatus).terms_accepted === "boolean" &&
    typeof (v as BidderStatus).current_version === "string"
  );
}

/**
 * Runs bidder_status() as the signed-in user (pass the user's own server client), so
 * the database applies the same rules as the bid trigger. null if it couldn't be read.
 */
export async function getBidderStatus(supabase: SupabaseClient): Promise<BidderStatus | null> {
  const { data, error } = await supabase.rpc("bidder_status");
  if (error || !isBidderStatus(data)) {
    if (error) console.error("bidder_status failed", error);
    return null;
  }
  return data;
}

/** The first requirement that isn't met, or null when the user may bid. */
export function unmetRequirement(status: BidderStatus): BidderRequirementCode | null {
  if (!status.profile_complete) return "PROFILE_INCOMPLETE";
  if (!status.terms_accepted) return "TERMS_NOT_ACCEPTED";
  return null;
}
