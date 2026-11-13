// Structured listing details (0007): shared by the sell form, the admin editor and
// the public auction page. No "use client" here; server code imports this.
import { z } from "zod";
import type { BodyStyle, RegistrationCountry, SellerType, ServiceRecord } from "@/lib/types";

// Limits mirror the database checks in 0007_listing_details.sql.
export const LIST_MAX_ITEMS = 40;
export const LIST_ITEM_MAX = 300;
export const SELLER_NOTES_MAX = 2000;
export const HIGHLIGHTS_MIN = 3;
export const HIGHLIGHTS_MAX = 10;
export const PUBLIC_LIST_PREVIEW = 8;

export const BODY_STYLES: readonly { value: BodyStyle; label: string }[] = [
  { value: "coupe", label: "Coupe" },
  { value: "sedan", label: "Sedan" },
  { value: "estate", label: "Estate" },
  { value: "hatchback", label: "Hatchback" },
  { value: "convertible", label: "Convertible" },
  { value: "suv", label: "SUV" },
  { value: "other", label: "Other" },
];

export const REGISTRATION_OPTIONS: readonly { value: RegistrationCountry; label: string }[] = [
  { value: "EE", label: "Estonia" },
  { value: "LV", label: "Latvia" },
  { value: "LT", label: "Lithuania" },
  { value: "other_eu", label: "Another EU country" },
  { value: "non_eu", label: "Outside the EU" },
];

export const SELLER_TYPES: readonly { value: SellerType; label: string }[] = [
  { value: "private", label: "Private person" },
  { value: "dealer", label: "Dealer" },
];

export const labelOf = <T extends string>(list: readonly { value: T; label: string }[], v: T | null | undefined) =>
  list.find((o) => o.value === v)?.label ?? null;

/** How the form keeps a service row: everything as text, like the other inputs. */
export interface ServiceRowInput {
  date: string; // "YYYY-MM"
  mileage: string;
  description: string;
  workshop: string;
}

export const emptyServiceRow = (): ServiceRowInput => ({ date: "", mileage: "", description: "", workshop: "" });

/** The sentence-case names used in error messages and headings. */
export const LIST_LABELS = {
  highlights: "Highlights",
  equipment: "Equipment",
  modifications: "Modifications",
  knownFlaws: "Known flaws",
  itemsIncluded: "Items included",
} as const;
export type ListKey = keyof typeof LIST_LABELS;

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------

/** Trims items, drops empty rows, then checks count and length. Errors land on the list itself. */
export function textList(label: string, opts: { min?: number; max?: number; minMessage?: string } = {}) {
  const max = opts.max ?? LIST_MAX_ITEMS;
  return z
    .array(z.string())
    .transform((list) => list.map((s) => s.trim()).filter((s) => s.length > 0))
    .superRefine((list, ctx) => {
      const tooLong = list.findIndex((s) => s.length > LIST_ITEM_MAX);
      if (tooLong >= 0) {
        ctx.addIssue({
          code: "custom",
          message: `${label}, item ${tooLong + 1}: keep it under ${LIST_ITEM_MAX} characters (now ${list[tooLong]!.length}).`,
        });
      }
      if (list.length > max) ctx.addIssue({ code: "custom", message: `${label}: add at most ${max} items (now ${list.length}).` });
      if (opts.min && list.length < opts.min) {
        ctx.addIssue({
          code: "custom",
          message: opts.minMessage ?? `${label}: add at least ${opts.min} items (now ${list.length}).`,
        });
      }
    });
}

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** Service rows: empty rows are dropped; the rest are checked and sorted newest first. */
export const serviceHistorySchema = z
  .array(z.object({ date: z.string(), mileage: z.string(), description: z.string(), workshop: z.string() }))
  .transform((rows) =>
    rows
      .map((r) => ({
        date: r.date.trim(),
        mileage: r.mileage.replace(/[\s.,]/g, ""),
        description: r.description.trim(),
        workshop: r.workshop.trim(),
      }))
      .filter((r) => r.date || r.mileage || r.description || r.workshop),
  )
  .superRefine((rows, ctx) => {
    const thisMonth = new Date().toISOString().slice(0, 7);
    rows.forEach((r, i) => {
      const at = `Service history, row ${i + 1}`;
      if (!MONTH_RE.test(r.date)) ctx.addIssue({ code: "custom", message: `${at}: enter the month as YYYY-MM, e.g. 2024-05.` });
      else if (r.date > thisMonth) ctx.addIssue({ code: "custom", message: `${at}: the month can't be in the future.` });
      if (!/^\d+$/.test(r.mileage) || Number(r.mileage) > 2_000_000) {
        ctx.addIssue({ code: "custom", message: `${at}: enter the mileage in km, as a whole number.` });
      }
      if (!r.description) ctx.addIssue({ code: "custom", message: `${at}: say what was done.` });
      else if (r.description.length > LIST_ITEM_MAX) {
        ctx.addIssue({ code: "custom", message: `${at}: keep the description under ${LIST_ITEM_MAX} characters.` });
      }
      if (r.workshop.length > LIST_ITEM_MAX) {
        ctx.addIssue({ code: "custom", message: `${at}: keep the workshop name under ${LIST_ITEM_MAX} characters.` });
      }
    });
    if (rows.length > LIST_MAX_ITEMS) {
      ctx.addIssue({ code: "custom", message: `Service history: add at most ${LIST_MAX_ITEMS} rows (now ${rows.length}).` });
    }
  })
  .transform((rows): ServiceRecord[] =>
    rows
      .map((r) => ({
        date: r.date,
        mileage_km: Number(r.mileage),
        description: r.description,
        ...(r.workshop ? { workshop: r.workshop } : {}),
      }))
      .sort((a, b) => b.date.localeCompare(a.date) || b.mileage_km - a.mileage_km),
  );

