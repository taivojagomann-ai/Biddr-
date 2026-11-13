import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { INSPECTION_BUCKET } from "@/lib/admin-schemas";
import { addDays, fromBalticInputs, toBalticInputs } from "@/lib/baltic-time";
import { PHOTO_BUCKET, listingTitle } from "@/lib/sell";
import type { AuctionStatus, ConditionType, Country, InspectionCity } from "@/lib/types";
import { renderDemoPhoto, renderDemoReportPdf } from "./assets";
import { generateBids } from "./bids";

// Everything demo lives under this folder in both buckets.
const DEMO_FOLDER = "demo";
const DEMO_EMAIL_RE = /^demo-[a-z0-9-]+@biddr\.invalid$/;
const PARTNER = "Demo inspection partner";
const MIN_INCREMENT = 250;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// -----------------------------------------------------------------------------
// People
// -----------------------------------------------------------------------------
interface DemoPerson {
  key: string;
  email: string;
  username: string;
  country: Country;
  fullName: string;
}

const SELLER: DemoPerson = {
  key: "seller",
  email: "demo-seller@biddr.invalid",
  username: "tallinn_m_garage",
  country: "EE",
  fullName: "Demo seller",
};

const BIDDERS: DemoPerson[] = [
  { key: "b1", email: "demo-bidder-1@biddr.invalid", username: "riga_rs", country: "LV", fullName: "Demo bidder 1" },
  { key: "b2", email: "demo-bidder-2@biddr.invalid", username: "vilnius_gt", country: "LT", fullName: "Demo bidder 2" },
  { key: "b3", email: "demo-bidder-3@biddr.invalid", username: "amg_tartu", country: "EE", fullName: "Demo bidder 3" },
  { key: "b4", email: "demo-bidder-4@biddr.invalid", username: "kaunas_drive", country: "LT", fullName: "Demo bidder 4" },
  { key: "b5", email: "demo-bidder-5@biddr.invalid", username: "parnu_s", country: "EE", fullName: "Demo bidder 5" },
];

// -----------------------------------------------------------------------------
// Cars and scenarios
// -----------------------------------------------------------------------------
type Scenario = "closing_soon" | "reserve_not_met_yet" | "no_reserve_no_bids" | "upcoming" | "sold" | "ended_below_reserve";

interface CarSpec {
  scenario: Scenario;
  make: string;
  model: string;
  variant: string;
  year: number;
  wmi: string; // first 3 VIN characters for the make
  mileageKm: number;
  engine: string;
  transmission: string;
  drivetrain: "RWD" | "AWD" | "FWD";
  color: string;
  city: string;
  country: Country;
  inspectionCity: InspectionCity;
  condition: ConditionType;
  damageSummary: string | null;
  startingBid: number;
  bids: number;
  highlights: string[];
}

