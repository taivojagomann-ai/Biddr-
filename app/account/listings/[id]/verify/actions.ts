"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { startIdentityVerification } from "@/lib/identity";
import { CHALLENGE_MINUTES, CHALLENGE_PATH_RE, DOCUMENT_PATH_RE, verificationFolder } from "@/lib/listing-checks/challenge";
import { identityAdded } from "@/lib/listing-checks/verification-model";
import { BUCKET, ensureVerification, issueChallenge, readyForChecks, runListingChecks, type VerificationRow } from "@/lib/listing-checks/run";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";

export type VerifyResult = { ok: true; message: string; code?: string; expiresAt?: string; url?: string } | { ok: false; error: string; expired?: boolean };

const SESSION_EXPIRED: VerifyResult = { ok: false, error: "Your session has expired. Sign in again." };

/** The signed-in seller's own listing, still in review, and its verification record. */
async function ownDraft(auctionId: string): Promise<{ userId: string; v: VerificationRow } | VerifyResult> {
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return SESSION_EXPIRED;
  const { data: a } = await supabase.from("auctions").select("id, seller_id, status").eq("id", auctionId).maybeSingle<{ id: string; seller_id: string; status: string }>();
  if (!a || a.seller_id !== user.id) return { ok: false, error: "This listing isn't yours." };
  if (a.status !== "draft") return { ok: false, error: "This listing isn't waiting for review any more." };
  const v = await ensureVerification(getAdminSupabase(), auctionId, user.id);
  if (v.on_hold && v.red_count >= 2) {
    return { ok: false, error: "Biddr's team is reviewing this listing. They'll contact you if anything else is needed." };
  }
  return { userId: user.id, v };
}

/** Do these files exist in the seller's folder for this listing? Returns their upload times. */
async function uploadedAt(folder: string, paths: string[]): Promise<Map<string, string> | null> {
  const { data } = await getAdminSupabase().storage.from(BUCKET).list(folder, { limit: 200 });
  const byName = new Map((data ?? []).map((o) => [`${folder}/${o.name}`, o.created_at as string]));
  for (const p of paths) if (!byName.has(p)) return null;
  return byName;
}

function refresh(auctionId: string) {
  revalidatePath(`/account/listings/${auctionId}/verify`);
  revalidatePath("/account/listings");
}

const COULD_NOT_CHECK = "We couldn't run the checks just now. Your files are saved: try \"Submit for checking\" again in a few minutes.";

/** Runs the checks when everything is in. Never throws: the files stay saved either way. */
async function maybeRun(auctionId: string): Promise<VerifyResult & { ran?: boolean }> {
  const admin = getAdminSupabase();
  const fresh = (await admin.from("listing_verifications").select("*").eq("auction_id", auctionId).single<VerificationRow>()).data;
  if (!fresh || !readyForChecks(fresh)) return { ok: true, message: "Saved.", ran: false };
  try {
    const r = await runListingChecks(admin, auctionId, { reextract: true });
    if (!r.ok) {
      console.error("listing checks: not run", auctionId, r.error);
      return { ok: true, message: r.error, ran: true };
    }
    return {
      ok: true,
      ran: true,
      message:
        r.outcome === "green"
          ? "Checked: all checks passed."
          : r.outcome === "red"
            ? "Checked: something needs your attention. See Check results."
            : "Checked. See Check results.",
    };
  } catch (e) {
    console.error("listing checks: failed", auctionId, e);
    return { ok: true, message: COULD_NOT_CHECK, ran: true };
  }
}

const documentsSchema = z.object({
  auctionId: z.string().uuid(),
  registrationPaths: z.array(z.string()).min(1, "Add the registration certificate.").max(4, "Add at most 4 files."),
  sellerIsOwner: z.boolean(),
  authorisationPaths: z.array(z.string()).max(4, "Add at most 4 files."),
});

/** The registration certificate (and the owner's authorisation, if the seller isn't the owner). */
export async function saveDocuments(input: unknown): Promise<VerifyResult> {
  const parsed = documentsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the files." };
  const d = parsed.data;
  const own = await ownDraft(d.auctionId);
  if ("ok" in own) return own;
  if (!d.sellerIsOwner && !d.authorisationPaths.length) return { ok: false, error: "Add the registered owner's signed authorisation." };
  const folder = verificationFolder(own.userId, d.auctionId);
  const all = [...d.registrationPaths, ...(d.sellerIsOwner ? [] : d.authorisationPaths)];
  if (all.some((p) => !DOCUMENT_PATH_RE.test(p) || !p.startsWith(`${folder}/`)) || !(await uploadedAt(folder, all))) {
    return { ok: false, error: "One of the files didn't upload correctly. Remove it and add it again." };
  }
  await getAdminSupabase()
    .from("listing_verifications")
    .update({
      registration_paths: d.registrationPaths,
      seller_is_owner: d.sellerIsOwner,
      authorisation_paths: d.sellerIsOwner ? [] : d.authorisationPaths,
      documents_uploaded_at: new Date().toISOString(),
    })
    .eq("auction_id", d.auctionId);
  refresh(d.auctionId);
  return { ok: true, message: "Saved. Submit for checking when everything required is added." };
}

