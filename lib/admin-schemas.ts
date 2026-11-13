// Admin panel: zod schemas, labels and limits shared by server actions and client forms.
// No "use client" here; server code imports this.
import { z } from "zod";
import { fromBalticInputs } from "@/lib/baltic-time";
import { DRIVETRAINS, MAX_PRICE, MIN_STARTING_BID, normalizeVideoUrl } from "@/lib/sell";
import type { AuctionStatus } from "@/lib/types";

export const INSPECTION_BUCKET = "inspection-reports";
export const MAX_REPORT_BYTES = 20 * 1024 * 1024;
export const MAX_AUCTION_DAYS = 7;
export const MAX_AUCTION_MS = MAX_AUCTION_DAYS * 24 * 60 * 60 * 1000;
export const DEFAULT_MIN_INCREMENT = 250;
export const MAX_HIGHLIGHTS = 20;

export const ADMIN_TABS = [
  { key: "review", label: "To review", statuses: ["draft"] },
  { key: "scheduled", label: "Scheduled", statuses: ["upcoming"] },
  { key: "live", label: "Live", statuses: ["live"] },
  { key: "finished", label: "Finished", statuses: ["ended", "sold", "reserve_not_met"] },
  { key: "closed", label: "Rejected or withdrawn", statuses: ["rejected", "withdrawn"] },
] as const satisfies readonly { key: string; label: string; statuses: readonly AuctionStatus[] }[];
export type AdminTab = (typeof ADMIN_TABS)[number]["key"];

export const ADMIN_STATUS_LABELS: Record<AuctionStatus, string> = {
  draft: "To review",
  upcoming: "Scheduled",
  live: "Live",
  ended: "Ended, no bids",
  sold: "Sold",
  reserve_not_met: "Reserve not met",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

export type AdminResult = { ok: true; message: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

/** Inspection report path inside the bucket: <auction id>/<uuid>.pdf */
export const REPORT_PATH_RE =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.pdf$/;

// -----------------------------------------------------------------------------
// Field helpers
// -----------------------------------------------------------------------------
const id = z.string().uuid("This link is broken. Reload the page.");

const text = (label: string, min: number, max: number) =>
  z.string().trim().min(min, `Enter the ${label}.`).max(max, `Keep the ${label} under ${max} characters.`);

const optionalText = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `Keep the ${label} under ${max} characters.`)
    .transform((v) => (v === "" ? null : v));

const wholeEuros = (empty: string, min: number, max: number, range: string) =>
  z
    .string()
    .transform((v) => v.replace(/[\s.,€]/g, ""))
    .pipe(
      z
        .string()
        .min(1, empty)
        .regex(/^\d+$/, "Enter a whole number.")
        .transform(Number)
        .pipe(z.number().int().min(min, range).max(max, range)),
    );

// -----------------------------------------------------------------------------
// Schemas
// -----------------------------------------------------------------------------
export const auctionIdSchema = z.object({ auctionId: id });

export const listingSchema = z.object({
  auctionId: id,
  title: text("title", 5, 140),
  variant: optionalText(40, "variant"),
  engine: text("engine", 3, 120),
  transmission: text("transmission", 2, 60),
  drivetrain: z.enum(DRIVETRAINS, { errorMap: () => ({ message: "Choose the drivetrain." }) }),
  exteriorColor: text("colour", 2, 40),
  mileageKm: wholeEuros("Enter the mileage.", 0, 1_000_000, "Enter the mileage in km, from 0 to 1,000,000."),
  city: text("city", 2, 60),
  country: z.enum(["EE", "LV", "LT"], { errorMap: () => ({ message: "Choose the country." }) }),
  damageSummary: optionalText(4000, "summary"),
  videoUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || normalizeVideoUrl(v) !== null, "Paste a YouTube or Vimeo link, or leave this empty.")
    .transform((v) => (v === "" ? null : normalizeVideoUrl(v))),
});
export type ListingInput = z.input<typeof listingSchema>;

export const photoSectionSchema = z.enum(["exterior", "interior", "mechanical", "before"]);
export const photoActionSchema = z.object({ auctionId: id, section: photoSectionSchema, url: z.string().url().max(500) });

export const inspectionSchema = z.object({
  auctionId: id,
  partnerName: optionalText(80, "partner name"),
  inspectionDate: z
    .string()
    .refine((v) => v === "" || /^\d{4}-\d{2}-\d{2}$/.test(v), "Enter a valid date.")
    .transform((v) => (v === "" ? null : v)),
  highlights: z
    .array(z.string().trim().max(140, "Keep each highlight under 140 characters."))
    .max(MAX_HIGHLIGHTS, `Add at most ${MAX_HIGHLIGHTS} highlights.`)
    .transform((list) => list.filter((h) => h.length > 0)),
});
export type InspectionInput = z.input<typeof inspectionSchema>;

