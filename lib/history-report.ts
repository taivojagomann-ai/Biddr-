import { z } from "zod";
import { REPORT_PATH_RE, type ReportFile } from "@/lib/report-paths";

/**
 * Vehicle history reports from carVertical (DECISIONS.md point 11). Sellers can
 * add their own report; Biddr's team checks it against the listing. Shared by
 * the sell form, the seller's "new report" form, the admin review and the
 * public auction page.
 */

export const CARVERTICAL_HOME = "https://www.carvertical.com";

/** A carVertical share link: https on carvertical.com or one of its subdomains. */
export function isCarVerticalLink(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return false;
  }
  const host = u.hostname.toLowerCase();
  return u.protocol === "https:" && (host === "carvertical.com" || host.endsWith(".carvertical.com")) && !u.username && !u.password;
}

export const HISTORY_SUMMARY_MIN = 2;
export const HISTORY_SUMMARY_MAX = 8;
export const HISTORY_LINE_MAX = 200;

/** All three must be ticked to accept a report. */
export const HISTORY_CHECKS = [
  { key: "vinMatches", label: "VIN on the report matches the listing" },
  { key: "mileageConsistent", label: "Report mileage is not higher than the listing mileage and the records look consistent" },
  { key: "damageMatches", label: "Damage records match the seller's description (accident repaired or clean)" },
] as const;
export type HistoryCheckKey = (typeof HISTORY_CHECKS)[number]["key"];

/** Public wording, in one place so the page, tips and tests agree. */
export const HISTORY_TEXT = {
  badge: "History report",
  heading: "Vehicle history report",
  provided: "carVertical report provided by the seller and checked by Biddr.",
  viewFull: "View the full report",
  none: "No vehicle history report was provided. You can check this car's history yourself on carVertical using its VIN.",
  checkLink: "Check on carVertical",
  copyVin: "Copy VIN",
  copied: "VIN copied",
  oldCar: "History databases often have little data for older cars; restoration records and photos matter more.",
  tip: "The seller provided a carVertical vehicle history report. We checked that it matches this car and the seller's description.",
} as const;

/** Cars first registered before this year get the "older cars" note. */
export const OLD_CAR_YEAR = 1990;

const reportFiles = z
  .array(z.object({ path: z.string().regex(REPORT_PATH_RE), name: z.string().max(255) }))
  .max(10, "Add at most 10 files.")
  .catch([]);

/** The sell form's (and the "new report" form's) history report fields. */
export const historyReportFields = {
  historyReport: z.enum(["yes", "no", ""]).catch(""),
  historyFiles: reportFiles,
  historyLink: z.string().trim().max(500, "Keep the link under 500 characters."),
  historyShareAllowed: z.boolean().catch(false),
};

export interface HistoryReportValues {
  historyReport: "yes" | "no" | "";
  historyFiles: ReportFile[];
  historyLink: string;
  historyShareAllowed: boolean;
}

export function refineHistoryReport(v: Omit<HistoryReportValues, "historyShareAllowed">, ctx: z.RefinementCtx) {
  if (v.historyReport !== "yes") return;
  if (v.historyLink && !isCarVerticalLink(v.historyLink)) {
    ctx.addIssue({ code: "custom", path: ["historyLink"], message: "Paste a carVertical link (it starts with https:// and is on carvertical.com)." });
  }
  if (v.historyFiles.length === 0 && !v.historyLink) {
    ctx.addIssue({ code: "custom", path: ["historyFiles"], message: "Upload the report or paste its carVertical link." });
  }
}

export interface HistoryReportSubmission {
  paths: string[];
  link: string | null;
  shareAllowed: boolean;
}

/** Optional for every car: null when the seller has no report. */
export const historyReportSchema = z
  .object(historyReportFields)
  .superRefine((v, ctx) => refineHistoryReport(v, ctx))
  .transform(
    (v): { historyReport: HistoryReportSubmission | null } => ({
      historyReport:
        v.historyReport === "yes"
          ? { paths: v.historyFiles.map((f) => f.path), link: v.historyLink || null, shareAllowed: v.historyShareAllowed }
          : null,
    }),
  );

/** Admin: accept a report. */
export const acceptHistorySchema = z.object({
  auctionId: z.string().uuid(),
  checks: z.object(
    Object.fromEntries(HISTORY_CHECKS.map((c) => [c.key, z.literal(true, { errorMap: () => ({ message: "Confirm this before accepting." }) })])) as Record<
      HistoryCheckKey,
      z.ZodLiteral<true>
    >,
  ),
  summary: z
    .array(z.string().trim().max(HISTORY_LINE_MAX, `Keep each line under ${HISTORY_LINE_MAX} characters.`))
    .transform((lines) => lines.filter(Boolean))
    .pipe(
      z
        .array(z.string())
        .min(HISTORY_SUMMARY_MIN, `Write ${HISTORY_SUMMARY_MIN} to ${HISTORY_SUMMARY_MAX} summary lines.`)
        .max(HISTORY_SUMMARY_MAX, `Write ${HISTORY_SUMMARY_MIN} to ${HISTORY_SUMMARY_MAX} summary lines.`),
    ),
});

/** Admin: reject a report. */
export const rejectHistorySchema = z.object({
  auctionId: z.string().uuid(),
  reason: z.string().trim().min(10, "Give the seller a reason (at least 10 characters).").max(500, "Keep the reason under 500 characters."),
});

/** Seller: another report after a rejection (or the damage summary corrected), while the listing is in review. */
export const newHistoryReportSchema = z
  .object({
    auctionId: z.string().uuid("This link is broken. Reload the page."),
    historyFiles: reportFiles,
    historyLink: z.string().trim().max(500, "Keep the link under 500 characters."),
    historyShareAllowed: z.boolean().catch(false),
  })
  .superRefine((v, ctx) => refineHistoryReport({ ...v, historyReport: "yes" }, ctx));