export const NO_MODIFICATIONS_LABEL = "No modifications, factory specification";
export const NO_FLAWS_LABEL = "I'm not aware of any flaws";

/** Form shape of the details lists (sell "Details" step and admin editor). */
export interface DetailsInput {
  highlights: string[];
  equipment: string[];
  modifications: string[];
  noModifications: boolean;
  knownFlaws: string[];
  noKnownFlaws: boolean;
  serviceHistory: ServiceRowInput[];
  itemsIncluded: string[];
  sellerNotes: string;
}

/**
 * Details lists. Sellers need 3 to 10 highlights; admins editing older listings may
 * have fewer. Modifications and known flaws each need a list or the "none" tick.
 */
export function detailsSchema(opts: { highlightsMin: number; requireDeclarations?: boolean }) {
  const requireDeclarations = opts.requireDeclarations ?? true;
  return z
    .object({
      highlights: textList(LIST_LABELS.highlights, { min: opts.highlightsMin, max: HIGHLIGHTS_MAX }),
      equipment: textList(LIST_LABELS.equipment),
      modifications: textList(LIST_LABELS.modifications),
      noModifications: z.boolean(),
      knownFlaws: textList(LIST_LABELS.knownFlaws),
      noKnownFlaws: z.boolean(),
      serviceHistory: serviceHistorySchema,
      itemsIncluded: textList(LIST_LABELS.itemsIncluded),
      sellerNotes: z
        .string()
        .trim()
        .max(SELLER_NOTES_MAX, `Keep the seller notes under ${SELLER_NOTES_MAX.toLocaleString("en-IE")} characters.`)
        .transform((v) => (v === "" ? null : v)),
    })
    .superRefine((v, ctx) => {
      if (!requireDeclarations) return;
      if (!v.noModifications && v.modifications.length === 0) {
        ctx.addIssue({ code: "custom", path: ["modifications"], message: `List the modifications, or tick “${NO_MODIFICATIONS_LABEL}”.` });
      }
      if (!v.noKnownFlaws && v.knownFlaws.length === 0) {
        ctx.addIssue({ code: "custom", path: ["knownFlaws"], message: `List the flaws you know about, or tick “${NO_FLAWS_LABEL}”.` });
      }
    })
    .transform((v) => ({
      ...v,
      modifications: v.noModifications ? [] : v.modifications,
      knownFlaws: v.noKnownFlaws ? [] : v.knownFlaws,
    }));
}

/** Ownership, seller type and registration (sell "Car" step and admin editor). */
export interface OwnershipInput {
  bodyStyle: BodyStyle | "";
  interiorColor: string;
  ownerCount: string;
  sellerType: SellerType;
  dealerName: string;
  dealerRegistryCode: string;
  registrationCountry: RegistrationCountry | "";
  isRegistered: "yes" | "no" | "";
}