export const reportSchema = z.object({
  auctionId: id,
  path: z.string().regex(REPORT_PATH_RE, "The upload didn't finish. Try again."),
});

export const pricingSchema = z
  .object({
    auctionId: id,
    startingBid: wholeEuros(
      "Enter a starting bid.",
      MIN_STARTING_BID,
      MAX_PRICE,
      `The starting bid must be at least €${MIN_STARTING_BID.toLocaleString("en-IE")}.`,
    ),
    minIncrement: wholeEuros("Enter the minimum increment.", 50, 10_000, "Enter an increment from €50 to €10,000."),
    noReserve: z.boolean(),
    reserve: z.string(),
  })
  .transform((v, ctx) => {
    if (v.noReserve) return { ...v, reserve: null };
    const parsed = wholeEuros("Enter a reserve price, or choose No reserve.", 1, MAX_PRICE, "Check the reserve price.").safeParse(
      v.reserve,
    );
    if (!parsed.success) {
      ctx.addIssue({ code: "custom", path: ["reserve"], message: parsed.error.issues[0]?.message ?? "Check the reserve price." });
      return z.NEVER;
    }
    if (parsed.data < v.startingBid) {
      ctx.addIssue({ code: "custom", path: ["reserve"], message: "The reserve can't be lower than the starting bid." });
      return z.NEVER;
    }
    return { ...v, reserve: parsed.data };
  });
export type PricingInput = z.input<typeof pricingSchema>;

export const scheduleSchema = z
  .object({
    auctionId: id,
    startDate: z.string(),
    startTime: z.string(),
    endDate: z.string(),
    endTime: z.string(),
  })
  .transform((v, ctx) => {
    const startsAt = fromBalticInputs(v.startDate, v.startTime);
    const endsAt = fromBalticInputs(v.endDate, v.endTime);
    if (!startsAt) ctx.addIssue({ code: "custom", path: ["start"], message: "Enter a valid start date and time." });
    if (!endsAt) ctx.addIssue({ code: "custom", path: ["end"], message: "Enter a valid end date and time." });
    if (!startsAt || !endsAt) return z.NEVER;
    const duration = Date.parse(endsAt) - Date.parse(startsAt);
    if (duration <= 0) {
      ctx.addIssue({ code: "custom", path: ["end"], message: "The end must be after the start." });
      return z.NEVER;
    }
    if (duration > MAX_AUCTION_MS) {
      ctx.addIssue({
        code: "custom",
        path: ["end"],
        message: `End the auction at most ${MAX_AUCTION_DAYS} days after the start, or card holds may expire before it closes.`,
      });
      return z.NEVER;
    }
    if (Date.parse(endsAt) <= Date.now()) {
      ctx.addIssue({ code: "custom", path: ["end"], message: "The end time has already passed." });
      return z.NEVER;
    }
    return { auctionId: v.auctionId, startsAt, endsAt };
  });
export type ScheduleInput = z.input<typeof scheduleSchema>;

export const extendSchema = z
  .object({
    auctionId: id,
    mode: z.enum(["1h", "1d", "custom"]),
    date: z.string().optional(),
    time: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.mode === "custom" && !fromBalticInputs(v.date ?? "", v.time ?? "")) {
      ctx.addIssue({ code: "custom", path: ["custom"], message: "Enter a valid new end date and time." });
    }
  });
export type ExtendInput = z.input<typeof extendSchema>;

export const rejectSchema = z.object({
  auctionId: id,
  reason: z
    .string()
    .trim()
    .min(10, "Explain in a sentence why the listing isn't accepted. The seller sees this.")
    .max(1000, "Keep the reason under 1,000 characters."),
});

export const commentDeleteSchema = z.object({ auctionId: id, commentId: id });

/** Plain-language copy for errors raised by admin_set_reserve / admin_set_schedule. */
export const DB_ERROR_MESSAGES: Record<string, string> = {
  INVALID_RESERVE: "Enter a reserve between €1 and €10,000,000, or choose No reserve.",
  AUCTION_NOT_FOUND: "This auction no longer exists.",
  AUCTION_CLOSED: "This auction has closed, so you can't change it any more.",
  RESERVE_RAISE_WHILE_LIVE: "Bidding is open, so you can only lower or remove the reserve.",
  SCHEDULE_REQUIRED: "Enter both a start and an end.",
  END_BEFORE_START: "The end must be after the start.",
  END_IN_PAST: "The end time has already passed.",
  END_EARLIER_WHILE_LIVE: "Bidding is open, so you can only move the end time later.",
};

/** Turns zod issues into { field: message } using the first path segment. */
export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
