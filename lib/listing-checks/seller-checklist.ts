// What the seller sees of the automated checks (DECISIONS.md point 16): one line per check,
// in plain words, with the values read from their own photos and documents where that
// helps them fix a typo. Partial on purpose: the reverse image search, confidences and
// admin notes stay on the admin side (they would show a fraudster how to get round them).

export type SellerCheckState = "pass" | "look" | "fail" | "waiting";
export interface SellerCheckLine {
  key: "code" | "vin" | "mileage" | "owner" | "appearance";
  label: string;
  state: SellerCheckState;
  text: string;
}

export interface CheckRow {
  check_name: string;
  status: "pass" | "warn" | "fail";
  extracted: Record<string, unknown>;
  reason: string | null;
}

const IDENTITY_PENDING = "identity not verified yet";
const TEAM = "Biddr's team will take a look.";
const IMAGES_REASON = /^Listing photos appear/;

const km = (n: unknown) => (typeof n === "number" ? n.toLocaleString("en-GB") : null);
const str = (v: unknown) => (typeof v === "string" && v ? v : null);

/** The seller's lines from the latest run's rows (any order). The image search isn't listed. */
export function sellerChecklist(rows: CheckRow[]): SellerCheckLine[] {
  const by = new Map(rows.map((r) => [r.check_name, r]));
  const lines: SellerCheckLine[] = [];

  const code = by.get("code");
  if (code) {
    lines.push({
      key: "code",
      label: "Code on the paper",
      state: code.status === "pass" ? "pass" : code.status === "fail" ? "fail" : "look",
      text:
        code.status === "pass"
          ? "Matches the code we gave you."
          : code.status === "fail"
            ? "Isn't the code we gave you. Take the photos again with a new code."
            : `Couldn't be read clearly. ${TEAM}`,
    });
  }

  const vin = by.get("vin");
  if (vin) {
    const e = vin.extracted;
    const plate = str(e.plate);
    const certs = Array.isArray(e.certificate) ? (e.certificate as string[]).filter(Boolean) : [];
    const listing = str(e.listing);
    const read = [plate ? `the plate reads ${plate}` : null, certs.length ? `the certificate reads ${certs.join(", ")}` : null].filter(Boolean).join(", ");
    lines.push({
      key: "vin",
      label: "VIN",
      state: vin.status === "pass" ? "pass" : vin.status === "fail" ? "fail" : "look",
      text:
        vin.status === "pass"
          ? "The plate, the registration certificate and the listing match."
          : vin.status === "fail"
            ? `Doesn't match: ${read || "the VIN read from your photos"}; the listing says ${listing ?? "another VIN"}. If the listing has a typo, edit the listing.`
            : `Couldn't be compared for certain${read ? ` (${read})` : ""}. ${TEAM}`,
    });
  }

  const mileage = by.get("mileage");
  if (mileage) {
    const e = mileage.extracted;
    const read = km(e.read);
    const unit = str(e.unit) ?? "km";
    lines.push({
      key: "mileage",
      label: "Mileage",
      state: mileage.status === "pass" ? "pass" : "look",
      text:
        mileage.status === "pass"
          ? "The odometer matches the listing."
          : read
            ? `The odometer reads ${read} ${unit}; the listing says ${km(e.listing_km) ?? "?"} km. If the listing is wrong, edit it. Otherwise ${TEAM.toLowerCase()}`
            : `The odometer couldn't be read clearly. ${TEAM}`,
    });
  }

  const owner = by.get("owner");
  if (owner) {
    const waiting = owner.reason === IDENTITY_PENDING;
    lines.push({
      key: "owner",
      label: "Owner",
      state: waiting ? "waiting" : owner.status === "pass" ? "pass" : owner.status === "fail" ? "fail" : "look",
      text: waiting
        ? "Waiting for your identity check: then the owner on the certificate is compared with your verified name."
        : owner.status === "pass"
          ? "The owner on the registration certificate matches your verified name."
          : owner.status === "fail"
            ? "The owner on the registration certificate isn't your verified name. If you're selling for someone else, add the owner's signed authorisation."
            : `${TEAM}`,
    });
  }

  const look = by.get("appearance");
  if (look) {
    lines.push({
      key: "appearance",
      label: "Colour and body style",
      state: look.status === "pass" ? "pass" : "look",
      text: look.status === "pass" ? "Fit the listing." : `Don't look quite like the listing. ${TEAM}`,
    });
  }
  return lines;
}

/** The on-hold reasons the seller sees: the image search's result is told only in general terms. */
export function sellerReasons(reasons: string[]): string[] {
  return reasons.map((r) => (IMAGES_REASON.test(r) ? "Biddr's team is checking your listing photos." : r));
}
