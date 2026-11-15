// Authorised dealer inspections (0014). No "use client": shared by server and client code.
import type { Auction } from "@/lib/types";

/** The Dealer inspected badge shows only when an admin accepted an authorised dealer's report. */
export function isDealerInspected(a: Pick<Auction, "inspection_type">): boolean {
  return a.inspection_type === "authorised_dealer";
}

export const DEALER_INSPECTED = "Dealer inspected";
export const ACCIDENT_REPAIRED = "Accident repaired";
export const INSPECTED_BY_SELLING_DEALER = "Inspected by the selling dealer";
export const NOT_INSPECTED = "Not inspected";
