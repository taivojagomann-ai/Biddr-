"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { logAdminAction, requireAdmin } from "@/lib/admin";
import type { AdminResult } from "@/lib/admin-schemas";
import { ensureVerification, loadVerification, readyForChecks, runListingChecks } from "@/lib/listing-checks/run";

const NOT_ALLOWED: AdminResult = { ok: false, error: "You don't have access to do this. Sign in as an admin." };
const auctionOnly = z.object({ auctionId: z.string().uuid() });

function refresh(id: string) {
  revalidatePath(`/admin/auctions/${id}`);
  revalidatePath("/admin");
}

async function draft(ctx: NonNullable<Awaited<ReturnType<typeof requireAdmin>>>, auctionId: string) {
  const { data } = await ctx.db.from("auctions").select("id, status, seller_id").eq("id", auctionId).maybeSingle<{ id: string; status: string; seller_id: string }>();
  return data && data.status === "draft" ? data : null;
}

/**
 * The listing's content is approved: the seller is asked to verify their identity
 * (once per member). "Approve and schedule" still waits for it and for the checks.
 */
export async function approveContent(input: unknown): Promise<AdminResult> {
  const ctx = await requireAdmin();
  if (!ctx) return NOT_ALLOWED;
  const parsed = auctionOnly.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This listing no longer exists." };
  const a = await draft(ctx, parsed.data.auctionId);
  if (!a) return { ok: false, error: "This listing isn't waiting for review any more. Reload the page." };
  const v = await ensureVerification(ctx.db, a.id, a.seller_id);
  if (v.content_approved_at) return { ok: false, error: "The content is already approved." };
  await ctx.db.from("listing_verifications").update({ content_approved_at: new Date().toISOString(), content_approved_by: ctx.adminId }).eq("auction_id", a.id);
  const { data: seller } = await ctx.db.from("profiles").select("identity_status").eq("id", a.seller_id).maybeSingle<{ identity_status: string }>();
  const verified = seller?.identity_status === "verified";
  if (!verified) await ctx.db.from("notifications").insert({ user_id: a.seller_id, type: "identity_required", auction_id: a.id, data: {} });
  await logAdminAction(ctx, a.id, "checks.approve_content", { identity_requested: !verified });
  refresh(a.id);
  return { ok: true, message: verified ? "Content approved. The seller is already verified." : "Content approved. The seller is asked to verify their identity." };
}

const overrideSchema = auctionOnly.extend({
  reason: z.string().trim().min(10, "Give a reason (at least 10 characters).").max(1000, "Keep the reason under 1,000 characters."),
});

/** Accept a yellow or red result with a reason (logged). The seller's identity is still required to schedule. */
export async function overrideChecks(input: unknown): Promise<AdminResult> {
  const ctx = await requireAdmin();
  if (!ctx) return NOT_ALLOWED;
  const parsed = overrideSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue?.message ?? "Check the form.", fieldErrors: { reason: issue?.message ?? "" } };
  }
  const a = await draft(ctx, parsed.data.auctionId);
  if (!a) return { ok: false, error: "This listing isn't waiting for review any more. Reload the page." };
  const v = await loadVerification(ctx.db, a.id);
  if (!v || (v.outcome !== "yellow" && v.outcome !== "red" && v.outcome !== "pending")) {
    return { ok: false, error: "There's nothing to override: the checks are green." };
  }
  await ctx.db
    .from("listing_verifications")
    .update({
      override_at: new Date().toISOString(),
      override_by: ctx.adminId,
      override_reason: parsed.data.reason,
      override_outcome: v.outcome,
      needs_admin: false,
      on_hold: false,
    })
    .eq("auction_id", a.id);
  await logAdminAction(ctx, a.id, "checks.override", { outcome: v.outcome, reasons: v.outcome_reasons, reason: parsed.data.reason });
  refresh(a.id);
  return { ok: true, message: `Overridden: the ${v.outcome} result is accepted. It's logged with your reason.` };
}

/** Run the automated checks again (reads the photos and documents again: costs a few cents). */
export async function rerunChecks(input: unknown): Promise<AdminResult> {
  const ctx = await requireAdmin();
  if (!ctx) return NOT_ALLOWED;
  const parsed = auctionOnly.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This listing no longer exists." };
  const a = await draft(ctx, parsed.data.auctionId);
  if (!a) return { ok: false, error: "This listing isn't waiting for review any more. Reload the page." };
  const v = await loadVerification(ctx.db, a.id);
  if (!v || !readyForChecks(v)) return { ok: false, error: "The seller hasn't added the registration certificate and both photos yet." };
  const r = await runListingChecks(ctx.db, a.id, { reextract: true });
  if (!r.ok) return { ok: false, error: r.error };
  await logAdminAction(ctx, a.id, "checks.rerun", { outcome: r.outcome });
  refresh(a.id);
  return { ok: true, message: `Checks run again: ${r.outcome}.` };
}