const CARS: CarSpec[] = [
  {
    scenario: "closing_soon", make: "BMW", model: "M2", variant: "Competition", year: 2020, wmi: "WBS",
    mileageKm: 42_800, engine: "3.0 inline-6 twin-turbo, 410 hp", transmission: "6-speed manual", drivetrain: "RWD",
    color: "Hockenheim Silver", city: "Tallinn", country: "EE", inspectionCity: "Tallinn", condition: "clean",
    damageSummary: null, startingBid: 38_000, bids: 21,
    highlights: ["Paint thickness measured on all panels", "Clutch and flywheel within spec", "No fault codes stored", "Tyres 6 mm all round"],
  },
  {
    scenario: "reserve_not_met_yet", make: "Audi", model: "RS6", variant: "Avant", year: 2021, wmi: "WUA",
    mileageKm: 31_500, engine: "4.0 V8 twin-turbo, 600 hp", transmission: "8-speed automatic", drivetrain: "AWD",
    color: "Nardo Grey", city: "Riga", country: "LV", inspectionCity: "Riga", condition: "clean",
    damageSummary: null, startingBid: 88_000, bids: 6,
    highlights: ["Full Audi service history", "Brake discs and pads at 70%", "Air suspension holds height overnight"],
  },
  {
    scenario: "no_reserve_no_bids", make: "Porsche", model: "911", variant: "Carrera S", year: 2019, wmi: "WP0",
    mileageKm: 24_900, engine: "3.0 flat-6 twin-turbo, 450 hp", transmission: "8-speed PDK", drivetrain: "RWD",
    color: "Gentian Blue", city: "Vilnius", country: "LT", inspectionCity: "Vilnius", condition: "clean",
    damageSummary: null, startingBid: 105_000, bids: 0,
    highlights: ["PDK serviced at 20,000 km", "Paint thickness measured on all panels", "No signs of track use"],
  },
  {
    scenario: "upcoming", make: "Mercedes-AMG", model: "C63 S", variant: "Coupe", year: 2018, wmi: "WDD",
    mileageKm: 58_700, engine: "4.0 V8 twin-turbo, 510 hp", transmission: "9-speed automatic", drivetrain: "RWD",
    color: "Selenite Grey", city: "Tartu", country: "EE", inspectionCity: "Tallinn", condition: "clean",
    damageSummary: null, startingBid: 52_000, bids: 0,
    highlights: ["Spark plugs and coils replaced at 55,000 km", "Rear tyres new in 2026", "No oil leaks found"],
  },
  {
    scenario: "sold", make: "BMW", model: "M3", variant: "Competition", year: 2022, wmi: "WBS",
    mileageKm: 19_800, engine: "3.0 inline-6 twin-turbo, 510 hp", transmission: "8-speed automatic", drivetrain: "RWD",
    color: "Isle of Man Green", city: "Kaunas", country: "LT", inspectionCity: "Vilnius", condition: "restored_accident",
    damageSummary:
      "Front-left impact at low speed in 2024. Bonnet, left wing, headlight and radiator replaced with new BMW parts at a main-dealer body shop. Airbags did not deploy. Wheel alignment checked after the repair.",
    startingBid: 62_000, bids: 17,
    highlights: ["Chassis measured within factory tolerance", "Paint thickness measured on all panels", "Repair invoices checked against the work", "No fault codes stored"],
  },
  {
    scenario: "ended_below_reserve", make: "Audi", model: "RS3", variant: "Sportback", year: 2017, wmi: "WUA",
    mileageKm: 67_400, engine: "2.5 inline-5 turbo, 400 hp", transmission: "7-speed S tronic", drivetrain: "AWD",
    color: "Catalunya Red", city: "Pärnu", country: "EE", inspectionCity: "Tallinn", condition: "clean",
    damageSummary: null, startingBid: 29_000, bids: 9,
    highlights: ["S tronic oil changed at 60,000 km", "Haldex serviced", "Small stone chips on the bonnet"],
  },
];

const PHOTO_SET = [
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ section: "exterior", n, caption: `EXTERIOR ${n}` })),
  ...[1, 2, 3, 4].map((n) => ({ section: "interior", n, caption: `INTERIOR ${n}` })),
  ...[1, 2].map((n) => ({ section: "mechanical", n, caption: `ENGINE AND UNDERSIDE ${n}` })),
  ...[1, 2].map((n) => ({ section: "before", n, caption: `BEFORE RESTORATION ${n}` })),
] as const;

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------
const VIN_CHARS = "ABCDEFGHJKLMNPRSTUVWXYZ0123456789";
function randomVin(wmi: string): string {
  let out = wmi;
  while (out.length < 17) out += VIN_CHARS[Math.floor(Math.random() * VIN_CHARS.length)];
  return out;
}

const floorTo = (n: number, step: number) => Math.floor(n / step) * step;
const ceilTo = (n: number, step: number) => Math.ceil(n / step) * step;

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

function fail(step: string, error: { message?: string } | null | undefined): never {
  throw new Error(`${step}: ${error?.message ?? "unknown error"}`);
}

interface Schedule {
  status: AuctionStatus;
  startsAt: number;
  endsAt: number;
}

/** All times are relative to `now`; "tomorrow 12:00" and "20:00" are Baltic time. */
function scheduleFor(scenario: Scenario, now: number): Schedule {
  const today = toBalticInputs(now).date;
  const at = (date: string, time: string) => Date.parse(fromBalticInputs(date, time) ?? "");
  const week = 7 * DAY;
  switch (scenario) {
    case "closing_soon": {
      const endsAt = now + 12 * MINUTE;
      return { status: "live", startsAt: endsAt - week, endsAt };
    }
    case "reserve_not_met_yet": {
      const endsAt = now + 26 * HOUR;
      return { status: "live", startsAt: endsAt - week, endsAt };
    }
    case "no_reserve_no_bids": {
      const endsAt = now + 3 * DAY;
      return { status: "live", startsAt: endsAt - week, endsAt };
    }
    case "upcoming":
      // Tomorrow 12:00 to 20:00 seven days from today: the same shape as the admin
      // preset, and within the 7-day card-hold limit.
      return { status: "upcoming", startsAt: at(addDays(today, 1), "12:00"), endsAt: at(addDays(today, 7), "20:00") };
    case "sold": {
      const endsAt = at(addDays(today, -1), "20:00");
      return { status: "sold", startsAt: endsAt - week, endsAt };
    }
    case "ended_below_reserve": {
      const endsAt = at(addDays(today, -3), "20:00");
      return { status: "reserve_not_met", startsAt: endsAt - week, endsAt };
    }
  }
}