const auctionOnly = z.object({ auctionId: z.string().uuid() });

/** A new 6-character code, valid for 15 minutes. */
export async function startChallenge(input: unknown): Promise<VerifyResult> {
  const parsed = auctionOnly.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This listing no longer exists." };
  const own = await ownDraft(parsed.data.auctionId);
  if ("ok" in own) return own;
  const issued = await issueChallenge(getAdminSupabase(), own.v);
  if (!issued) return { ok: false, error: "You've asked for many codes today. Try again tomorrow." };
  refresh(parsed.data.auctionId);
  return { ok: true, message: `Your code is valid for ${CHALLENGE_MINUTES} minutes.`, code: issued.code, expiresAt: issued.expiresAt };
}

const challengeSchema = z.object({ auctionId: z.string().uuid(), vinPath: z.string(), odometerPath: z.string() });

/** Upload grace: a photo taken just before the code expired may finish uploading a little after. */
const UPLOAD_GRACE_MS = 2 * 60_000;

/**
 * The two camera photos. They must have been uploaded while the code was valid (after
 * it was issued, before it expired), so they can't be older photos.
 */
export async function submitChallenge(input: unknown): Promise<VerifyResult> {
  const parsed = challengeSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Take both photos first." };
  const d = parsed.data;
  const own = await ownDraft(d.auctionId);
  if ("ok" in own) return own;
  const v = own.v;
  if (!v.challenge_code || !v.challenge_issued_at || !v.challenge_expires_at) return { ok: false, error: "Get a code first.", expired: true };
  const issued = Date.parse(v.challenge_issued_at);
  const expires = Date.parse(v.challenge_expires_at);
  if (Date.now() > expires + UPLOAD_GRACE_MS) return { ok: false, error: "The code has expired. Get a new code and take both photos again.", expired: true };
  const folder = verificationFolder(own.userId, d.auctionId);
  const paths = [d.vinPath, d.odometerPath];
  if (paths.some((p) => !CHALLENGE_PATH_RE.test(p) || !p.startsWith(`${folder}/`))) return { ok: false, error: "The photos didn't upload correctly. Take them again." };
  const times = await uploadedAt(folder, paths);
  if (!times) return { ok: false, error: "The photos didn't upload correctly. Take them again." };
  for (const p of paths) {
    const t = Date.parse(times.get(p)!);
    if (t < issued - 5_000 || t > expires + UPLOAD_GRACE_MS) {
      return { ok: false, error: "These photos weren't taken while the code was valid. Get a new code and take both photos again.", expired: true };
    }
  }
  await getAdminSupabase()
    .from("listing_verifications")
    .update({ vin_photo_path: d.vinPath, odometer_photo_path: d.odometerPath, photos_code: v.challenge_code, photos_taken_at: new Date().toISOString() })
    .eq("auction_id", d.auctionId);
  refresh(d.auctionId);
  return { ok: true, message: "Photos saved. Submit for checking when everything required is added." };
}

/**
 * "Submit for checking": runs the checks on what the seller added. Every required input
 * must be in (the identity at least submitted to Stripe), and something must have changed
 * since the last check (or there wasn't one, or it didn't finish).
 */
export async function submitForChecking(input: unknown): Promise<VerifyResult> {
  const parsed = auctionOnly.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This listing no longer exists." };
  const own = await ownDraft(parsed.data.auctionId);
  if ("ok" in own) return own;
  const v = own.v;
  if (!readyForChecks(v)) return { ok: false, error: "Add every required item first." };
  const { data: me } = await getAdminSupabase().from("profiles").select("identity_status").eq("id", own.userId).maybeSingle<{ identity_status: string }>();
  if (!identityAdded(me?.identity_status ?? "none")) return { ok: false, error: "Start the identity check first." };
  const newer = (a: string | null) => Boolean(a && v.checked_at && Date.parse(a) > Date.parse(v.checked_at));
  if (v.checked_at && !newer(v.documents_uploaded_at) && !newer(v.photos_taken_at)) {
    return { ok: false, error: "Nothing has changed since the last check." };
  }
  const result = await maybeRun(parsed.data.auctionId);
  refresh(parsed.data.auctionId);
  return result;
}

/** Stripe Identity: a document and a selfie on Stripe's page, once per member. `returnTo`: where to come back. */
export async function verifyIdentity(input?: unknown): Promise<VerifyResult> {
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return SESSION_EXPIRED;
  const returnTo = z.object({ returnTo: z.string().max(200) }).safeParse(input);
  const r = await startIdentityVerification(getAdminSupabase(), user.id, returnTo.success ? returnTo.data.returnTo : undefined);
  if ("error" in r) return { ok: false, error: r.error };
  // The browser goes to Stripe's page itself (a full page load there and back).
  return { ok: true, message: "Opening Stripe…", url: r.url };
}
