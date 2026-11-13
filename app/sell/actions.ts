"use server";
import { revalidatePath } from "next/cache";
import {
  PHOTO_SECTION_KEYS,
  draftFolder,
  listingTitle,
  parseSubmission,
  publicBucketPrefix,
  type PhotoSection,
  type SellErrors,
  type SubmitResult,
} from "@/lib/sell";
import { getAdminSupabase, getServerSupabase } from "@/lib/supabase/server";

const FILE_RE = /^[A-Za-z0-9-]{8,64}\.(webp|jpg)$/;

/** Every photo must be a public URL of our bucket inside <user id>/<draft id>/<section>/. */
function checkPhotoUrls(photos: Record<PhotoSection, string[]>, userId: string, draftId: string): SellErrors {
  const errors: SellErrors = {};
  const base = publicBucketPrefix(process.env.NEXT_PUBLIC_SUPABASE_URL!) + draftFolder(userId, draftId);
  const seen = new Set<string>();
  for (const section of PHOTO_SECTION_KEYS) {
    const prefix = `${base}${section}/`;
    for (const url of photos[section]) {
      const ok = url.startsWith(prefix) && FILE_RE.test(url.slice(prefix.length)) && !seen.has(url);
      seen.add(url);
      if (!ok) {
        errors[`photos.${section}`] = "One of these photos didn't upload correctly. Remove it and add it again.";
        break;
      }
    }
  }
  return errors;
}

export async function submitListing(input: unknown): Promise<SubmitResult> {
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Your session has expired. Sign in again; your answers are saved on this device." };

  const parsed = parseSubmission(input);
  if (!parsed.success) {
    return Object.keys(parsed.errors).length
      ? { ok: false, errors: parsed.errors }
      : { ok: false, error: "Something in the form is out of date. Reload the page and check each step." };
  }
  const v = parsed.data;

  const photoErrors = checkPhotoUrls(v.photos, user.id, v.draftId);
  if (Object.keys(photoErrors).length) return { ok: false, errors: photoErrors };

  // Normal server client: RLS ("sellers submit drafts") and the column grants apply.
  // status is not in the insert grant; it defaults to 'draft', which the policy requires.
  const { data: auction, error } = await supabase
    .from("auctions")
    .insert({
      seller_id: user.id,
      title: listingTitle(v),
      make: v.make,
      model: v.model,
      variant: v.variant,
      year: v.year,
      vin: v.vin,
      mileage_km: v.mileageKm,
      engine: v.engine,
      transmission: v.transmission,
      drivetrain: v.drivetrain,
      exterior_color: v.exteriorColor,
      location_city: v.city,
      location_country: v.country,
      condition_type: v.condition,
      damage_history_summary: v.damageSummary,
      gallery_urls: { exterior: v.photos.exterior, interior: v.photos.interior, mechanical: v.photos.mechanical },
      before_photos_urls: v.photos.before,
      video_url: v.videoUrl,
      starting_bid: v.startingBid,
    })
    .select("id, seller_id, status")
    .single<{ id: string; seller_id: string; status: string }>();

  if (error || !auction) {
    if (error?.code === "23505") {
      return { ok: false, errors: { vin: "This car is already listed or waiting for review." } };
    }
    console.error("sell: auction insert failed", error);
    return { ok: false, error: "We couldn't save your listing. Check your connection and try again." };
  }

  // Only after the seller's own insert succeeded, and only for that row.
  if (auction.seller_id !== user.id || auction.status !== "draft") {
    return { ok: false, error: "We couldn't save your listing. Try again." };
  }

  const admin = getAdminSupabase();
  const { error: privateError } = await admin.from("auction_private").insert({
    auction_id: auction.id,
    requested_reserve: v.reserve,
    inspection_city: v.inspectionCity,
    inspection_preferred_dates: v.inspectionDates,
  });

  // has_reserve is server-owned (not in the seller's column grant).
  const { error: reserveError } = privateError
    ? { error: null }
    : await admin
        .from("auctions")
        .update({ has_reserve: v.reserve !== null })
        .eq("id", auction.id)
        .eq("seller_id", user.id)
        .eq("status", "draft");

  if (privateError || reserveError) {
    console.error("sell: private data failed", privateError ?? reserveError);
    // Roll back so the VIN isn't blocked and the seller can simply submit again.
    await admin.from("auctions").delete().eq("id", auction.id).eq("seller_id", user.id).eq("status", "draft");
    return { ok: false, error: "We couldn't save your listing. Check your connection and try again." };
  }

  revalidatePath("/account/listings");
  return { ok: true, id: auction.id };
}
