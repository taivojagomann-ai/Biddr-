// The seller corrects their listing while it's in review (DECISIONS.md point 17).
// The same rules as the sell form; photos aren't edited here (they are what the
// listing is checked against). No "use client": server actions import this.
import { z } from "zod";
import { detailsColumns, ownershipColumns, ownershipSchema } from "@/lib/listing-details";
import { MAX_PRICE, MIN_STARTING_BID, carSchema, listingTitle, normalizeVideoUrl, sellerDetailsSchema, wholeNumber } from "@/lib/sell";

export type FieldErrors = Record<string, string>;

function errorsOf(error: z.ZodError, into: FieldErrors) {
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !into[key]) into[key] = issue.message;
  }
}

const extraSchema = z.object({
  damageSummary: z.string().trim().max(4000, "Keep the summary under 4,000 characters."),
  videoUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || normalizeVideoUrl(v) !== null, "Paste a YouTube or Vimeo link, or leave this empty.")
    .transform((v) => (v === "" ? null : normalizeVideoUrl(v))),
});

/** The car and the listing's text: the auctions columns they write, or field errors. */
export function parseListingEdit(input: unknown, restored: boolean): { ok: true; columns: Record<string, unknown> } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  const car = carSchema.safeParse(input);
  const own = ownershipSchema.safeParse(input);
  const extra = extraSchema.safeParse(input);
  for (const r of [car, own, extra]) if (!r.success) errorsOf(r.error, errors);
  if (extra.success && restored && extra.data.damageSummary.length < 40) {
    errors.damageSummary ??= extra.data.damageSummary
      ? `Add a little more detail: at least 40 characters (now ${extra.data.damageSummary.length}).`
      : "Describe the damage and the repair.";
  }
  if (!car.success || !own.success || !extra.success || Object.keys(errors).length) return { ok: false, errors };
  const c = car.data;
  return {
    ok: true,
    columns: {
      make: c.make,
      make_other: c.makeOther,
      model: c.model,
      variant: c.variant,
      year: c.year,
      vin: c.vin,
      mileage_km: c.mileageKm,
      engine: c.engine,
      transmission: c.transmission,
      drivetrain: c.drivetrain,
      exterior_color: c.exteriorColor,
      location_city: c.city,
      location_country: c.country,
      damage_history_summary: restored ? extra.data.damageSummary : null,
      video_url: extra.data.videoUrl,
      ...ownershipColumns(own.data),
    },
  };
}

/** Highlights, equipment, flaws, service history and the rest: as in the sell form. */
export function parseDetailsEdit(input: unknown): { ok: true; columns: Record<string, unknown> } | { ok: false; errors: FieldErrors } {
  const r = sellerDetailsSchema.safeParse(input);
  if (!r.success) {
    const errors: FieldErrors = {};
    errorsOf(r.error, errors);
    return { ok: false, errors };
  }
  return { ok: true, columns: detailsColumns(r.data) };
}

const priceEditSchema = z
  .object({
    startingBid: wholeNumber(
      "Enter a starting bid.",
      MIN_STARTING_BID,
      MAX_PRICE,
      `The starting bid must be at least €${MIN_STARTING_BID.toLocaleString("en-IE")}.`,
    ),
    reserve: z
      .string()
      .transform((v) => v.replace(/[\s.,€]/g, ""))
      .pipe(
        z
          .string()
          .regex(/^\d*$/, "Enter a whole number, or leave this empty for no reserve.")
          .transform((v) => (v === "" ? null : Number(v)))
          .pipe(z.number().int().max(MAX_PRICE, "Check the reserve price.").nullable()),
      ),
  })
  .superRefine((v, ctx) => {
    if (v.reserve !== null && v.reserve < v.startingBid) {
      ctx.addIssue({ code: "custom", path: ["reserve"], message: "The reserve can't be lower than the starting bid. Raise it, or leave it empty for no reserve." });
    }
  });

export function parsePriceEdit(input: unknown): { ok: true; startingBid: number; reserve: number | null } | { ok: false; errors: FieldErrors } {
  const r = priceEditSchema.safeParse(input);
  if (!r.success) {
    const errors: FieldErrors = {};
    errorsOf(r.error, errors);
    return { ok: false, errors };
  }
  return { ok: true, startingBid: r.data.startingBid, reserve: r.data.reserve };
}

/** JSON with object keys sorted (Postgres jsonb doesn't keep key order). */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object).sort().map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`).join(",")}}`;
  }
  return JSON.stringify(v ?? null);
}

/** The columns that changed: { column: { from, to } }. */
export function diffColumns(current: Record<string, unknown>, next: Record<string, unknown>): Record<string, { from: unknown; to: unknown }> {
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, to] of Object.entries(next)) {
    const from = current[k] ?? null;
    if (canonical(from) !== canonical(to)) changes[k] = { from, to: to ?? null };
  }
  return changes;
}

/** A new title when the year, make, model or variant changed (otherwise an admin's edited title stays). */
export function retitle(current: Record<string, unknown>, changes: Record<string, unknown>): string | null {
  if (!["year", "make", "model", "variant"].some((k) => k in changes)) return null;
  const pick = <T,>(k: string) => (k in changes ? (changes[k] as { to: T }).to : (current[k] as T));
  return listingTitle({ year: pick<number>("year"), make: pick<string>("make"), model: pick<string>("model"), variant: pick<string | null>("variant") });
}

/** The listing values the automated checks compare (lib/listing-checks/run.ts). */
export const CHECKED_COLUMNS = ["vin", "mileage_km", "exterior_color", "body_style", "seller_type", "dealer_name"];

/** Labels for the admin's change history. */
export const EDIT_LABELS: Record<string, string> = {
  title: "Title", make: "Make", make_other: "Make not in the list", model: "Model", variant: "Variant", year: "Year", vin: "VIN",
  mileage_km: "Mileage (km)", engine: "Engine", transmission: "Transmission", drivetrain: "Drivetrain",
  exterior_color: "Exterior colour", location_city: "City", location_country: "Country",
  damage_history_summary: "Damage and repair summary", video_url: "Video link", body_style: "Body style",
  interior_color: "Interior colour", owner_count: "Number of owners", seller_type: "Seller", dealer_name: "Dealer company name",
  dealer_registry_code: "Dealer registry code", registration_country: "Registered in", is_registered: "Registered right now",
  highlights: "Highlights", equipment: "Equipment", modifications: "Modifications", no_modifications: "No modifications",
  known_flaws: "Known flaws", no_known_flaws: "No known flaws", service_history: "Service history",
  items_included: "Items included", seller_notes: "Seller notes", starting_bid: "Starting bid", requested_reserve: "Requested reserve",
};
