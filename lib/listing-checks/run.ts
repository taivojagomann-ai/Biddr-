import "server-only";
import { randomInt, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CHALLENGE_MINUTES, CODE_ALPHABET, CODE_LENGTH, CODES_PER_DAY } from "./challenge";
import { outcomeOf, runComparisons, type Check, type Extracted, type Outcome } from "./compare";
import { extractionConfigured, extractValues, type InputFile, type Usage } from "./extract";
import { searchPhotos, visionConfigured } from "./vision";

/**
 * Runs the fake-listing checks for one listing (DECISIONS.md point 16) and records the
 * result. Called with the service role only: listing_verifications, listing_checks and
 * listing_check_costs are admin-only.
 */

type Db = SupabaseClient;

export interface VerificationRow {
  auction_id: string;
  seller_id: string;
  registration_paths: string[];
  seller_is_owner: boolean;
  authorisation_paths: string[];
  documents_uploaded_at: string | null;
  challenge_code: string | null;
  challenge_issued_at: string | null;
  challenge_expires_at: string | null;
  challenge_issue_log: string[];
  vin_photo_path: string | null;
  odometer_photo_path: string | null;
  photos_taken_at: string | null;
  extracted: Extracted | null;
  outcome: Outcome;
  outcome_reasons: string[];
  waiting_for_identity: boolean;
  checked_at: string | null;
  run_count: number;
  red_count: number;
  on_hold: boolean;
  needs_admin: boolean;
  content_approved_at: string | null;
  content_approved_by: string | null;
  override_at: string | null;
  override_by: string | null;
  override_reason: string | null;
  override_outcome: string | null;
  files_purged_at: string | null;
}

export const BUCKET = "inspection-uploads";

export async function loadVerification(db: Db, auctionId: string): Promise<VerificationRow | null> {
  const { data } = await db.from("listing_verifications").select("*").eq("auction_id", auctionId).maybeSingle<VerificationRow>();
  return data;
}

/** The listing's record, created on first use (listings submitted before the checks existed too). */
export async function ensureVerification(db: Db, auctionId: string, sellerId: string): Promise<VerificationRow> {
  const existing = await loadVerification(db, auctionId);
  if (existing) return existing;
  await db.from("listing_verifications").upsert({ auction_id: auctionId, seller_id: sellerId }, { onConflict: "auction_id", ignoreDuplicates: true });
  return (await loadVerification(db, auctionId))!;
}

export function newCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

/** A new code, valid for 15 minutes; the previous one stops working. Null when the daily limit is used up. */
export async function issueChallenge(db: Db, v: VerificationRow): Promise<{ code: string; expiresAt: string } | null> {
  const dayAgo = Date.now() - 86_400_000;
  const recent = (v.challenge_issue_log ?? []).filter((t) => Date.parse(t) > dayAgo);
  if (recent.length >= CODES_PER_DAY) return null;
  const now = new Date();
  const code = newCode();
  const expiresAt = new Date(now.getTime() + CHALLENGE_MINUTES * 60_000).toISOString();
  await db
    .from("listing_verifications")
    .update({ challenge_code: code, challenge_issued_at: now.toISOString(), challenge_expires_at: expiresAt, challenge_issue_log: [...recent, now.toISOString()] })
    .eq("auction_id", v.auction_id);
  return { code, expiresAt };
}

function mediaTypeOf(path: string): InputFile["mediaType"] {
  if (path.endsWith(".pdf")) return "application/pdf";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

async function download(db: Db, path: string, kind: InputFile["kind"]): Promise<InputFile> {
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`Couldn't read ${kind}: ${error?.message ?? "missing file"}`);
  return { kind, mediaType: mediaTypeOf(path), base64: Buffer.from(await data.arrayBuffer()).toString("base64") };
}

/** Everything the checks need is there: the registration certificate and both photos (and an authorisation if the seller isn't the owner). */
export function readyForChecks(v: VerificationRow): boolean {
  return (
    v.registration_paths.length > 0 &&
    Boolean(v.vin_photo_path && v.odometer_photo_path) &&
    (v.seller_is_owner || v.authorisation_paths.length > 0) &&
    !v.files_purged_at
  );
}