export const bodyStyleSchema = z.enum(["coupe", "sedan", "estate", "hatchback", "convertible", "suv", "other"], {
  errorMap: () => ({ message: "Choose the body style." }),
});
export const registrationSchema = z.enum(["EE", "LV", "LT", "other_eu", "non_eu"], {
  errorMap: () => ({ message: "Choose where the car is registered." }),
});
export const sellerTypeSchema = z.enum(["private", "dealer"], { errorMap: () => ({ message: "Choose who is selling." }) });

export const isRegisteredSchema = z.enum(["yes", "no"], {
  errorMap: () => ({ message: "Say whether the car is registered right now." }),
});

export const ownerCountSchema = z
  .string()
  .trim()
  .min(1, "Enter the number of owners, including you.")
  .regex(/^\d+$/, "Enter the number of owners as a whole number.")
  .transform(Number)
  .pipe(z.number().int().min(1, "Enter at least 1 owner.").max(30, "Enter 30 owners or fewer."));

// -----------------------------------------------------------------------------
// Display helpers (public page, review step)
// -----------------------------------------------------------------------------
const monthFmt = new Intl.DateTimeFormat("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/** "2024-05" -> "May 2024" */
export function formatMonth(ym: string): string {
  const m = MONTH_RE.exec(ym);
  return m ? monthFmt.format(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)) : ym;
}

/** Reads a jsonb string[] defensively (old rows or bad data never crash the page). */
export function asTextList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
}

export function asServiceHistory(v: unknown): ServiceRecord[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter(
      (r): r is ServiceRecord =>
        typeof r === "object" && r !== null && typeof (r as ServiceRecord).date === "string" &&
        typeof (r as ServiceRecord).mileage_km === "number" && typeof (r as ServiceRecord).description === "string",
    )
    .sort((a, b) => b.date.localeCompare(a.date) || b.mileage_km - a.mileage_km);
}

export function toServiceRows(records: ServiceRecord[]): ServiceRowInput[] {
  return records.map((r) => ({
    date: r.date,
    mileage: String(r.mileage_km),
    description: r.description,
    workshop: r.workshop ?? "",
  }));
}

export const ownershipSchema = z
  .object({
    bodyStyle: bodyStyleSchema,
    interiorColor: z.string().trim().min(2, "Enter the interior colour.").max(60, "Keep the interior colour under 60 characters."),
    ownerCount: ownerCountSchema,
    sellerType: sellerTypeSchema,
    dealerName: z.string().trim().max(120, "Keep the company name under 120 characters."),
    dealerRegistryCode: z.string().trim().max(40, "Keep the registry code under 40 characters."),
    registrationCountry: registrationSchema,
    isRegistered: isRegisteredSchema,
  })
  .superRefine((v, ctx) => {
    if (v.sellerType === "dealer") {
      if (v.dealerName.length < 2) ctx.addIssue({ code: "custom", path: ["dealerName"], message: "Enter the company name." });
      if (v.dealerRegistryCode.length < 3) {
        ctx.addIssue({ code: "custom", path: ["dealerRegistryCode"], message: "Enter the company registry code." });
      }
    }
  })
  .transform((v) => ({
    bodyStyle: v.bodyStyle,
    interiorColor: v.interiorColor,
    ownerCount: v.ownerCount,
    sellerType: v.sellerType,
    dealerName: v.sellerType === "dealer" ? v.dealerName : null,
    dealerRegistryCode: v.sellerType === "dealer" ? v.dealerRegistryCode : null,
    registrationCountry: v.registrationCountry,
    isRegistered: v.isRegistered === "yes",
  }));

/** The columns both the seller insert and the admin editor write. */
export function ownershipColumns(v: z.output<typeof ownershipSchema>) {
  return {
    body_style: v.bodyStyle,
    interior_color: v.interiorColor,
    owner_count: v.ownerCount,
    seller_type: v.sellerType,
    dealer_name: v.dealerName,
    dealer_registry_code: v.dealerRegistryCode,
    registration_country: v.registrationCountry,
    is_registered: v.isRegistered,
  };
}

export function detailsColumns(v: z.output<ReturnType<typeof detailsSchema>>) {
  return {
    highlights: v.highlights,
    equipment: v.equipment,
    modifications: v.modifications,
    no_modifications: v.noModifications,
    known_flaws: v.knownFlaws,
    no_known_flaws: v.noKnownFlaws,
    service_history: v.serviceHistory,
    items_included: v.itemsIncluded,
    seller_notes: v.sellerNotes,
  };
}
