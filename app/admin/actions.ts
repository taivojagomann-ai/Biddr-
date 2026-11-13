"use server";
import { revalidatePath } from "next/cache";
import type { z } from "zod";
import { logAdminAction, requireAdmin, type AdminContext } from "@/lib/admin";
import {
  DB_ERROR_MESSAGES,
  INSPECTION_BUCKET,
  MAX_AUCTION_MS,
  adminDetailsSchema,
  commentDeleteSchema,
  editorTakeSchema,
  extendSchema,
  fieldErrorsOf,
  inspectionSchema,
  listingSchema,
  photoActionSchema,
  pricingSchema,
  rejectSchema,
  reportSchema,
  scheduleSchema,
  auctionIdSchema,
  type AdminResult,
} from "@/lib/admin-schemas";
import { formatBaltic, fromBalticInputs } from "@/lib/baltic-time";
import { releaseAuctionHolds } from "@/lib/holds";
import { detailsColumns } from "@/lib/listing-details";
import { PHOTO_BUCKET, publicBucketPrefix } from "@/lib/sell";
import type { Auction, AuctionStatus, GalleryUrls } from "@/lib/types";

// -----------------------------------------------------------------------------
// Helpers (not exported: a "use server" file may only export async actions)
// -----------------------------------------------------------------------------
const NOT_ALLOWED: AdminResult = { ok: false, error: "You don't have access to do this. Sign in as an admin." };
const STALE: AdminResult = {
  ok: false,
  error: "This auction changed while you were looking at it. Reload the page and try again.",
};
const FAILED_MSG = "That didn't save. Check your connection and try again.";
const NOT_FOUND: AdminResult = { ok: false, error: "This auction no longer exists." };

type Guarded<T> = { ctx: AdminContext; data: T } | { result: AdminResult };

/** requireAdmin() first, then validate. Nothing touches the database before both pass. */
async function guard<S extends z.ZodTypeAny>(schema: S, input: unknown): Promise<Guarded<z.output<S>>> {
  const ctx = await requireAdmin();
  if (!ctx) return { result: NOT_ALLOWED };
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors = fieldErrorsOf(parsed.error);
    return { result: { ok: false, error: Object.values(fieldErrors)[0] ?? "Check the form.", fieldErrors } };
  }
  return { ctx, data: parsed.data };
}

function dbMessage(error: { message?: string; code?: string } | null): string {
  if (!error) return FAILED_MSG;
  const known = error.message ? DB_ERROR_MESSAGES[error.message] : undefined;
  if (known) return known;
  if (error.code === "23514") {
    return "A restored car that is scheduled or live needs an inspection partner and a report PDF.";
  }
  console.error("admin db error", error);
  return FAILED_MSG;
}

type AuctionRow = Pick<
  Auction,
  | "id" | "status" | "seller_id" | "title" | "condition_type" | "starts_at" | "ends_at" | "starting_bid"
  | "min_bid_increment" | "gallery_urls" | "before_photos_urls" | "inspection_partner_name"
  | "inspection_report_url" | "bid_count"
>;

async function loadAuction(ctx: AdminContext, auctionId: string): Promise<AuctionRow | null> {
  const { data } = await ctx.db
    .from("auctions")
    .select(
      "id,status,seller_id,title,condition_type,starts_at,ends_at,starting_bid,min_bid_increment,gallery_urls,before_photos_urls,inspection_partner_name,inspection_report_url,bid_count",
    )
    .eq("id", auctionId)
    .maybeSingle<AuctionRow>();
  return data ?? null;
}

function refresh(auctionId: string) {
  revalidatePath("/admin");
  revalidatePath(`/admin/auctions/${auctionId}`);
  revalidatePath(`/auctions/${auctionId}`);
  revalidatePath("/account/listings");
  revalidatePath("/");
}

/** Conditional status change: only succeeds if the row still has one of the expected statuses. */
async function changeStatus(
  ctx: AdminContext,
  auctionId: string,
  from: AuctionStatus[],
  to: AuctionStatus,
): Promise<"ok" | "stale" | { error: string }> {
  const { data, error } = await ctx.db
    .from("auctions")
    .update({ status: to })
    .eq("id", auctionId)
    .in("status", from)
    .select("id");
  if (error) return { error: dbMessage(error) };
  return data && data.length > 0 ? "ok" : "stale";
}

