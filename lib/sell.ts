// Shared by /sell (client form), its server action and /account/listings.
// Keep this file free of "use client" so server code can import it.
import { z } from "zod";
import {
  detailsSchema,
  emptyServiceRow,
  ownershipSchema,
  type DetailsInput,
  type OwnershipInput,
} from "@/lib/listing-details";
import type { AuctionStatus, Country, InspectionCity } from "@/lib/types";

export const PHOTO_BUCKET = "auction-photos";

export const MAKES = ["BMW", "Audi", "Mercedes-AMG", "Porsche", "Other"] as const;
export type MakeOption = (typeof MAKES)[number];

export const DRIVETRAINS = ["RWD", "AWD", "FWD"] as const;
export type Drivetrain = (typeof DRIVETRAINS)[number];

export const COUNTRIES: readonly Country[] = ["EE", "LV", "LT"];
export const INSPECTION_CITIES: readonly InspectionCity[] = ["Tallinn", "Riga", "Vilnius"];

export const STEPS = [
  { id: 1, label: "Car" },
  { id: 2, label: "History" },
  { id: 3, label: "Details" },
  { id: 4, label: "Photos" },
  { id: 5, label: "Price and inspection" },
  { id: 6, label: "Review" },
] as const;

/** Step numbers by name, so code never hard-codes positions. */
export const STEP = { car: 1, history: 2, details: 3, photos: 4, price: 5, review: 6 } as const;
export type StepId = (typeof STEPS)[number]["id"];

export const PHOTO_SECTIONS = [
  { key: "exterior", label: "Exterior", min: 6, hint: "All four sides, front and rear three-quarters, wheels." },
  { key: "interior", label: "Interior", min: 4, hint: "Dashboard, seats, odometer with the engine running." },
  { key: "mechanical", label: "Engine and underside", min: 2, hint: "Engine bay and the underside from front to back." },
  { key: "before", label: "Before restoration", min: 2, hint: "The damage before it was repaired." },
] as const;
export type PhotoSection = (typeof PHOTO_SECTIONS)[number]["key"];
export const PHOTO_SECTION_KEYS: readonly PhotoSection[] = PHOTO_SECTIONS.map((s) => s.key);
export const MAX_PHOTOS_PER_SECTION = 40;
export const MAX_SOURCE_FILE_BYTES = 25 * 1024 * 1024;
export const PHOTO_MAX_EDGE = 2560;
export const PHOTO_QUALITY = 0.85;
export const MIN_STARTING_BID = 1000;
const HIGHLIGHTS_MIN_SELLER = 3;
export const MAX_PRICE = 10_000_000;

export function photoSectionsFor(restored: boolean) {
  return PHOTO_SECTIONS.filter((s) => s.key !== "before" || restored);
}

/** Storage folder for one draft: <user id>/<draft id>/ */
export function draftFolder(userId: string, draftId: string): string {
  return `${userId}/${draftId}/`;
}