/** Reserve that fits the scenario, given the final bid. null = no reserve. */
function reserveFor(scenario: Scenario, startingBid: number, finalBid: number | null): number | null {
  switch (scenario) {
    case "closing_soon":
    case "sold":
      return Math.max(startingBid, floorTo((finalBid ?? startingBid) * 0.9, 500)); // met
    case "reserve_not_met_yet":
    case "ended_below_reserve":
      return ceilTo((finalBid ?? startingBid) * 1.12, 1000); // above the high bid
    case "no_reserve_no_bids":
      return null;
    case "upcoming":
      return ceilTo(startingBid * 1.25, 1000);
  }
}

interface DemoComment {
  car: Scenario;
  by: string; // person key
  text: string;
  ago: number; // ms before `now` (live) or before `endsAt` (sold)
  replyTo?: number; // index into COMMENTS
}

const COMMENTS: DemoComment[] = [
  { car: "closing_soon", by: "b1", text: "When was the last service, and has the clutch ever been replaced?", ago: 2 * DAY },
  { car: "closing_soon", by: "seller", replyTo: 0, ago: 1.9 * DAY,
    text: "Oil service at 40,000 km at the BMW dealer in Tallinn, invoice is in the photos. Original clutch, no slipping." },
  { car: "closing_soon", by: "b2", text: "Which tyres are fitted, and how much tread is left?", ago: 4 * MINUTE },
  { car: "reserve_not_met_yet", by: "b3", text: "Do you have paint thickness readings for the bonnet and roof?", ago: 1.5 * DAY },
  { car: "reserve_not_met_yet", by: "seller", replyTo: 3, ago: 1.4 * DAY,
    text: "Yes, 95 to 120 microns on every panel. The full table is in the inspection highlights." },
  { car: "reserve_not_met_yet", by: "b4", text: "Are the ceramic brakes fitted, or the steel ones?", ago: 1.1 * DAY },
  { car: "no_reserve_no_bids", by: "b5", text: "Has the PDK had its fluid change yet?", ago: 1.2 * DAY },
  { car: "no_reserve_no_bids", by: "seller", replyTo: 6, ago: 1 * DAY, text: "Yes, at 20,000 km at Porsche Vilnius. Stamped in the book." },
  { car: "sold", by: "b2", text: "Who did the repair, and do you have the invoices?", ago: 2 * DAY },
  { car: "sold", by: "seller", replyTo: 8, ago: 1.9 * DAY,
    text: "A main-dealer body shop in Kaunas. All invoices and the parts list are with the inspection partner." },
  { car: "sold", by: "b3", text: "Did any airbags deploy?", ago: 1.5 * DAY },
  { car: "sold", by: "seller", replyTo: 10, ago: 1.4 * DAY, text: "No, none deployed. The inspection report confirms it." },
];

// -----------------------------------------------------------------------------
// Load
// -----------------------------------------------------------------------------
export interface DemoSummary {
  auctions: number;
  bids: number;
  comments: number;
  users: number;
  files: number;
}

async function createPeople(db: SupabaseClient): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const person of [SELLER, ...BIDDERS]) {
    const { data, error } = await db.auth.admin.createUser({
      email: person.email,
      email_confirm: true,
      user_metadata: { demo: true, full_name: person.fullName },
    });
    if (error || !data.user) fail(`Creating ${person.email}`, error);
    ids.set(person.key, data.user.id);

    // The sign-up trigger already made the profile; fill it in. Fall back to a
    // suffixed username if a real member already has this one.
    const profile = {
      is_demo: true,
      username: person.username,
      country: person.country,
      full_name: person.fullName,
      is_verified_bidder: true,
    };
    let { error: profileError } = await db.from("profiles").update(profile).eq("id", data.user.id);
    if (profileError?.code === "23505") {
      ({ error: profileError } = await db
        .from("profiles")
        .update({ ...profile, username: `${person.username}_demo`.slice(0, 24) })
        .eq("id", data.user.id));
    }
    if (profileError) fail(`Setting up the profile for ${person.email}`, profileError);
  }
  return ids;
}

