// "Verify your car" for the seller (DECISIONS.md points 16 and 18): what we need from
// them (inputs: added or not, never "passed") kept apart from what the checks found
// (results). Pure functions over the stored records, shared by the verify page and My
// listings. Partial on purpose: no confidences, internal codes or where copied photos
// were found.

/** A row of listing_checks (the latest run), as the seller's view reads it. */
export interface CheckRow {
  check_name: string;
  status: "pass" | "warn" | "fail";
  extracted: Record<string, unknown>;
  reason: string | null;
}

export type InputKey = "identity" | "registration" | "vin_photo" | "dashboard_photo" | "authorisation" | "dealer_report" | "history_report";

export interface InputItem {
  key: InputKey;
  label: string;
  required: boolean;
  added: boolean;
  /** When it was added (ISO), if known. */
  addedAt: string | null;
  /** A short note under the row (e.g. "Stripe is confirming it"). */
  note: string | null;
}

export type ResultStatus = "checking" | "passed" | "attention" | "failed" | "approved";
export type RowStatus = "waiting" | "passed" | "attention" | "failed";

export interface ResultAction {
  label: string;
  /** A same-page anchor (#…) or a page. */
  href: string;
}

export interface OverallResult {
  status: ResultStatus;
  title: string;
  text: string;
  action: ResultAction | null;
}

export interface ResultRow {
  key: "code" | "vin" | "owner" | "mileage" | "images";
  label: string;
  status: RowStatus;
  text: string;
}

export interface VerificationModel {
  items: InputItem[];
  requiredAdded: number;
  requiredTotal: number;
  /** Every required input is in. */
  ready: boolean;
  /** The current inputs have been checked (nothing changed since the last run). */
  submitted: boolean;
  /** The seller may add, replace or retake inputs now. */
  editable: boolean;
  /** Nothing can change any more (not in review, files deleted, or the team has it). */
  locked: boolean;
  result: OverallResult | null;
  rows: ResultRow[];
}

export interface ModelInput {
  auctionId: string;
  auctionStatus: string;
  submittedAt: string | null;
  verification: {
    registration_paths: string[];
    seller_is_owner: boolean;
    authorisation_paths: string[];
    documents_uploaded_at: string | null;
    vin_photo_path: string | null;
    odometer_photo_path: string | null;
    photos_taken_at: string | null;
    outcome: "pending" | "green" | "yellow" | "red";
    outcome_reasons: string[];
    waiting_for_identity: boolean;
    checked_at: string | null;
    red_count: number;
    on_hold: boolean;
    override_at: string | null;
    files_purged_at: string | null;
  } | null;
  identity: { status: string; verifiedAt: string | null };
  reports: { dealer: boolean; history: boolean };
  /** The latest run's check rows. */
  checks: CheckRow[];
}

const IDENTITY_PENDING = "identity not verified yet";
const TEAM_REVIEWS = "Our team will review it and contact you.";

const km = (n: unknown) => (typeof n === "number" ? n.toLocaleString("en-GB") : null);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);
const after = (a: string | null | undefined, b: string | null | undefined) => Boolean(a && b && Date.parse(a) > Date.parse(b));

/** The identity counts as added once Stripe has the documents (checking) or has verified them. */
export function identityAdded(status: string): boolean {
  return status === "verified" || status === "pending";
}