// -----------------------------------------------------------------------------
// Listing
// -----------------------------------------------------------------------------
export async function updateListing(input: unknown): Promise<AdminResult> {
  const g = await guard(listingSchema, input);
  if ("result" in g) return g.result;
  const { ctx, data: v } = g;
  const auction = await loadAuction(ctx, v.auctionId);
  if (!auction) return NOT_FOUND;
  if (auction.condition_type === "restored_accident" && !v.damageSummary) {
    return { ok: false, error: "Restored cars need a damage and repair summary.", fieldErrors: { damageSummary: "Restored cars need a damage and repair summary." } };
  }

  const changes = {
    title: v.title,
    variant: v.variant,
    engine: v.engine,
    transmission: v.transmission,
    drivetrain: v.drivetrain,
    exterior_color: v.exteriorColor,
    mileage_km: v.mileageKm,
    location_city: v.city,
    location_country: v.country,
    damage_history_summary: v.damageSummary,
    video_url: v.videoUrl,
    body_style: v.bodyStyle,
    interior_color: v.interiorColor,
    owner_count: v.ownerCount,
    seller_type: v.sellerType,
    dealer_name: v.sellerType === "dealer" ? v.dealerName : null,
    dealer_registry_code: v.sellerType === "dealer" ? v.dealerRegistryCode : null,
    registration_country: v.registrationCountry,
    is_registered: v.isRegistered,
  };
  const { error } = await ctx.db.from("auctions").update(changes).eq("id", v.auctionId);
  if (error) return { ok: false, error: dbMessage(error) };

  await logAdminAction(ctx, v.auctionId, "listing.update", { changes });
  refresh(v.auctionId);
  return { ok: true, message: "Listing details saved." };
}

// -----------------------------------------------------------------------------
// Details lists and Biddr's take
// -----------------------------------------------------------------------------
export async function updateDetails(input: unknown): Promise<AdminResult> {
  const g = await guard(editorTakeSchema, input);
  if ("result" in g) return g.result;
  const { ctx, data: v } = g;

  const details = adminDetailsSchema.safeParse(input);
  if (!details.success) {
    const fieldErrors = fieldErrorsOf(details.error);
    return { ok: false, error: Object.values(fieldErrors)[0] ?? "Check the form.", fieldErrors };
  }

  const changes = { ...detailsColumns(details.data), editor_take: v.editorTake };
  const { data, error } = await ctx.db.from("auctions").update(changes).eq("id", v.auctionId).select("id");
  if (error) return { ok: false, error: dbMessage(error) };
  if (!data?.length) return NOT_FOUND;

  await logAdminAction(ctx, v.auctionId, "details.update", {
    highlights: changes.highlights.length,
    equipment: changes.equipment.length,
    modifications: changes.no_modifications ? "none" : changes.modifications.length,
    known_flaws: changes.no_known_flaws ? "none" : changes.known_flaws.length,
    service_history: changes.service_history.length,
    items_included: changes.items_included.length,
    seller_notes: changes.seller_notes ? changes.seller_notes.length : 0,
    editor_take: changes.editor_take,
  });
  refresh(v.auctionId);
  return { ok: true, message: "Details saved." };
}

// -----------------------------------------------------------------------------
// Photos
// -----------------------------------------------------------------------------
function photoPath(url: string): string | null {
  const prefix = publicBucketPrefix(process.env.NEXT_PUBLIC_SUPABASE_URL!);
  return url.startsWith(prefix) ? url.slice(prefix.length) : null;
}

export async function removePhoto(input: unknown): Promise<AdminResult> {
  const g = await guard(photoActionSchema, input);
  if ("result" in g) return g.result;
  const { ctx, data: v } = g;
  const auction = await loadAuction(ctx, v.auctionId);
  if (!auction) return NOT_FOUND;

  const gallery: GalleryUrls = { ...auction.gallery_urls };
  let before = [...auction.before_photos_urls];
  if (v.section === "before") {
    if (!before.includes(v.url)) return STALE;
    before = before.filter((u) => u !== v.url);
  } else {
    const list = gallery[v.section] ?? [];
    if (!list.includes(v.url)) return STALE;
    gallery[v.section] = list.filter((u) => u !== v.url);
  }

  const { error } = await ctx.db
    .from("auctions")
    .update({ gallery_urls: gallery, before_photos_urls: before })
    .eq("id", v.auctionId);
  if (error) return { ok: false, error: dbMessage(error) };

  // Also delete the file, so a removed photo (e.g. one showing a plate) stops being public.
  const path = photoPath(v.url);
  if (path) {
    const { error: storageError } = await ctx.db.storage.from(PHOTO_BUCKET).remove([path]);
    if (storageError) console.error("photo delete failed", storageError);
  }

  await logAdminAction(ctx, v.auctionId, "photo.remove", { section: v.section, url: v.url });
  refresh(v.auctionId);
  return { ok: true, message: "Photo removed." };
}