export async function loadDemoData(db: SupabaseClient): Promise<DemoSummary> {
  const now = Date.now();
  await removeDemoData(db); // "Reset" = remove, then create again relative to now

  try {
    const people = await createPeople(db);
    const sellerId = people.get(SELLER.key)!;
    const bidderIds = BIDDERS.map((b) => people.get(b.key)!);

    // Render each placeholder photo once; every car gets its own copies.
    const photos = new Map<string, Buffer>();
    await Promise.all(PHOTO_SET.map(async (p) => photos.set(`${p.section}-${p.n}`, await renderDemoPhoto(p.caption))));

    let files = 0;
    let bidTotal = 0;
    const auctionIds = new Map<Scenario, { id: string; startsAt: number; endsAt: number }>();

    for (const car of CARS) {
      const id = randomUUID();
      const schedule = scheduleFor(car.scenario, now);
      const restored = car.condition === "restored_accident";

      // Photos
      const set = PHOTO_SET.filter((p) => p.section !== "before" || restored);
      const urls: Record<string, string[]> = { exterior: [], interior: [], mechanical: [], before: [] };
      const uploads = set.map((p) => ({ ...p, path: `${DEMO_FOLDER}/${id}/${p.section}/${p.n}.webp` }));
      await inBatches(uploads, 8, async (u) => {
        const { error } = await db.storage
          .from(PHOTO_BUCKET)
          .upload(u.path, photos.get(`${u.section}-${u.n}`)!, { contentType: "image/webp", upsert: true });
        if (error) fail(`Uploading ${u.path}`, error);
      });
      for (const u of uploads) urls[u.section]!.push(db.storage.from(PHOTO_BUCKET).getPublicUrl(u.path).data.publicUrl);
      files += uploads.length;

      // Inspection report (restored cars need one)
      let reportUrl: string | null = null;
      if (restored) {
        const path = `${DEMO_FOLDER}/${id}/report.pdf`;
        const title = listingTitle({ year: car.year, make: car.make, model: car.model, variant: car.variant });
        const { error } = await db.storage
          .from(INSPECTION_BUCKET)
          .upload(path, renderDemoReportPdf(title, car.highlights), { contentType: "application/pdf", upsert: true });
        if (error) fail("Uploading the demo inspection report", error);
        reportUrl = db.storage.from(INSPECTION_BUCKET).getPublicUrl(path).data.publicUrl;
        files += 1;
      }

      // Bids: after the start, before now (live) or a few minutes before the end (closed,
      // so no bid falls in the 2-minute extension window).
      const isLive = schedule.status === "live";
      const bids = generateBids({
        count: car.bids,
        startingBid: car.startingBid,
        minIncrement: MIN_INCREMENT,
        from: new Date(schedule.startsAt + 10 * MINUTE),
        to: new Date(isLive ? Math.min(schedule.endsAt, now) - MINUTE : schedule.endsAt - 3 * MINUTE),
        bidderCount: bidderIds.length,
      });
      const last = bids[bids.length - 1];
      const finalBid = last?.amount ?? null;
      const reserve = reserveFor(car.scenario, car.startingBid, finalBid);
      const reserveMet = bids.length > 0 && (reserve === null || (finalBid ?? 0) >= reserve);

      const inspectionDate = toBalticInputs(schedule.startsAt - 3 * DAY).date;
      const { error: auctionError } = await db.from("auctions").insert({
        id,
        is_demo: true,
        seller_id: sellerId,
        title: listingTitle({ year: car.year, make: car.make, model: car.model, variant: car.variant }),
        make: car.make,
        model: car.model,
        variant: car.variant,
        year: car.year,
        vin: randomVin(car.wmi),
        mileage_km: car.mileageKm,
        engine: car.engine,
        transmission: car.transmission,
        drivetrain: car.drivetrain,
        exterior_color: car.color,
        location_city: car.city,
        location_country: car.country,
        condition_type: car.condition,
        damage_history_summary: car.damageSummary,
        inspection_partner_name: PARTNER,
        inspection_report_url: reportUrl,
        inspection_date: inspectionDate,
        inspection_highlights: car.highlights,
        gallery_urls: { exterior: urls.exterior, interior: urls.interior, mechanical: urls.mechanical },
        before_photos_urls: urls.before,
        starting_bid: car.startingBid,
        min_bid_increment: MIN_INCREMENT,
        has_reserve: reserve !== null,
        reserve_met: reserveMet,
        current_bid: finalBid,
        bid_count: bids.length,
        leading_bidder_id: last ? bidderIds[last.bidderIndex] : null,
        starts_at: new Date(schedule.startsAt).toISOString(),
        ends_at: new Date(schedule.endsAt).toISOString(),
        status: schedule.status,
      });
      if (auctionError) fail(`Creating the ${car.year} ${car.make} ${car.model}`, auctionError);

      const { error: privateError } = await db.from("auction_private").insert({
        auction_id: id,
        reserve_price: reserve,
        requested_reserve: reserve,
        inspection_city: car.inspectionCity,
      });
      if (privateError) fail("Saving the reserve", privateError);

      if (bids.length) {
        const { error: bidsError } = await db.from("bids").insert(
          bids.map((b) => ({ auction_id: id, bidder_id: bidderIds[b.bidderIndex], amount: b.amount, created_at: b.at.toISOString() })),
        );
        if (bidsError) fail("Saving the bids", bidsError);
      }
      bidTotal += bids.length;
      auctionIds.set(car.scenario, { id, startsAt: schedule.startsAt, endsAt: schedule.endsAt });
    }

    // Comments, in order, so replies can point at their question.
    const commentIds: string[] = [];
    for (const c of COMMENTS) {
      const auction = auctionIds.get(c.car)!;
      const anchor = Math.min(now, auction.endsAt);
      const at = Math.max(auction.startsAt + MINUTE, anchor - c.ago);
      const { data, error } = await db
        .from("comments")
        .insert({
          auction_id: auction.id,
          user_id: people.get(c.by),
          parent_id: c.replyTo === undefined ? null : commentIds[c.replyTo],
          content: c.text,
          created_at: new Date(at).toISOString(),
        })
        .select("id")
        .single<{ id: string }>();
      if (error || !data) fail("Saving the comments", error);
      commentIds.push(data.id);
    }

    return { auctions: CARS.length, bids: bidTotal, comments: COMMENTS.length, users: people.size, files };
  } catch (e) {
    // Leave nothing half-made behind.
    await removeDemoData(db).catch(() => undefined);
    throw e;
  }
}