export function verificationModel(m: ModelInput): VerificationModel {
  const v = m.verification;
  const idAdded = identityAdded(m.identity.status);
  const items: InputItem[] = [
    {
      key: "identity",
      label: "Identity check (Stripe)",
      required: true,
      added: idAdded,
      addedAt: m.identity.status === "verified" ? m.identity.verifiedAt : null,
      note:
        m.identity.status === "pending"
          ? "Stripe is confirming it."
          : m.identity.status === "requires_input"
            ? "The last attempt didn't go through. Start again with a clear photo of your ID."
            : null,
    },
    {
      key: "registration",
      label: "Registration certificate",
      required: true,
      added: Boolean(v?.registration_paths.length),
      addedAt: v?.registration_paths.length ? v.documents_uploaded_at : null,
      note: null,
    },
    { key: "vin_photo", label: "VIN plate photo with code", required: true, added: Boolean(v?.vin_photo_path), addedAt: v?.vin_photo_path ? v.photos_taken_at : null, note: null },
    {
      key: "dashboard_photo",
      label: "Dashboard photo with code",
      required: true,
      added: Boolean(v?.odometer_photo_path),
      addedAt: v?.odometer_photo_path ? v.photos_taken_at : null,
      note: null,
    },
  ];
  if (v && !v.seller_is_owner) {
    items.push({
      key: "authorisation",
      label: "Owner authorisation",
      required: true,
      added: v.authorisation_paths.length > 0,
      addedAt: v.authorisation_paths.length ? v.documents_uploaded_at : null,
      note: null,
    });
  }
  items.push(
    { key: "dealer_report", label: "Dealer inspection report", required: false, added: m.reports.dealer, addedAt: m.reports.dealer ? m.submittedAt : null, note: null },
    { key: "history_report", label: "carVertical report", required: false, added: m.reports.history, addedAt: m.reports.history ? m.submittedAt : null, note: null },
  );

  const required = items.filter((i) => i.required);
  const requiredAdded = required.filter((i) => i.added).length;
  const ready = requiredAdded === required.length;
  const changedSinceCheck = after(v?.documents_uploaded_at, v?.checked_at) || after(v?.photos_taken_at, v?.checked_at);
  const submitted = Boolean(v?.checked_at) && !changedSinceCheck;
  const teamHasIt = Boolean(v?.on_hold) && (v?.red_count ?? 0) >= 2 && !v?.override_at;
  const locked = m.auctionStatus !== "draft" || Boolean(v?.files_purged_at) || teamHasIt;

  const rows = submitted ? resultRows(m.checks) : [];
  const result = submitted && v ? overall(m, rows) : null;
  const editable = !locked && (!submitted || result?.status === "attention" || (result?.status === "failed" && !teamHasIt));

  return { items, requiredAdded, requiredTotal: required.length, ready, submitted, editable, locked, result, rows };
}