/** Public URL prefix of the photo bucket, e.g. https://x.supabase.co/storage/v1/object/public/auction-photos/ */
export function publicBucketPrefix(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, "")}/storage/v1/object/public/${PHOTO_BUCKET}/`;
}

export function storageKey(userId: string): string {
  return `biddr:sell:v1:${userId}`;
}

// -----------------------------------------------------------------------------
// Form input: the shape the client keeps and sends. Text fields stay strings so
// the client and the server action validate exactly the same thing.
// -----------------------------------------------------------------------------
export type SellPhotos = Record<PhotoSection, string[]>;

export interface SellInput extends OwnershipInput, DetailsInput {
  draftId: string;
  make: MakeOption | "";
  makeOther: string;
  model: string;
  variant: string;
  year: string;
  vin: string;
  mileageKm: string;
  engine: string;
  transmission: string;
  drivetrain: Drivetrain | "";
  exteriorColor: string;
  city: string;
  country: Country | "";
  hadDamage: "no" | "yes" | "";
  damageSummary: string;
  photos: SellPhotos;
  videoUrl: string;
  startingBid: string;
  reserve: string;
  inspectionCity: InspectionCity | "";
  inspectionDates: string;
  confirmed: boolean;
}

export type SellField = Exclude<keyof SellInput, "photos" | "draftId"> | `photos.${PhotoSection}`;
export type SellErrors = Partial<Record<SellField, string>>;

/** Which step shows each field, so the server can send the user back to the right place. */
export const FIELD_STEP: Record<SellField, StepId> = {
  make: 1, makeOther: 1, model: 1, variant: 1, year: 1, vin: 1, mileageKm: 1, engine: 1, transmission: 1,
  drivetrain: 1, exteriorColor: 1, bodyStyle: 1, interiorColor: 1, ownerCount: 1, sellerType: 1, dealerName: 1,
  dealerRegistryCode: 1, registrationCountry: 1, isRegistered: 1, city: 1, country: 1,
  hadDamage: 2, damageSummary: 2,
  highlights: 3, equipment: 3, modifications: 3, noModifications: 3, knownFlaws: 3, noKnownFlaws: 3,
  serviceHistory: 3, itemsIncluded: 3, sellerNotes: 3,
  "photos.exterior": 4, "photos.interior": 4, "photos.mechanical": 4, "photos.before": 4, videoUrl: 4,
  startingBid: 5, reserve: 5, inspectionCity: 5, inspectionDates: 5,
  confirmed: 6,
};

export function emptySellInput(draftId: string, country: Country | ""): SellInput {
  return {
    draftId,
    make: "", makeOther: "", model: "", variant: "", year: "", vin: "", mileageKm: "", engine: "",
    transmission: "", drivetrain: "", exteriorColor: "", city: "", country,
    bodyStyle: "", interiorColor: "", ownerCount: "", sellerType: "private", dealerName: "", dealerRegistryCode: "",
    registrationCountry: country, isRegistered: "",
    hadDamage: "", damageSummary: "",
    highlights: ["", "", ""], equipment: [""], modifications: [""], noModifications: false, knownFlaws: [""],
    noKnownFlaws: false, serviceHistory: [emptyServiceRow()], itemsIncluded: [""], sellerNotes: "",
    photos: { exterior: [], interior: [], mechanical: [], before: [] },
    videoUrl: "",
    startingBid: "", reserve: "", inspectionCity: "", inspectionDates: "",
    confirmed: false,
  };
}

// -----------------------------------------------------------------------------
// Field schemas
// -----------------------------------------------------------------------------
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

const text = (label: string, min: number, max: number) =>
  z
    .string()
    .trim()
    .min(1, `Enter the ${label}.`)
    .min(min, `The ${label} is too short.`)
    .max(max, `Keep the ${label} under ${max} characters.`);

const optionalText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep the ${label} under ${max} characters.`)
    .transform((v) => (v === "" ? null : v));

/** Whole number typed as text. Spaces, dots and commas used as thousand separators are allowed. */
const wholeNumber = (empty: string, min: number, max: number, range: string) =>
  z
    .string()
    .transform((v) => v.replace(/[\s.,]/g, ""))
    .pipe(
      z
        .string()
        .min(1, empty)
        .regex(/^\d+$/, "Enter a whole number, without decimals or letters.")
        .transform(Number)
        .pipe(z.number().int().min(min, range).max(max, range)),
    );

function currentYear(): number {
  return new Date().getFullYear();
}

export function normalizeVin(raw: string): string {
  return raw.replace(/[\s-]/g, "").toUpperCase();
}

const vinSchema = z
  .string()
  .transform(normalizeVin)
  .pipe(
    z
      .string()
      .min(1, "Enter the VIN.")
      .length(17, "A VIN has exactly 17 characters. Check the registration document.")
      .regex(VIN_RE, "A VIN uses only letters and numbers, never I, O or Q. Check for typos."),
  );

/** Returns the embeddable form of a YouTube or Vimeo link, or null. */
export function normalizeVideoUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.toLowerCase().replace(/^(www\.|m\.)/, "");
  if (host === "youtube.com") {
    const id = u.searchParams.get("v");
    return id && /^[\w-]{6,20}$/.test(id) ? `https://www.youtube.com/watch?v=${id}` : null;
  }
  if (host === "youtu.be") {
    const id = u.pathname.slice(1);
    return /^[\w-]{6,20}$/.test(id) ? `https://youtu.be/${id}` : null;
  }
  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = u.pathname.split("/").filter(Boolean).pop() ?? "";
    return /^\d{5,12}$/.test(id) ? `https://vimeo.com/${id}` : null;
  }
  return null;
}

