import "server-only";
import type { getAdminSupabase } from "@/lib/supabase/server";
import { verificationModel, type CheckRow, type ModelInput, type VerificationModel } from "./verification-model";

type Db = ReturnType<typeof getAdminSupabase>;
type Listing = { id: string; status: string; created_at: string };

const V_COLUMNS =
  "auction_id, registration_paths, seller_is_owner, authorisation_paths, documents_uploaded_at, vin_photo_path, odometer_photo_path, photos_taken_at, outcome, outcome_reasons, waiting_for_identity, checked_at, red_count, on_hold, override_at, files_purged_at";

/** The seller's view of verification for their listings (service role, strictly their own rows). */
export async function loadVerificationModels(db: Db, sellerId: string, listings: Listing[]): Promise<Map<string, VerificationModel>> {
  const out = new Map<string, VerificationModel>();
  if (!listings.length) return out;
  const ids = listings.map((l) => l.id);
  const [{ data: vRows }, { data: me }, { data: privRows }, { data: checkRows }] = await Promise.all([
    db.from("listing_verifications").select(V_COLUMNS).in("auction_id", ids).eq("seller_id", sellerId).returns<(NonNullable<ModelInput["verification"]> & { auction_id: string })[]>(),
    db.from("profiles").select("identity_status, identity_verified_at").eq("id", sellerId).maybeSingle<{ identity_status: string; identity_verified_at: string | null }>(),
    db
      .from("auction_private")
      .select("auction_id, dealer_inspection_provided, history_report_provided")
      .in("auction_id", ids)
      .returns<{ auction_id: string; dealer_inspection_provided: boolean | null; history_report_provided: boolean | null }[]>(),
    db
      .from("listing_checks")
      .select("auction_id, run_id, check_name, status, extracted, reason, checked_at")
      .in("auction_id", ids)
      .order("checked_at", { ascending: false })
      .limit(12 * ids.length)
      .returns<(CheckRow & { auction_id: string; run_id: string })[]>(),
  ]);
  const vBy = new Map((vRows ?? []).map((r) => [r.auction_id, r]));
  const privBy = new Map((privRows ?? []).map((r) => [r.auction_id, r]));
  // The latest run per listing (rows come newest first).
  const latestRun = new Map<string, string>();
  for (const r of checkRows ?? []) if (!latestRun.has(r.auction_id)) latestRun.set(r.auction_id, r.run_id);
  for (const l of listings) {
    const priv = privBy.get(l.id);
    out.set(
      l.id,
      verificationModel({
        auctionId: l.id,
        auctionStatus: l.status,
        submittedAt: l.created_at,
        verification: vBy.get(l.id) ?? null,
        identity: { status: me?.identity_status ?? "none", verifiedAt: me?.identity_verified_at ?? null },
        reports: { dealer: Boolean(priv?.dealer_inspection_provided), history: Boolean(priv?.history_report_provided) },
        checks: (checkRows ?? []).filter((r) => r.auction_id === l.id && r.run_id === latestRun.get(l.id)),
      }),
    );
  }
  return out;
}