async function logCosts(db: Db, auctionId: string, usage: Usage[], vision: { units: number; costUsd: number } | null) {
  // Every row has the same keys (a bulk insert needs that).
  const rows = usage.map((u) => ({
    auction_id: auctionId,
    provider: "anthropic",
    model: u.model,
    purpose: "extract",
    input_tokens: u.inputTokens,
    output_tokens: u.outputTokens,
    units: 0,
    cost_usd: Number(u.costUsd.toFixed(5)),
  }));
  if (vision) {
    rows.push({ auction_id: auctionId, provider: "google_vision", model: "WEB_DETECTION", purpose: "reverse_image_search", input_tokens: 0, output_tokens: 0, units: vision.units, cost_usd: Number(vision.costUsd.toFixed(5)) });
  }
  if (rows.length) {
    const { error } = await db.from("listing_check_costs").insert(rows);
    if (error) console.error("listing checks: couldn't log costs", auctionId, error);
  }
}

async function notifyAdmins(db: Db, auctionId: string, sellerId: string, data: Record<string, unknown>) {
  const { data: admins } = await db.from("profiles").select("id").eq("role", "admin").returns<{ id: string }[]>();
  const rows = (admins ?? []).filter((a) => a.id !== sellerId).map((a) => ({ user_id: a.id, type: "listing_needs_check", auction_id: auctionId, actor_id: sellerId, data }));
  if (rows.length) await db.from("notifications").insert(rows);
}

export type RunResult =
  | { ok: true; outcome: Outcome; waitingForIdentity: boolean; reasons: string[]; checks: Check[] }
  | { ok: false; error: string };

/**
 * Runs the checks. `reextract`: read the photos and documents again (API calls); without
 * it, compare the stored values again (e.g. after the seller's identity is verified).
 */