// -----------------------------------------------------------------------------
// Remove
// -----------------------------------------------------------------------------
async function listFiles(db: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const out: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await db.storage.from(bucket).list(prefix, { limit: 1000, offset });
    if (error) fail(`Listing ${bucket}/${prefix}`, error);
    for (const entry of data ?? []) {
      const path = `${prefix}/${entry.name}`;
      // Folders come back without an id.
      if (entry.id === null) out.push(...(await listFiles(db, bucket, path)));
      else out.push(path);
    }
    if (!data || data.length < 1000) return out;
  }
}

/** Removes only demo rows (is_demo = true), demo files under demo/, and demo auth users. */
export async function removeDemoData(db: SupabaseClient): Promise<DemoSummary> {
  // 1. Auctions first: bids, comments, holds and auction_private cascade with them.
  const { data: auctions, error: auctionError } = await db.from("auctions").delete().eq("is_demo", true).select("id, bid_count");
  if (auctionError) fail("Removing demo auctions", auctionError);

  // 2. Files under demo/ in both buckets.
  let files = 0;
  for (const bucket of [PHOTO_BUCKET, INSPECTION_BUCKET]) {
    const paths = await listFiles(db, bucket, DEMO_FOLDER);
    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await db.storage.from(bucket).remove(paths.slice(i, i + 100));
      if (error) fail(`Removing demo files from ${bucket}`, error);
    }
    files += paths.length;
  }

  // 3. Demo users (their profiles cascade). Normally found by profiles.is_demo; the
  //    auth listing also catches users from a load that stopped before the profile
  //    was flagged, matched strictly by the reserved .invalid domain and demo metadata.
  const ids = new Set<string>();
  const { data: profiles, error: profileError } = await db.from("profiles").select("id").eq("is_demo", true);
  if (profileError) fail("Finding demo users", profileError);
  for (const p of profiles ?? []) ids.add(p.id as string);
  for (let page = 1; ; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) fail("Listing users", error);
    for (const u of data.users) {
      if (u.email && DEMO_EMAIL_RE.test(u.email) && u.user_metadata?.demo === true) ids.add(u.id);
    }
    if (data.users.length < 1000) break;
  }
  for (const id of ids) {
    const { error } = await db.auth.admin.deleteUser(id);
    if (error) fail("Removing a demo user", error);
  }

  return {
    auctions: auctions?.length ?? 0,
    bids: (auctions ?? []).reduce((n, a) => n + Number((a as { bid_count: number }).bid_count ?? 0), 0),
    comments: 0,
    users: ids.size,
    files,
  };
}

/** How many demo auctions exist right now (decides between "Load" and "Reset"). */
export async function countDemoAuctions(db: SupabaseClient): Promise<number> {
  const { count } = await db.from("auctions").select("id", { count: "exact", head: true }).eq("is_demo", true);
  return count ?? 0;
}
