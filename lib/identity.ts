import "server-only";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { rerunOwnerChecks } from "@/lib/listing-checks/run";
import { stripe } from "@/lib/stripe";
import { siteUrl } from "@/lib/site";

/**
 * Seller identity with Stripe Identity (DECISIONS.md point 16): asked for when a listing
 * is approved for scheduling, once per member and reused for later listings. Biddr keeps
 * only the status, the verified name, the document's country, when it was verified and
 * the Stripe session id; never document images or numbers (Stripe holds those).
 */

export type IdentityStatus = "none" | "pending" | "requires_input" | "verified" | "canceled";

export interface IdentityRow {
  identity_status: IdentityStatus;
  identity_verified_name: string | null;
  identity_document_country: string | null;
  identity_verified_at: string | null;
  identity_session_id: string | null;
}

export const IDENTITY_COLUMNS = "identity_status, identity_verified_name, identity_document_country, identity_verified_at, identity_session_id";

/** Starts a verification (a document and a matching selfie on Stripe's page) and returns where to send the member. */
export async function startIdentityVerification(db: SupabaseClient, userId: string): Promise<{ url: string } | { error: string }> {
  const { data: me } = await db.from("profiles").select(IDENTITY_COLUMNS).eq("id", userId).maybeSingle<IdentityRow>();
  if (me?.identity_status === "verified") return { error: "Your identity is already verified." };
  try {
    const session = await stripe.identity.verificationSessions.create({
      type: "document",
      options: { document: { require_matching_selfie: true, require_live_capture: true } },
      metadata: { user_id: userId },
      return_url: `${siteUrl()}/account/listings?identity=return`,
    });
    await db.from("profiles").update({ identity_status: "pending", identity_session_id: session.id }).eq("id", userId);
    if (!session.url) return { error: "Stripe didn't return a verification page. Try again." };
    return { url: session.url };
  } catch (e) {
    console.error("identity: couldn't start a verification", e);
    return { error: "The identity check couldn't start. Try again in a moment." };
  }
}

const NEXT_STATUS: Partial<Record<Stripe.Event.Type, IdentityStatus>> = {
  "identity.verification_session.processing": "pending",
  "identity.verification_session.requires_input": "requires_input",
  "identity.verification_session.canceled": "canceled",
  "identity.verification_session.verified": "verified",
};

/** Handles a Stripe Identity webhook event (see app/api/stripe/webhook). */
export async function handleIdentityEvent(db: SupabaseClient, event: Stripe.Event): Promise<void> {
  const status = NEXT_STATUS[event.type];
  if (!status) return;
  const object = event.data.object as Stripe.Identity.VerificationSession;
  const userId = object.metadata?.user_id;
  if (!userId || !/^[0-9a-f-]{36}$/i.test(userId)) return;

  if (status !== "verified") {
    // Never downgrade a member who is already verified (an old session's late event).
    const { error } = await db
      .from("profiles")
      .update({ identity_status: status, identity_session_id: object.id })
      .eq("id", userId)
      .neq("identity_status", "verified");
    if (error) throw new Error(error.message);
    return;
  }

  // Read the verified name and the document's country; nothing else is kept.
  const session = await stripe.identity.verificationSessions.retrieve(object.id, { expand: ["verified_outputs", "last_verification_report"] });
  const outputs = session.verified_outputs;
  const name = [outputs?.first_name, outputs?.last_name].filter(Boolean).join(" ").trim() || null;
  const report = session.last_verification_report;
  const country = typeof report === "object" && report ? (report.document?.issuing_country ?? null) : null;
  const { error } = await db
    .from("profiles")
    .update({
      identity_status: "verified",
      identity_verified_name: name,
      identity_document_country: country,
      identity_verified_at: new Date().toISOString(),
      identity_session_id: session.id,
    })
    .eq("id", userId);
  if (error) throw new Error(error.message);
  await db.from("notifications").insert({ user_id: userId, type: "identity_verified", data: {} });
  // The owner check waited for this: compare again with the verified name.
  await rerunOwnerChecks(db, userId);
}