export async function makeCover(input: unknown): Promise<AdminResult> {
  const g = await guard(photoActionSchema, input);
  if ("result" in g) return g.result;
  const { ctx, data: v } = g;
  if (v.section !== "exterior") return { ok: false, error: "Only exterior photos can be the cover." };
  const auction = await loadAuction(ctx, v.auctionId);
  if (!auction) return NOT_FOUND;

  const exterior = auction.gallery_urls.exterior ?? [];
  if (!exterior.includes(v.url)) return STALE;
  const gallery: GalleryUrls = { ...auction.gallery_urls, exterior: [v.url, ...exterior.filter((u) => u !== v.url)] };

  const { error } = await ctx.db.from("auctions").update({ gallery_urls: gallery }).eq("id", v.auctionId);
  if (error) return { ok: false, error: dbMessage(error) };

  await logAdminAction(ctx, v.auctionId, "photo.cover", { url: v.url });
  refresh(v.auctionId);
  return { ok: true, message: "Cover photo changed." };
}

// -----------------------------------------------------------------------------
// Inspection
// -----------------------------------------------------------------------------
export async function saveInspection(input: unknown): Promise<AdminResult> {
  const g = await guard(inspectionSchema, input);
  if ("result" in g) return g.result;
  const { ctx, data: v } = g;
  const changes = {
    inspection_partner_name: v.partnerName,
    inspection_date: v.inspectionDate,
    inspection_highlights: v.highlights,
  };
  const { data, error } = await ctx.db.from("auctions").update(changes).eq("id", v.auctionId).select("id");
  if (error) return { ok: false, error: dbMessage(error) };
  if (!data?.length) return NOT_FOUND;

  await logAdminAction(ctx, v.auctionId, "inspection.update", changes);
  refresh(v.auctionId);
  return { ok: true, message: "Inspection details saved." };
}

export async function saveInspectionReport(input: unknown): Promise<AdminResult> {
  const g = await guard(reportSchema, input);
  if ("result" in g) return g.result;
  const { ctx, data: v } = g;
  const [folder, file] = v.path.split("/");
  if (folder !== v.auctionId || !file) return { ok: false, error: "That file belongs to another auction. Upload it again." };

  // Make sure the upload really landed before pointing the listing at it.
  const { data: found, error: listError } = await ctx.db.storage.from(INSPECTION_BUCKET).list(folder, { search: file, limit: 1 });
  if (listError || !found?.some((o) => o.name === file)) {
    return { ok: false, error: "We couldn't find the uploaded PDF. Upload it again." };
  }

  const url = ctx.db.storage.from(INSPECTION_BUCKET).getPublicUrl(v.path).data.publicUrl;
  const { data, error } = await ctx.db
    .from("auctions")
    .update({ inspection_report_url: url })
    .eq("id", v.auctionId)
    .select("id");
  if (error) return { ok: false, error: dbMessage(error) };
  if (!data?.length) return NOT_FOUND;

  await logAdminAction(ctx, v.auctionId, "inspection.report", { url });
  refresh(v.auctionId);
  return { ok: true, message: "Inspection report attached." };
}

// -----------------------------------------------------------------------------
// Pricing and schedule
// -----------------------------------------------------------------------------
export async function savePricing(input: unknown): Promise<AdminResult> {
  const g = await guard(pricingSchema, input);
  if ("result" in g) return g.result;
  const { ctx, data: v } = g;
  const auction = await loadAuction(ctx, v.auctionId);
  if (!auction) return NOT_FOUND;

  const editable = auction.status === "draft" || auction.status === "upcoming";
  const bidTermsChanged = v.startingBid !== auction.starting_bid || v.minIncrement !== auction.min_bid_increment;
  if (!editable && bidTermsChanged) {
    return { ok: false, error: "Bidding has opened, so the starting bid and increment can't change. You can still lower or remove the reserve." };
  }

  // Reserve first: the function locks the row and enforces the live-auction rules.
  const { error: reserveError } = await ctx.db.rpc("admin_set_reserve", { p_auction_id: v.auctionId, p_reserve: v.reserve });
  if (reserveError) return { ok: false, error: dbMessage(reserveError), fieldErrors: { reserve: dbMessage(reserveError) } };

  if (editable && bidTermsChanged) {
    const { data, error } = await ctx.db
      .from("auctions")
      .update({ starting_bid: v.startingBid, min_bid_increment: v.minIncrement })
      .eq("id", v.auctionId)
      .in("status", ["draft", "upcoming"])
      .select("id");
    if (error) return { ok: false, error: dbMessage(error) };
    if (!data?.length) return STALE;
  }

  await logAdminAction(ctx, v.auctionId, "pricing.update", {
    starting_bid: v.startingBid,
    min_bid_increment: v.minIncrement,
    reserve: v.reserve,
  });
  refresh(v.auctionId);
  return { ok: true, message: v.reserve === null ? "Pricing saved, with no reserve." : "Pricing and reserve saved." };
}

