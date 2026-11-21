// Test data. Every test creates the users and auctions it needs, so tests never
// depend on each other. Everything is written with the service role into the
// local test database only.
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { adminDb, userDb } from "./supabase";
import { PASSWORD } from "./env";

const db = adminDb();
const H = 3_600_000;
export const iso = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString();
export const HOUR = H;
export const DAY = 24 * H;

let counter = 0;
const unique = () => `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export interface TestUser {
  id: string;
  email: string;
  username: string | null;
  password: string;
}

export interface UserOptions {
  /** Username and country set (default true). */
  complete?: boolean;
  role?: "user" | "seller" | "admin";
  country?: string;
  /** Accepted the current bidding terms (default true for complete profiles). */
  terms?: boolean;
  /** Passed a card hold before (default false). */
  verifiedBidder?: boolean;
  fullName?: string;
  phone?: string;
  usernamePrefix?: string;
}

let termsVersion: string | null = null;
export async function currentTermsVersion(): Promise<string> {
  if (!termsVersion) {
    const { data, error } = await db.rpc("current_bidding_terms_version");
    if (error) throw error;
    termsVersion = String(data);
  }
  return termsVersion;
}

/** A new confirmed user with a password (sign-in for tests) and the given profile. */
export async function createUser(o: UserOptions = {}): Promise<TestUser> {
  const id = unique();
  const email = `e2e-${id}@example.test`;
  const { data, error } = await db.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: o.fullName ?? "E2E Private Name" },
  });
  if (error || !data.user) throw error ?? new Error("createUser failed");
  const complete = o.complete ?? true;
  // Usernames: 3 to 24 letters, digits or underscores; the unique part is kept whole.
  const username = complete ? `${(o.usernamePrefix ?? "e2e").slice(0, 8)}_${id}`.slice(0, 24) : null;
  const terms = o.terms ?? complete;
  const { error: pErr } = await db
    .from("profiles")
    .update({
      username,
      country: complete ? (o.country ?? "EE") : null,
      role: o.role ?? "user",
      full_name: o.fullName ?? "E2E Private Name",
      phone: o.phone ?? "+4915123456789",
      is_verified_bidder: o.verifiedBidder ?? false,
      ...(terms ? { bidding_terms_version: await currentTermsVersion(), bidding_terms_accepted_at: new Date().toISOString() } : {}),
    })
    .eq("id", data.user.id);
  if (pErr) throw pErr;
  return { id: data.user.id, email, username, password: PASSWORD };
}

/** 17 characters, no I/O/Q, unique per call. */
export function randomVin(prefix = "WBS"): string {
  const chars = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
  let v = prefix;
  while (v.length < 17) v += chars[Math.floor(Math.random() * chars.length)];
  return v;
}

let photoUrl: string | null = null;
/** A small image in the public photo bucket, shared by all test auctions. */
export async function testPhotoUrl(): Promise<string> {
  if (photoUrl) return photoUrl;
  const path = "e2e/test-photo.png";
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAFElEQVR4nGNkYPjPgAmYsIqRJAgAWPMBBawHlqUAAAAASUVORK5CYII=",
    "base64",
  );
  await db.storage.from("auction-photos").upload(path, png, { contentType: "image/png", upsert: true });
  photoUrl = db.storage.from("auction-photos").getPublicUrl(path).data.publicUrl;
  return photoUrl;
}

export type AuctionStatus = "draft" | "upcoming" | "live" | "ended" | "sold" | "reserve_not_met" | "rejected" | "withdrawn";

export interface AuctionOptions {
  seller: TestUser;
  status?: AuctionStatus;
  make?: string;
  model?: string;
  variant?: string | null;
  year?: number;
  mileageKm?: number;
  city?: string;
  country?: string;
  startsAt?: string | null;
  endsAt?: string | null;
  startingBid?: number;
  reserve?: number | null;
  condition?: "clean" | "restored_accident";
  damageSummary?: string | null;
  isDemo?: boolean;
  sellerType?: "private" | "dealer";
  dealerName?: string | null;
  dealerRegistryCode?: string | null;
  inspection?: { dealer: string; date: string; highlights: string[]; bySeller?: boolean; reportUrl?: string | null } | null;
  beforePhotos?: number;
  minIncrement?: number;
  extra?: Record<string, unknown>;
  /**
   * Drafts only: start with green fake-listing checks and a verified seller (default
   * true), so tests about other approval rules can approve them. false: no checks yet.
   */
  checks?: boolean;
}

export interface TestAuction {
  id: string;
  title: string;
  vin: string;
}

/** Inserts an auction (and its private row) directly, in any state. */
export async function createAuction(o: AuctionOptions): Promise<TestAuction> {
  const status = o.status ?? "live";
  const photo = await testPhotoUrl();
  const make = o.make ?? "BMW";
  const model = o.model ?? `M${Math.floor(Math.random() * 9000 + 1000)}`;
  const year = o.year ?? 2020;
  const title = [String(year), make, model, o.variant ?? null].filter(Boolean).join(" ");
  const scheduled = status !== "draft" && status !== "rejected";
  const startsAt =
    o.startsAt !== undefined ? o.startsAt : scheduled ? (status === "upcoming" ? iso(2 * DAY) : iso(-1 * DAY)) : null;
  const endsAt =
    o.endsAt !== undefined
      ? o.endsAt
      : scheduled
        ? status === "upcoming"
          ? iso(5 * DAY)
          : status === "live"
            ? iso(3 * DAY)
            : iso(-1 * HOUR)
        : null;
  const vin = randomVin();
  const restored = (o.condition ?? "clean") === "restored_accident";
  const { data, error } = await db
    .from("auctions")
    .insert({
      seller_id: o.seller.id,
      title,
      make,
      model,
      variant: o.variant ?? null,
      year,
      vin,
      mileage_km: o.mileageKm ?? 25_000,
      engine: "3.0 inline-6",
      transmission: "Automatic",
      drivetrain: "RWD",
      exterior_color: "Grey",
      location_city: o.city ?? "Tallinn",
      location_country: o.country ?? "EE",
      condition_type: o.condition ?? "clean",
      damage_history_summary: restored ? (o.damageSummary ?? "Front bumper repaired after a parking knock.") : null,
      gallery_urls: { exterior: [photo, photo, photo], interior: [photo], mechanical: [photo] },
      before_photos_urls: restored ? Array.from({ length: o.beforePhotos ?? 2 }, () => photo) : [],
      starting_bid: o.startingBid ?? 10_000,
      min_bid_increment: o.minIncrement ?? 250,
      has_reserve: o.reserve != null,
      starts_at: startsAt,
      ends_at: endsAt,
      status,
      is_demo: o.isDemo ?? false,
      seller_type: o.sellerType ?? "private",
      dealer_name: o.dealerName ?? null,
      dealer_registry_code: o.dealerRegistryCode ?? null,
      highlights: ["One owner", "Full service history", "Never tracked"],
      inspection_type: o.inspection ? "authorised_dealer" : null,
      inspection_partner_name: o.inspection?.dealer ?? null,
      inspection_date: o.inspection?.date ?? null,
      inspection_highlights: o.inspection?.highlights ?? [],
      inspected_by_seller: o.inspection?.bySeller ?? false,
      inspection_report_url: o.inspection?.reportUrl ?? null,
      ...(o.extra ?? {}),
    })
    .select("id")
    .single<{ id: string }>();
  if (error || !data) throw error ?? new Error("createAuction failed");
  const { error: pErr } = await db
    .from("auction_private")
    .upsert({ auction_id: data.id, reserve_price: o.reserve ?? null, requested_reserve: o.reserve ?? null });
  if (pErr) throw pErr;
  if (status === "draft" && o.checks !== false) {
    const { error: vErr } = await db
      .from("listing_verifications")
      .upsert({ auction_id: data.id, seller_id: o.seller.id, outcome: "green", checked_at: new Date().toISOString() });
    if (vErr) throw vErr;
    const { error: idErr } = await db
      .from("profiles")
      .update({ identity_status: "verified", identity_verified_name: "E2E Private Name", identity_verified_at: new Date().toISOString() })
      .eq("id", o.seller.id);
    if (idErr) throw idErr;
  }
  return { id: data.id, title, vin };
}

/** Gives a bidder an authorized €500 hold on one auction (as after a successful card check). */
export async function authorizeHold(user: TestUser, auctionId: string): Promise<string> {
  const pi = `pi_e2e${unique().replace(/[^A-Za-z0-9]/g, "")}`;
  const { error } = await db
    .from("bid_holds")
    .insert({ auction_id: auctionId, user_id: user.id, stripe_payment_intent_id: pi, amount: 500, status: "authorized" });
  if (error) throw error;
  await db.from("profiles").update({ is_verified_bidder: true }).eq("id", user.id);
  return pi;
}

/** Places a bid through place_bid as that user (RLS and every database rule apply). */
export async function bid(user: TestUser, auctionId: string, amount: number) {
  const client = await userDb(user.email);
  return client.rpc("place_bid", { p_auction_id: auctionId, p_amount: amount });
}

/** A bidder who is ready to bid on this auction: complete profile, terms, authorized hold. */
export async function readyBidder(auctionId: string, o: UserOptions = {}): Promise<TestUser> {
  const user = await createUser({ ...o, verifiedBidder: true });
  await authorizeHold(user, auctionId);
  return user;
}

export async function setAuction(id: string, values: Record<string, unknown>): Promise<void> {
  const { error } = await db.from("auctions").update(values).eq("id", id);
  if (error) throw error;
}

export async function setPrivate(id: string, values: Record<string, unknown>): Promise<void> {
  const { error } = await db.from("auction_private").update(values).eq("auction_id", id);
  if (error) throw error;
}

export async function getAuction<T = Record<string, unknown>>(id: string): Promise<T> {
  const { data, error } = await db.from("auctions").select("*").eq("id", id).single<T>();
  if (error || !data) throw error ?? new Error("auction not found");
  return data;
}

export async function getPrivate<T = Record<string, unknown>>(id: string): Promise<T> {
  const { data, error } = await db.from("auction_private").select("*").eq("auction_id", id).single<T>();
  if (error || !data) throw error ?? new Error("private row not found");
  return data;
}

export async function notificationsFor(user: TestUser, type?: string) {
  let q = db.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: true });
  if (type) q = q.eq("type", type);
  const { data, error } = await q;
  if (error) throw error;
  return data as { id: string; type: string; auction_id: string | null; read_at: string | null; data: Record<string, unknown> }[];
}

/** Runs one of the scheduled SQL jobs right now instead of waiting for pg_cron. */
export async function runJob(name: "advance_auction_states" | "notify_watch_ending_soon" | "inspection_decision_job" | "purge_old_conversations") {
  const { data, error } = await db.rpc(name);
  if (error) throw error;
  return data;
}

export function service(): SupabaseClient {
  return db;
}