export async function runListingChecks(db: Db, auctionId: string, { reextract }: { reextract: boolean }): Promise<RunResult> {
  const v = await loadVerification(db, auctionId);
  if (!v) return { ok: false, error: "No verification for this listing." };
  const { data: a } = await db
    .from("auctions")
    .select("id, seller_id, status, vin, mileage_km, exterior_color, body_style, seller_type, dealer_name, gallery_urls")
    .eq("id", auctionId)
    .maybeSingle<{
      id: string;
      seller_id: string;
      status: string;
      vin: string;
      mileage_km: number;
      exterior_color: string | null;
      body_style: string | null;
      seller_type: "private" | "dealer";
      dealer_name: string | null;
      gallery_urls: { exterior?: string[] } | null;
    }>();
  if (!a) return { ok: false, error: "The listing no longer exists." };
  const [{ data: priv }, { data: seller }] = await Promise.all([
    db.from("auction_private").select("dealer_inspection_mileage_km, dealer_inspection_provided").eq("auction_id", auctionId).maybeSingle<{ dealer_inspection_mileage_km: number | null; dealer_inspection_provided: boolean | null }>(),
    db.from("profiles").select("identity_status, identity_verified_name").eq("id", a.seller_id).maybeSingle<{ identity_status: string; identity_verified_name: string | null }>(),
  ]);

  let extracted = v.extracted;
  if (reextract || !extracted) {
    if (!readyForChecks(v)) return { ok: false, error: "The registration certificate and both photos are needed first." };
    if (!extractionConfigured()) return { ok: false, error: "Automated checks aren't set up (ANTHROPIC_API_KEY). An admin reviews this listing by hand." };
    const files: InputFile[] = [
      await download(db, v.vin_photo_path!, "vin_photo"),
      await download(db, v.odometer_photo_path!, "odometer_photo"),
      ...(await Promise.all(v.registration_paths.map((p) => download(db, p, "registration")))),
      ...(v.seller_is_owner ? [] : await Promise.all(v.authorisation_paths.map((p) => download(db, p, "authorisation")))),
    ];
    let usage: Usage[] = [];
    let read: Omit<Extracted, "images">;
    try {
      const r = await extractValues(files, auctionId);
      usage = r.usage;
      read = r.extracted;
    } catch (e) {
      usage = (e as { usage?: Usage[] }).usage ?? [];
      await logCosts(db, auctionId, usage, null);
      console.error("listing checks: extraction failed", auctionId, e);
      // Couldn't read anything: an admin looks at it.
      read = {
        challenge_code: { value: null, confidence: "low" },
        plate_vin: { value: null, confidence: "low" },
        odometer: { value: null, unit: null, confidence: "low" },
        vehicle_colour: { value: null, confidence: "low" },
        body_type: { value: null, confidence: "low" },
        certificate_vins: { values: [], confidence: "low" },
        certificate_owners: { values: [], confidence: "low" },
        authorisation: null,
      };
    }
    let images: Extracted["images"] = null;
    let vision: { units: number; costUsd: number } | null = null;
    const photos = (a.gallery_urls?.exterior ?? []).filter(Boolean);
    if (visionConfigured() && photos.length) {
      try {
        const r = await searchPhotos(photos);
        images = r.result;
        vision = { units: r.units, costUsd: r.costUsd };
      } catch (e) {
        console.error("listing checks: reverse image search failed", auctionId, e);
      }
    }
    await logCosts(db, auctionId, usage, vision);
    extracted = { ...read, images };
  }

  const checks = runComparisons(extracted, {
    vin: a.vin,
    mileageKm: a.mileage_km,
    exteriorColor: a.exterior_color,
    bodyStyle: a.body_style,
    sellerType: a.seller_type,
    dealerName: a.dealer_name,
    dealerReportMileageKm: priv?.dealer_inspection_provided ? (priv.dealer_inspection_mileage_km ?? null) : null,
    issuedCode: v.challenge_code,
    sellerIsOwner: v.seller_is_owner,
    hasAuthorisation: v.authorisation_paths.length > 0,
    identity: { verified: seller?.identity_status === "verified", name: seller?.identity_verified_name ?? null },
  });
  const { outcome, waitingForIdentity, reasons } = outcomeOf(checks);

  const runId = randomUUID();
  const now = new Date().toISOString();
  await db.from("listing_checks").insert(
    checks.map((c) => ({
      auction_id: auctionId,
      run_id: runId,
      check_name: c.name,
      status: c.status,
      hard: c.hard,
      extracted: c.extracted,
      confidence: c.confidence,
      reason: c.reason,
      checked_at: now,
    })),
  );

  // Red: on hold; the seller may try once more, then it goes to the admins.
  const redCount = outcome === "red" && reextract ? v.red_count + 1 : v.red_count;
  const overridden = Boolean(v.override_at);
  const needsAdmin = !overridden && (outcome === "yellow" || (outcome === "red" && redCount >= 2));
  await db
    .from("listing_verifications")
    .update({
      extracted,
      outcome,
      outcome_reasons: reasons,
      waiting_for_identity: waitingForIdentity,
      checked_at: now,
      run_count: reextract ? v.run_count + 1 : v.run_count,
      red_count: redCount,
      on_hold: outcome === "red",
      needs_admin: needsAdmin,
    })
    .eq("auction_id", auctionId);

  const becameRed = outcome === "red" && reextract;
  if (becameRed) {
    await db.from("notifications").insert({
      user_id: a.seller_id,
      type: "listing_on_hold",
      auction_id: auctionId,
      data: { reasons, retry: redCount < 2 },
    });
    if (redCount >= 2) {
      await notifyAdmins(db, auctionId, a.seller_id, { outcome: "red", reasons });
      await db.from("admin_actions").insert({ admin_id: null, auction_id: auctionId, action: "checks.repeated_red", details: { reasons, red_count: redCount } });
    }
  } else if (needsAdmin && !v.needs_admin) {
    await notifyAdmins(db, auctionId, a.seller_id, { outcome, reasons });
  }
  return { ok: true, outcome, waitingForIdentity, reasons, checks };
}

/** After the seller's identity is verified: compare the stored values again (no API calls) for their listings in review. */
export async function rerunOwnerChecks(db: Db, sellerId: string): Promise<void> {
  const { data } = await db
    .from("listing_verifications")
    .select("auction_id, extracted, auction:auctions!inner(status)")
    .eq("seller_id", sellerId)
    .not("extracted", "is", null)
    .returns<{ auction_id: string; auction: { status: string } }[]>();
  for (const row of data ?? []) {
    if (row.auction.status !== "draft") continue;
    await runListingChecks(db, row.auction_id, { reextract: false });
  }
}

/** Can this listing be approved and scheduled? Lists what's still missing. */
export function schedulingBlockers(v: VerificationRow | null, sellerVerified: boolean): string[] {
  const missing: string[] = [];
  if (!sellerVerified) missing.push("the seller must verify their identity");
  if (!v) missing.push("the seller must verify the car (registration certificate and photos)");
  else if (!v.override_at) {
    if (v.outcome === "pending") missing.push("the automated checks must run (registration certificate and photos)");
    else if (v.outcome !== "green") missing.push(`the automated checks are ${v.outcome}: review them and override with a reason if you accept the listing`);
  }
  return missing;
}