export async function saveSchedule(input: unknown): Promise<AdminResult> {
  const g = await guard(scheduleSchema, input);
  if ("result" in g) return g.result;
  const { ctx, data: v } = g;
  const auction = await loadAuction(ctx, v.auctionId);
  if (!auction) return NOT_FOUND;
  if (auction.status !== "draft" && auction.status !== "upcoming") {
    return { ok: false, error: "Use Extend end time to change a live auction." };
  }

  const { error } = await ctx.db.rpc("admin_set_schedule", {
    p_auction_id: v.auctionId,
    p_starts_at: v.startsAt,
    p_ends_at: v.endsAt,
  });
  if (error) return { ok: false, error: dbMessage(error) };

  await logAdminAction(ctx, v.auctionId, "schedule.update", { starts_at: v.startsAt, ends_at: v.endsAt });
  refresh(v.auctionId);
  return { ok: true, message: `Schedule saved: ${formatBaltic(v.startsAt)} to ${formatBaltic(v.endsAt)}, Baltic time.` };
}

export async function extendAuction(input: unknown): Promise<AdminResult> {
  const g = await guard(extendSchema, input);
  if ("result" in g) return g.result;
  const { ctx, data: v } = g;
  const auction = await loadAuction(ctx, v.auctionId);
  if (!auction) return NOT_FOUND;
  if (auction.status !== "live" || !auction.ends_at || !auction.starts_at) {
    return { ok: false, error: "Only live auctions can be extended." };
  }

  const current = Date.parse(auction.ends_at);
  const newEnd =
    v.mode === "1h"
      ? new Date(current + 60 * 60 * 1000).toISOString()
      : v.mode === "1d"
        ? new Date(current + 24 * 60 * 60 * 1000).toISOString()
        : fromBalticInputs(v.date ?? "", v.time ?? "");
  if (!newEnd) return { ok: false, error: "Enter a valid new end date and time." };

  const { error } = await ctx.db.rpc("admin_set_schedule", {
    p_auction_id: v.auctionId,
    p_starts_at: auction.starts_at,
    p_ends_at: newEnd,
  });
  if (error) return { ok: false, error: dbMessage(error) };

  await logAdminAction(ctx, v.auctionId, "schedule.extend", { from: auction.ends_at, to: newEnd, mode: v.mode });
  refresh(v.auctionId);
  const longRun = Date.parse(newEnd) - Date.parse(auction.starts_at) > MAX_AUCTION_MS;
  return {
    ok: true,
    message: `The auction now ends ${formatBaltic(newEnd)}, Baltic time.${
      longRun ? " It now runs longer than 7 days, so some card holds may expire before it closes." : ""
    }`,
  };
}

// -----------------------------------------------------------------------------
// Status changes
// -----------------------------------------------------------------------------
export async function approveAuction(input: unknown): Promise<AdminResult> {
  const g = await guard(auctionIdSchema, input);
  if ("result" in g) return g.result;
  const { ctx, data: v } = g;
  const a = await loadAuction(ctx, v.auctionId);
  if (!a) return NOT_FOUND;
  if (a.status !== "draft") return STALE;

  const missing: string[] = [];
  if (!a.starts_at || !a.ends_at) missing.push("save a start and end time");
  else if (Date.parse(a.ends_at) <= Date.now()) missing.push("move the end time into the future");
  else if (Date.parse(a.ends_at) - Date.parse(a.starts_at) > MAX_AUCTION_MS) missing.push("shorten the auction to 7 days or less");
  if (!a.gallery_urls.exterior?.length) missing.push("keep at least one exterior photo for the cover");
  if (a.condition_type === "restored_accident" && (!a.inspection_partner_name || !a.inspection_report_url)) {
    missing.push("add the inspection partner and report PDF (required for restored cars)");
  }
  if (missing.length) return { ok: false, error: `Before approving, ${missing.join(", and ")}.` };

  const changed = await changeStatus(ctx, v.auctionId, ["draft"], "upcoming");
  if (changed === "stale") return STALE;
  if (changed !== "ok") return { ok: false, error: changed.error };

  await logAdminAction(ctx, v.auctionId, "status.approve", { starts_at: a.starts_at, ends_at: a.ends_at });
  refresh(v.auctionId);
  const startsNow = a.starts_at !== null && Date.parse(a.starts_at) <= Date.now();
  return {
    ok: true,
    message: startsNow
      ? "Approved. Bidding opens within a minute."
      : `Approved. Bidding opens ${formatBaltic(a.starts_at)}, Baltic time.`,
  };
}