// -----------------------------------------------------------------------------
// Step schemas. Each one validates a slice of SellInput; the server runs all.
// -----------------------------------------------------------------------------
export const carSchema = z
  .object({
    make: z.enum(MAKES, { errorMap: () => ({ message: "Choose the make." }) }),
    makeOther: z.string().trim().max(40, "Keep the make under 40 characters."),
    model: text("model", 1, 60),
    variant: optionalText("variant", 40),
    year: wholeNumber("Enter the year.", 1950, currentYear() + 1, `Enter a year from 1950 to ${currentYear() + 1}.`),
    vin: vinSchema,
    mileageKm: wholeNumber("Enter the mileage.", 0, 1_000_000, "Enter the mileage in km, from 0 to 1,000,000."),
    engine: text("engine description", 3, 120),
    transmission: text("transmission", 2, 60),
    drivetrain: z.enum(DRIVETRAINS, { errorMap: () => ({ message: "Choose the drivetrain." }) }),
    exteriorColor: text("exterior colour", 2, 40),
    city: text("city", 2, 60),
    country: z.enum(["EE", "LV", "LT"], { errorMap: () => ({ message: "Choose the country." }) }),
  })
  .superRefine((v, ctx) => {
    if (v.make === "Other" && v.makeOther.length < 2) {
      ctx.addIssue({ code: "custom", path: ["makeOther"], message: "Enter the make." });
    }
  })
  .transform(({ makeOther, ...v }) => ({ ...v, make: v.make === "Other" ? makeOther : v.make }));

export const historySchema = z
  .object({
    hadDamage: z.enum(["no", "yes"], { errorMap: () => ({ message: "Choose yes or no." }) }),
    damageSummary: z.string().trim().max(4000, "Keep the summary under 4,000 characters."),
  })
  .superRefine((v, ctx) => {
    if (v.hadDamage === "yes" && v.damageSummary.length < 40) {
      ctx.addIssue({
        code: "custom",
        path: ["damageSummary"],
        message:
          v.damageSummary.length === 0
            ? "Describe the damage and the repair."
            : `Add a little more detail: at least 40 characters (now ${v.damageSummary.length}).`,
      });
    }
  })
  .transform((v) => ({
    condition: v.hadDamage === "yes" ? ("restored_accident" as const) : ("clean" as const),
    damageSummary: v.hadDamage === "yes" ? v.damageSummary : null,
  }));

const urlList = z.array(z.string().max(500)).max(MAX_PHOTOS_PER_SECTION, `Upload at most ${MAX_PHOTOS_PER_SECTION} photos here.`);

export function photosSchema(restored: boolean) {
  return z
    .object({
      photos: z.object({ exterior: urlList, interior: urlList, mechanical: urlList, before: urlList }),
      videoUrl: z.string().trim().max(500),
    })
    .superRefine((v, ctx) => {
      for (const s of photoSectionsFor(restored)) {
        const n = v.photos[s.key].length;
        if (n < s.min) {
          ctx.addIssue({
            code: "custom",
            path: ["photos", s.key],
            message: `Add at least ${s.min} photos here (${n} so far).`,
          });
        }
      }
      if (v.videoUrl && !normalizeVideoUrl(v.videoUrl)) {
        ctx.addIssue({ code: "custom", path: ["videoUrl"], message: "Paste a YouTube or Vimeo link, or leave this empty." });
      }
    })
    .transform((v) => ({
      photos: { ...v.photos, before: restored ? v.photos.before : [] },
      videoUrl: v.videoUrl ? normalizeVideoUrl(v.videoUrl) : null,
    }));
}

export const priceSchema = z
  .object({
    startingBid: wholeNumber(
      "Enter a starting bid.",
      MIN_STARTING_BID,
      MAX_PRICE,
      `The starting bid must be at least €${MIN_STARTING_BID.toLocaleString("en-IE")}.`,
    ),
    reserve: z
      .string()
      .transform((v) => v.replace(/[\s.,]/g, ""))
      .pipe(
        z
          .string()
          .regex(/^\d*$/, "Enter a whole number, or leave this empty for no reserve.")
          .transform((v) => (v === "" ? null : Number(v)))
          .pipe(z.number().int().max(MAX_PRICE, "Check the reserve price.").nullable()),
      ),
    inspectionCity: z.enum(["Tallinn", "Riga", "Vilnius"], {
      errorMap: () => ({ message: "Choose where the car can be inspected." }),
    }),
    inspectionDates: optionalText("preferred dates", 500),
  })
  .superRefine((v, ctx) => {
    if (v.reserve !== null && v.reserve < v.startingBid) {
      ctx.addIssue({
        code: "custom",
        path: ["reserve"],
        message: "The reserve can't be lower than the starting bid. Raise it, or leave it empty for no reserve.",
      });
    }
  });

