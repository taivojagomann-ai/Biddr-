"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { AdminResult } from "@/lib/admin-schemas";
import { loadVerification, runListingChecks } from "@/lib/listing-checks/run";
import { CHECKED_COLUMNS, diffColumns, parseDetailsEdit, parseListingEdit, parsePriceEdit, retitle, type FieldErrors } from "@/lib/seller-edit";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";

const idSchema = z.object({ auctionId: z.string().uuid("This link is broken. Reload the page.") });
const LOCKED = "This listing can't be changed any more. If something is wrong, write to Biddr.";
const FAILED = "That didn't save. Check your connection and try again.";

type Own = { userId: string; auction: Record<string, unknown> & { id: string; condition_type: string } };

/** The signed-in seller's own listing, still in review. */
async function ownListing(input: unknown): Promise<Own | AdminResult> {
  const parsed = idSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "This listing no longer exists." };
  const { data: { user } } = await getServerSupabase().auth.getUser();
  if (!user) return { ok: false, error: "Your session has expired. Sign in again." };
  const { data: auction } = await getAdminSupabase()
    .from("auctions")
    .select("*")
    .eq("id", parsed.data.auctionId)
    .eq("seller_id", user.id)
    .maybeSingle<Record<string, unknown> & { id: string; status: string; condition_type: string }>();
  if (!auction) return { ok: false, error: "This listing no longer exists." };
  if (auction.status !== "draft") return { ok: false, error: LOCKED };
  return { userId: user.id, auction };
}

function invalid(errors: FieldErrors): AdminResult {
  return { ok: false, error: Object.values(errors)[0] ?? "Check the form.", fieldErrors: errors };
}

/**
 * Saves what changed, records it for the admins, runs the comparisons again when a
 * checked value changed (no new API calls: the photos and documents were read already),
 * and undoes the content approval, so Biddr's team reviews the listing again.
 */
async function save(own: Own, auctionChanges: Record<string, unknown>, privateChanges: Record<string, unknown> = {}, currentPrivate: Record<string, unknown> = {}): Promise<AdminResult> {
  const db = getAdminSupabase();
  const changes = diffColumns(own.auction, auctionChanges);
  const title = retitle(own.auction, changes);
  if (title !== null && title !== own.auction.title) changes.title = { from: own.auction.title, to: title };
  const privChanges = diffColumns(currentPrivate, privateChanges);
  if (!Object.keys(changes).length && !Object.keys(privChanges).length) return { ok: true, message: "Nothing changed." };

  if (Object.keys(changes).length) {
    const update = Object.fromEntries(Object.entries(changes).map(([k, c]) => [k, c.to]));
    const { data, error } = await db.from("auctions").update(update).eq("id", own.auction.id).eq("seller_id", own.userId).eq("status", "draft").select("id");
    if (error) {
      if (error.code === "23505") return invalid({ vin: "Another listing with this VIN is already on Biddr or waiting for review." });
      console.error("seller edit: update failed", error);
      return { ok: false, error: FAILED };
    }
    if (!data?.length) return { ok: false, error: LOCKED };
  }
  if (Object.keys(privChanges).length) {
    const update = Object.fromEntries(Object.entries(privChanges).map(([k, c]) => [k, c.to]));
    const { error } = await db.from("auction_private").update(update).eq("auction_id", own.auction.id);
    if (error) {
      console.error("seller edit: private update failed", error);
      return { ok: false, error: FAILED };
    }
  }

  const v = await loadVerification(db, own.auction.id);
  const approvalUndone = Boolean(v?.content_approved_at);
  if (approvalUndone) {
    await db.from("listing_verifications").update({ content_approved_at: null, content_approved_by: null }).eq("auction_id", own.auction.id);
    const { data: admins } = await db.from("profiles").select("id").eq("role", "admin").returns<{ id: string }[]>();
    const rows = (admins ?? []).filter((a) => a.id !== own.userId).map((a) => ({ user_id: a.id, type: "listing_edited", auction_id: own.auction.id, actor_id: own.userId, data: {} }));
    if (rows.length) await db.from("notifications").insert(rows);
  }

  let outcome: string | null = null;
  const recheck = Boolean(v?.extracted) && Object.keys(changes).some((k) => CHECKED_COLUMNS.includes(k));
  if (recheck) {
    try {
      const r = await runListingChecks(db, own.auction.id, { reextract: false });
      if (r.ok) outcome = r.outcome;
    } catch (e) {
      console.error("seller edit: checks failed", own.auction.id, e);
    }
  }

  await db.from("listing_edits").insert({
    auction_id: own.auction.id,
    seller_id: own.userId,
    changes: { ...changes, ...privChanges },
    rechecked: outcome !== null,
    approval_undone: approvalUndone,
  });

  revalidatePath("/account/listings");
  revalidatePath(`/account/listings/${own.auction.id}/edit`);
  revalidatePath(`/account/listings/${own.auction.id}/verify`);
  revalidatePath(`/auctions/${own.auction.id}`);
  revalidatePath(`/admin/auctions/${own.auction.id}`);

  const parts = ["Changes saved."];
  if (outcome === "green") parts.push("The automated checks passed with the new details.");
  else if (outcome === "red") parts.push("Something still doesn't match the photos or the registration certificate: see Verify your car.");
  else if (outcome === "yellow") parts.push("Biddr's team will take a closer look at the details.");
  if (approvalUndone) parts.push("Biddr's team will review the listing again.");
  return { ok: true, message: parts.join(" ") };
}

export async function updateMyListing(input: unknown): Promise<AdminResult> {
  const own = await ownListing(input);
  if ("ok" in own) return own;
  const parsed = parseListingEdit(input, own.auction.condition_type === "restored_accident");
  if (!parsed.ok) return invalid(parsed.errors);
  return save(own, parsed.columns);
}

export async function updateMyDetails(input: unknown): Promise<AdminResult> {
  const own = await ownListing(input);
  if ("ok" in own) return own;
  const parsed = parseDetailsEdit(input);
  if (!parsed.ok) return invalid(parsed.errors);
  return save(own, parsed.columns);
}

export async function updateMyPrice(input: unknown): Promise<AdminResult> {
  const own = await ownListing(input);
  if ("ok" in own) return own;
  const parsed = parsePriceEdit(input);
  if (!parsed.ok) return invalid(parsed.errors);
  const { data: priv } = await getAdminSupabase().from("auction_private").select("requested_reserve").eq("auction_id", own.auction.id).maybeSingle<{ requested_reserve: number | null }>();
  return save(own, { starting_bid: parsed.startingBid, has_reserve: parsed.reserve !== null }, { requested_reserve: parsed.reserve }, { requested_reserve: priv?.requested_reserve ?? null });
}