export async function rejectAuction(input: unknown): Promise<AdminResult> {
  const g = await guard(rejectSchema, input);
  if ("result" in g) return g.result;
  const { ctx, data: v } = g;
  const a = await loadAuction(ctx, v.auctionId);
  if (!a) return NOT_FOUND;
  if (a.status !== "draft") return STALE;

  const { error: reasonError } = await ctx.db
    .from("auction_private")
    .upsert({ auction_id: v.auctionId, rejection_reason: v.reason }, { onConflict: "auction_id" });
  if (reasonError) return { ok: false, error: dbMessage(reasonError) };

  const changed = await changeStatus(ctx, v.auctionId, ["draft"], "rejected");
  if (changed === "stale") return STALE;
  if (changed !== "ok") return { ok: false, error: changed.error };

  await logAdminAction(ctx, v.auctionId, "status.reject", { reason: v.reason });
  refresh(v.auctionId);
  return { ok: true, message: "Listing rejected. The seller sees your reason under My listings." };
}

export async function moveBackToReview(input: unknown): Promise<AdminResult> {
  const g = await guard(auctionIdSchema, input);
  if ("result" in g) return g.result;
  const { ctx, data: v } = g;
  const changed = await changeStatus(ctx, v.auctionId, ["upcoming"], "draft");
  if (changed === "stale") return { ok: false, error: "It's no longer scheduled; bidding may have opened. Reload the page." };
  if (changed !== "ok") return { ok: false, error: changed.error };

  await logAdminAction(ctx, v.auctionId, "status.back_to_review");
  refresh(v.auctionId);
  return { ok: true, message: "Moved back to review. It won't go live until you approve it again." };
}

export async function withdrawAuction(input: unknown): Promise<AdminResult> {
  const g = await guard(auctionIdSchema, input);
  if ("result" in g) return g.result;
  const { ctx, data: v } = g;
  const a = await loadAuction(ctx, v.auctionId);
  if (!a) return NOT_FOUND;
  if (a.status !== "upcoming" && a.status !== "live") return STALE;

  // Guarded on the status we just read, so it can't race the close job.
  const changed = await changeStatus(ctx, v.auctionId, [a.status], "withdrawn");
  if (changed === "stale") return STALE;
  if (changed !== "ok") return { ok: false, error: changed.error };

  const holds = await releaseAuctionHolds(ctx.db, v.auctionId);
  await logAdminAction(ctx, v.auctionId, "status.withdraw", { from: a.status, bid_count: a.bid_count, holds });
  refresh(v.auctionId);

  const holdNote =
    holds.failed !== 0
      ? " Some card holds couldn't be released right now. The hold release job retries them; check Stripe if they stay."
      : holds.released > 0
        ? ` ${holds.released} card ${holds.released === 1 ? "hold was" : "holds were"} released.`
        : "";
  return { ok: true, message: `Auction withdrawn. No one wins the car.${holdNote}` };
}

// -----------------------------------------------------------------------------
// Comments
// -----------------------------------------------------------------------------
export async function deleteComment(input: unknown): Promise<AdminResult> {
  const g = await guard(commentDeleteSchema, input);
  if ("result" in g) return g.result;
  const { ctx, data: v } = g;
  const { data, error } = await ctx.db
    .from("comments")
    .delete()
    .eq("id", v.commentId)
    .eq("auction_id", v.auctionId)
    .select("id, user_id, content");
  if (error) return { ok: false, error: dbMessage(error) };
  const removed = data?.[0] as { user_id: string; content: string } | undefined;
  if (!removed) return { ok: false, error: "That comment was already deleted." };

  await logAdminAction(ctx, v.auctionId, "comment.delete", {
    comment_id: v.commentId,
    user_id: removed.user_id,
    content: removed.content.slice(0, 500),
  });
  refresh(v.auctionId);
  return { ok: true, message: "Comment deleted." };
}