/** Sellers must give 3 to 10 highlights. */
export const sellerDetailsSchema = detailsSchema({ highlightsMin: HIGHLIGHTS_MIN_SELLER });

export const confirmSchema = z.object({
  confirmed: z.literal(true, { errorMap: () => ({ message: "Tick the box to confirm before you submit." }) }),
});

function collect(error: z.ZodError, into: SellErrors) {
  for (const issue of error.issues) {
    const key = issue.path.slice(0, 2).join(".") as SellField;
    if (key in FIELD_STEP && !into[key]) into[key] = issue.message;
  }
}

/** Validates one step of the form. Returns an empty object when the step is fine. */
export function validateStep(step: StepId, input: SellInput): SellErrors {
  const errors: SellErrors = {};
  const restored = input.hadDamage === "yes";
  const results =
    step === STEP.car
      ? [carSchema.safeParse(input), ownershipSchema.safeParse(input)]
      : step === STEP.history
        ? [historySchema.safeParse(input)]
        : step === STEP.details
          ? [sellerDetailsSchema.safeParse(input)]
          : step === STEP.photos
            ? [photosSchema(restored).safeParse(input)]
            : step === STEP.price
              ? [priceSchema.safeParse(input)]
              : [confirmSchema.safeParse(input)];
  for (const r of results) if (!r.success) collect(r.error, errors);
  return errors;
}

export function validateAll(input: SellInput): SellErrors {
  const errors: SellErrors = {};
  for (const s of STEPS) {
    const stepErrors = validateStep(s.id, input);
    for (const key of Object.keys(stepErrors) as SellField[]) errors[key] ??= stepErrors[key];
  }
  return errors;
}

export function firstErrorStep(errors: SellErrors): StepId | null {
  let step: StepId | null = null;
  for (const key of Object.keys(errors) as SellField[]) {
    const s = FIELD_STEP[key];
    if (step === null || s < step) step = s;
  }
  return step;
}

/** Full server-side parse. Also used to type the submission. */
export function parseSubmission(input: unknown) {
  const base = z
    .object({ draftId: z.string().uuid() })
    .passthrough()
    .safeParse(input);
  if (!base.success) return { success: false as const, errors: {} as SellErrors };

  const raw = input as SellInput;
  const restored = raw.hadDamage === "yes";
  const car = carSchema.safeParse(raw);
  const ownership = ownershipSchema.safeParse(raw);
  const details = sellerDetailsSchema.safeParse(raw);
  const history = historySchema.safeParse(raw);
  const photos = photosSchema(restored).safeParse(raw);
  const price = priceSchema.safeParse(raw);
  const confirm = confirmSchema.safeParse(raw);

  const errors: SellErrors = {};
  for (const r of [car, ownership, history, details, photos, price, confirm]) if (!r.success) collect(r.error, errors);
  if (!car.success || !ownership.success || !history.success || !details.success || !photos.success || !price.success || !confirm.success) {
    return { success: false as const, errors };
  }
  return {
    success: true as const,
    data: { draftId: base.data.draftId, ...car.data, ...history.data, ...photos.data, ...price.data },
    ownership: ownership.data,
    details: details.data,
  };
}

export type SellSubmission = Extract<ReturnType<typeof parseSubmission>, { success: true }>["data"];

export function listingTitle(v: { year: number; make: string; model: string; variant: string | null }): string {
  return [String(v.year), v.make, v.model, v.variant].filter(Boolean).join(" ");
}

export type SubmitResult = { ok: true; id: string } | { ok: false; error?: string; errors?: SellErrors };

// -----------------------------------------------------------------------------
// Listings
// -----------------------------------------------------------------------------
export const STATUS_LABELS: Record<AuctionStatus, string> = {
  draft: "Waiting for review",
  upcoming: "Scheduled",
  live: "Live",
  sold: "Sold",
  ended: "Ended",
  reserve_not_met: "Reserve not met",
  rejected: "Not accepted",
  withdrawn: "Withdrawn",
};