function resultRows(checks: CheckRow[]): ResultRow[] {
  const by = new Map(checks.map((c) => [c.check_name, c]));
  const rows: ResultRow[] = [];
  const status = (c: CheckRow): RowStatus => (c.status === "pass" ? "passed" : c.status === "fail" ? "failed" : "attention");

  const code = by.get("code");
  if (code) {
    rows.push({
      key: "code",
      label: "Code on the photo",
      status: status(code),
      text:
        code.status === "pass"
          ? "The code on your photos is the one we gave you."
          : code.status === "fail"
            ? "The code on your photos isn't the one we gave you."
            : "The code on your photos couldn't be read clearly.",
    });
  }

  const vin = by.get("vin");
  if (vin) {
    const e = vin.extracted;
    const plate = str(e.plate);
    const certs = Array.isArray(e.certificate) ? (e.certificate as string[]).filter(Boolean) : [];
    const listing = str(e.listing);
    const read = [plate ? `the plate reads ${plate}` : null, certs.length ? `the certificate reads ${certs.join(", ")}` : null].filter(Boolean).join(", ");
    rows.push({
      key: "vin",
      label: "VIN matches",
      status: status(vin),
      text:
        vin.status === "pass"
          ? "The VIN plate, the registration certificate and your listing match."
          : vin.status === "fail"
            ? `${capitalise(read || "the VIN on your photos")}; your listing says ${listing ?? "another VIN"}.`
            : `The VIN couldn't be read clearly${read ? ` (${read})` : ""}.`,
    });
  }

  const owner = by.get("owner");
  if (owner) {
    const waiting = owner.reason === IDENTITY_PENDING;
    rows.push({
      key: "owner",
      label: "Owner matches",
      status: waiting ? "waiting" : status(owner),
      text: waiting
        ? "Waiting for your identity check: then the owner on the certificate is compared with your verified name."
        : owner.status === "pass"
          ? "The owner on the registration certificate matches your verified name."
          : owner.status === "fail"
            ? "The owner on the registration certificate isn't your verified name."
            : "Biddr's team is checking the owner's details.",
    });
  }

  const mileage = by.get("mileage");
  if (mileage) {
    const e = mileage.extracted;
    const read = km(e.read);
    const unit = str(e.unit) ?? "km";
    rows.push({
      key: "mileage",
      label: "Mileage matches",
      status: status(mileage),
      text:
        mileage.status === "pass"
          ? "The dashboard matches your listing's mileage."
          : read
            ? `Dashboard shows ${read} ${unit}; your listing says ${km(e.listing_km) ?? "?"} km.`
            : "The dashboard couldn't be read clearly.",
    });
  }

  const images = by.get("images");
  if (images) {
    rows.push({
      key: "images",
      label: "Photos are original",
      status: status(images),
      text: images.status === "pass" ? "Your listing photos look original." : "Biddr's team is checking your listing photos.",
    });
  }
  return rows;
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** The single most important thing the seller can fix, with where to fix it. */
function fixFor(m: ModelInput, rows: ResultRow[]): { text: string; action: ResultAction } | null {
  const row = (k: ResultRow["key"]) => rows.find((r) => r.key === k);
  const edit = `/account/listings/${m.auctionId}/edit`;
  const code = row("code");
  if (code && (code.status === "failed" || code.status === "attention")) {
    return { text: `${code.text} Take both photos again with a new code.`, action: { label: "Retake photos", href: "#photos" } };
  }
  const vin = row("vin");
  const vinCheck = m.checks.find((c) => c.check_name === "vin");
  if (vin?.status === "failed") {
    const plate = str(vinCheck?.extracted.plate);
    const listing = str(vinCheck?.extracted.listing);
    // The plate agrees with the listing: the document is the odd one out.
    if (plate && listing && plate === listing) {
      return { text: `${vin.text} Check that you added the right registration certificate.`, action: { label: "Replace document", href: "#registration" } };
    }
    return { text: `${vin.text} If your listing has a typo, correct the VIN.`, action: { label: "Edit VIN", href: `${edit}#edit-car` } };
  }
  const owner = row("owner");
  if (owner?.status === "failed") {
    return {
      text: `${owner.text} If you're selling for someone else, add the owner's signed authorisation.`,
      action: { label: "Add authorisation", href: "#registration" },
    };
  }
  const mileage = row("mileage");
  const mileageCheck = m.checks.find((c) => c.check_name === "mileage");
  if (mileage?.status === "attention") {
    if (typeof mileageCheck?.extracted.read === "number") {
      return { text: `${mileage.text} If your listing is wrong, correct the mileage.`, action: { label: "Edit mileage", href: `${edit}#edit-car` } };
    }
    return { text: `${mileage.text} Take both photos again in good light.`, action: { label: "Retake photos", href: "#photos" } };
  }
  if (vin?.status === "attention") return { text: `${vin.text} Take both photos again in good light.`, action: { label: "Retake photos", href: "#photos" } };
  return null;
}

function overall(m: ModelInput, rows: ResultRow[]): OverallResult {
  const v = m.verification!;
  if (v.override_at) {
    return { status: "approved", title: "Approved by the Biddr team", text: "Biddr's team has checked your car and approved it.", action: null };
  }
  if (v.outcome === "red") {
    if (v.red_count >= 2) {
      return { status: "failed", title: "Couldn't verify", text: `${reasonText(v.outcome_reasons)} ${TEAM_REVIEWS}`, action: null };
    }
    const fix = fixFor(m, rows);
    if (fix) return { status: "attention", title: "Needs your attention", text: fix.text, action: fix.action };
    return {
      status: "failed",
      title: "Couldn't verify",
      text: `${reasonText(v.outcome_reasons)} You can try once more. Afterwards, our team will review it and contact you.`,
      action: { label: "Try again", href: "#what-we-need" },
    };
  }
  if (v.outcome === "yellow") {
    const fix = fixFor(m, rows);
    if (fix) return { status: "attention", title: "Needs your attention", text: fix.text, action: fix.action };
    return { status: "checking", title: "Checking…", text: "Biddr's team is taking a closer look. We'll notify you when it's done.", action: null };
  }
  if (v.outcome === "green") {
    if (v.waiting_for_identity) {
      return { status: "checking", title: "Checking…", text: "Waiting for Stripe to confirm your identity. We'll notify you when it's done.", action: null };
    }
    return { status: "passed", title: "All checks passed", text: "Biddr's team now reviews your listing before it goes live.", action: null };
  }
  return { status: "checking", title: "Checking…", text: "We'll notify you when it's done.", action: null };
}

/** The on-hold reasons, without where copied photos were found. */
function reasonText(reasons: string[]): string {
  const shown = reasons.map((r) => (/^Listing photos appear/.test(r) ? "Biddr's team is checking your listing photos." : r));
  return shown.join(" ") || "Something didn't match.";
}

/** One line for My listings. */
export function verificationSummary(model: VerificationModel): { status: ResultStatus | "todo"; text: string } {
  if (model.result) return { status: model.result.status, text: model.result.title === "Checking…" ? `Checking… ${model.result.text}` : model.result.title };
  if (model.locked) return { status: "checking", text: "Checking… Biddr's team is reviewing it." };
  return {
    status: "todo",
    text: model.ready
      ? "Verify your car: everything is added. Submit it for checking."
      : `Verify your car: ${model.requiredAdded} of ${model.requiredTotal} required items added.`,
  };
}
