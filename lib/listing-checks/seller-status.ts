// What the seller sees about their listing's verification (My listings and the verify
// page). Admin details (extracted values, confidence) stay on the admin side.

export interface SellerVerificationView {
  hasDocuments: boolean;
  hasPhotos: boolean;
  outcome: "pending" | "green" | "yellow" | "red";
  reasons: string[];
  onHold: boolean;
  canRetry: boolean;
  contentApproved: boolean;
  identityVerified: boolean;
  identityStatus: string;
  overridden: boolean;
}

export const IDENTITY_REQUEST = "Your listing is approved. Verify your identity to schedule the auction.";

/** One line for My listings and a heading for the verify page. */
export function sellerSummary(v: SellerVerificationView): { tone: "todo" | "ok" | "wait" | "bad"; text: string } {
  if (v.onHold && !v.overridden) {
    return v.canRetry
      ? { tone: "bad", text: "On hold: something didn't match. Check the details and try again." }
      : { tone: "bad", text: "On hold: Biddr's team is reviewing your listing." };
  }
  if (!v.hasDocuments || !v.hasPhotos) {
    const missing = [!v.hasDocuments ? "the registration certificate" : null, !v.hasPhotos ? "two photos at the car" : null].filter(Boolean);
    return { tone: "todo", text: `Verify your car: add ${missing.join(" and ")}.` };
  }
  if (v.contentApproved && !v.identityVerified) return { tone: "todo", text: IDENTITY_REQUEST };
  if (v.outcome === "pending") return { tone: "wait", text: "Checking your photos and documents." };
  if (v.outcome === "yellow" && !v.overridden) return { tone: "wait", text: "Biddr's team is taking a closer look at your photos and documents." };
  return { tone: "ok", text: "Your car is verified. Biddr's team is reviewing the listing." };
}

/** From the stored records (lib/listing-checks/run.ts VerificationRow and the seller's identity status). */
export function sellerView(
  v: {
    registration_paths: string[];
    vin_photo_path: string | null;
    odometer_photo_path: string | null;
    outcome: SellerVerificationView["outcome"];
    outcome_reasons: string[];
    on_hold: boolean;
    red_count: number;
    content_approved_at: string | null;
    override_at: string | null;
  } | null,
  identityStatus: string,
): SellerVerificationView {
  return {
    hasDocuments: Boolean(v?.registration_paths.length),
    hasPhotos: Boolean(v?.vin_photo_path && v?.odometer_photo_path),
    outcome: v?.outcome ?? "pending",
    reasons: v?.outcome === "red" ? v.outcome_reasons : [],
    onHold: Boolean(v?.on_hold),
    canRetry: Boolean(v?.on_hold) && (v?.red_count ?? 0) < 2,
    contentApproved: Boolean(v?.content_approved_at),
    identityVerified: identityStatus === "verified",
    identityStatus,
    overridden: Boolean(v?.override_at),
  };
}
