// Fake-listing checks (DECISIONS.md point 16): the comparisons, in code. The model only
// reads values from the photos and documents (with a confidence); whether they match is
// decided here, never by the model. Pure functions, no I/O.

export type Confidence = "high" | "medium" | "low";
export type CheckStatus = "pass" | "warn" | "fail";
export type CheckName = "code" | "vin" | "mileage" | "owner" | "appearance" | "images";
export type Outcome = "pending" | "green" | "yellow" | "red";

export interface Read<T> {
  value: T | null;
  confidence: Confidence;
}

/** What the model read from the challenge photos and the documents (stored; no raw responses). */
export interface Extracted {
  challenge_code: Read<string>;
  plate_vin: Read<string>;
  odometer: { value: number | null; unit: "km" | "mi" | null; confidence: Confidence };
  vehicle_colour: Read<string>;
  body_type: Read<string>;
  certificate_vins: { values: string[]; confidence: Confidence };
  certificate_owners: { values: string[]; confidence: Confidence };
  authorisation: { owner_name: string | null; authorised_name: string | null; signed: boolean | null; confidence: Confidence } | null;
  /** Reverse image search over the listing's public photos. */
  images: ImageSearch | null;
}

export interface ImageSearch {
  /** Pages on car classifieds sites with a full (exact) match of a listing photo: a strong signal. */
  fullOnClassifieds: string[];
  /** Other pages with a full match (soft signal). */
  fullElsewhere: string[];
  /** Partial matches (common for the same model; recorded only). */
  partialCount: number;
  checkedPhotos: number;
}

export interface Check {
  name: CheckName;
  status: CheckStatus;
  /** A hard check: a confident mismatch makes the outcome red. */
  hard: boolean;
  confidence: Confidence | null;
  extracted: Record<string, unknown>;
  /** For admins (and, for failed checks, the seller). */
  reason: string;
  /** Owner check waiting for the seller's identity: doesn't make the outcome yellow on its own. */
  identityPending?: boolean;
}

export interface ListingFacts {
  vin: string;
  mileageKm: number;
  exteriorColor: string | null;
  bodyStyle: string | null;
  sellerType: "private" | "dealer";
  dealerName: string | null;
  /** The accepted (or submitted) dealer inspection's mileage, if any. */
  dealerReportMileageKm: number | null;
  issuedCode: string | null;
  sellerIsOwner: boolean;
  hasAuthorisation: boolean;
  identity: { verified: boolean; name: string | null };
}

export const KM_TOLERANCE = 1000;
export const MILES_TOLERANCE = 600;
const KM_PER_MILE = 1.609344;

/** Uppercase letters and digits only: "wba 8e9c5 5gk-123456" -> "WBA8E9C55GK123456". */
export function normaliseVin(v: string | null | undefined): string {
  return (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function normaliseCode(v: string | null | undefined): string {
  return (v ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Lowercase words without diacritics: "Jüri Õunapuu-Tamm" -> ["juri", "ounapuu", "tamm"]. */
export function nameTokens(name: string | null | undefined): string[] {
  return (name ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[øØ]/g, "o")
    .replace(/[æÆ]/g, "ae")
    .replace(/ß/g, "ss")
    .replace(/[łŁ]/g, "l")
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 1);
}

/**
 * Do two person names match? Case, diacritics and the order of first and last names
 * don't matter; a middle name on only one side is fine. At least two names must agree
 * (first and last), or all of them when one side has a single name.
 */
export function namesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = new Set(nameTokens(a));
  const y = new Set(nameTokens(b));
  if (!x.size || !y.size) return false;
  const common = [...x].filter((t) => y.has(t)).length;
  const smaller = Math.min(x.size, y.size);
  return common >= Math.min(2, smaller) && common === smaller;
}

const LEGAL_FORMS = new Set([
  "ou", "as", "oy", "oyj", "ab", "gmbh", "ag", "kg", "ug", "ltd", "limited", "plc", "llc", "sia", "uab", "sa", "sas", "sarl",
  "srl", "spa", "bv", "nv", "aps", "a", "s", "sro", "spzoo", "sp", "zoo", "kft", "doo", "ehf", "co", "company", "inc", "eood", "ood",
]);

/** A company name without its legal form and punctuation: "AUTO PLUS OÜ" -> "auto plus". */
export function companyKey(name: string | null | undefined): string {
  return nameTokens(name)
    .filter((t) => !LEGAL_FORMS.has(t))
    .join(" ");
}

export function companiesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = companyKey(a);
  const y = companyKey(b);
  return Boolean(x) && x === y;
}

const COLOUR_WORDS: Record<string, string> = {
  black: "black", schwarz: "black", must: "black", noir: "black", nero: "black",
  white: "white", weiss: "white", valge: "white", blanc: "white", bianco: "white", pearl: "white",
  silver: "silver", grey: "grey", gray: "grey", graphite: "grey", anthracite: "grey", hall: "grey", gunmetal: "grey",
  red: "red", rot: "red", punane: "red", rosso: "red", burgundy: "red", maroon: "red",
  blue: "blue", blau: "blue", sinine: "blue", navy: "blue", bleu: "blue",
  green: "green", gruen: "green", roheline: "green", british: "green",
  yellow: "yellow", gelb: "yellow", kollane: "yellow", gold: "yellow",
  orange: "orange", brown: "brown", beige: "brown", bronze: "brown", purple: "purple", violet: "purple",
};

function colourFamily(c: string | null | undefined): string | null {
  for (const t of nameTokens(c)) if (COLOUR_WORDS[t]) return COLOUR_WORDS[t]!;
  return null;
}

const NEAR: Record<string, string[]> = { grey: ["silver"], silver: ["grey", "white"], white: ["silver"] };

const BODY_WORDS: Record<string, string> = {
  coupe: "coupe", sedan: "sedan", saloon: "sedan", estate: "estate", wagon: "estate", touring: "estate", avant: "estate",
  hatchback: "hatchback", hatch: "hatchback", convertible: "convertible", cabriolet: "convertible", cabrio: "convertible",
  roadster: "convertible", spider: "convertible", spyder: "convertible", suv: "suv", crossover: "suv", offroad: "suv",
};

function bodyFamily(b: string | null | undefined): string | null {
  for (const t of nameTokens(b)) if (BODY_WORDS[t]) return BODY_WORDS[t]!;
  return null;
}

function lowest(...c: (Confidence | null | undefined)[]): Confidence {
  if (c.includes("low")) return "low";
  if (c.includes("medium")) return "medium";
  return "high";
}

const confident = (c: Confidence) => c !== "low";

export function checkCode(e: Extracted, issued: string | null): Check {
  const read = normaliseCode(e.challenge_code.value);
  const base = { name: "code" as const, hard: true, confidence: e.challenge_code.confidence, extracted: { read: e.challenge_code.value, issued } };
  if (!issued) return { ...base, status: "warn", reason: "No code was issued for these photos." };
  if (!read) return { ...base, status: "warn", reason: "The code on the paper couldn't be read." };
  if (read === normaliseCode(issued)) return { ...base, status: "pass", reason: "The code on the paper matches the issued code." };
  if (!confident(e.challenge_code.confidence)) return { ...base, status: "warn", reason: `The code was read as ${read} with low confidence; the issued code is ${issued}.` };
  return { ...base, status: "fail", reason: `The code on the paper (${read}) isn't the issued code (${issued}).` };
}

export function checkVin(e: Extracted, listingVin: string): Check {
  const listing = normaliseVin(listingVin);
  const plate = normaliseVin(e.plate_vin.value);
  const certs = e.certificate_vins.values.map(normaliseVin).filter(Boolean);
  const confidence = lowest(e.plate_vin.confidence, e.certificate_vins.confidence);
  const base = { name: "vin" as const, hard: true, confidence, extracted: { listing, plate: plate || null, certificate: certs } };
  const plateMismatch = Boolean(plate) && plate !== listing;
  const certMismatch = certs.length > 0 && !certs.includes(listing);
  if (plateMismatch && confident(e.plate_vin.confidence)) {
    return { ...base, status: "fail", reason: `The VIN on the plate (${plate}) doesn't match the listing's VIN (${listing}).` };
  }
  if (certMismatch && confident(e.certificate_vins.confidence)) {
    return { ...base, status: "fail", reason: `The VIN on the registration certificate (${certs.join(", ")}) doesn't match the listing's VIN (${listing}).` };
  }
  if (!plate) return { ...base, status: "warn", reason: "The VIN on the plate couldn't be read." };
  if (!certs.length) return { ...base, status: "warn", reason: "The VIN on the registration certificate couldn't be read." };
  if (plateMismatch || certMismatch) return { ...base, status: "warn", reason: "A VIN was read with low confidence and doesn't match. Compare the photos." };
  if (!confident(confidence)) return { ...base, status: "warn", reason: "The VINs match, but one was read with low confidence." };
  return { ...base, status: "pass", reason: "The VIN on the plate, the listing and the registration certificate match." };
}

export function checkMileage(e: Extracted, listingKm: number, dealerReportKm: number | null): Check {
  const { value, unit, confidence } = e.odometer;
  const base = { name: "mileage" as const, hard: false, confidence, extracted: { read: value, unit, listing_km: listingKm, dealer_report_km: dealerReportKm } };
  if (value === null || !unit) return { ...base, status: "warn", reason: "The odometer couldn't be read." };
  const readKm = unit === "mi" ? value * KM_PER_MILE : value;
  const diff = unit === "mi" ? Math.abs(value - listingKm / KM_PER_MILE) : Math.abs(value - listingKm);
  const tolerance = unit === "mi" ? MILES_TOLERANCE : KM_TOLERANCE;
  if (dealerReportKm !== null && readKm + 1 < dealerReportKm) {
    return { ...base, status: "warn", reason: `The odometer (${value.toLocaleString("en-GB")} ${unit}) is lower than the dealer report's ${dealerReportKm.toLocaleString("en-GB")} km.` };
  }
  if (diff > tolerance) {
    return {
      ...base,
      status: "warn",
      reason: `The odometer shows ${value.toLocaleString("en-GB")} ${unit}; the listing says ${listingKm.toLocaleString("en-GB")} km (more than ${tolerance.toLocaleString("en-GB")} ${unit} apart).`,
    };
  }
  if (!confident(confidence)) return { ...base, status: "warn", reason: "The odometer matches, but was read with low confidence." };
  return { ...base, status: "pass", reason: "The odometer matches the listing's mileage." };
}

export function checkOwner(e: Extracted, f: ListingFacts): Check {
  const owners = e.certificate_owners.values;
  const confidence = e.certificate_owners.confidence;
  const base = {
    name: "owner" as const,
    hard: true,
    confidence,
    extracted: { certificate_owners: owners, verified_name: f.identity.name, dealer_name: f.dealerName, seller_is_owner: f.sellerIsOwner, authorisation: e.authorisation },
  };
  if (!owners.length) return { ...base, status: "warn", reason: "The owner's name on the registration certificate couldn't be read." };
  if (f.sellerType === "dealer" && f.dealerName && owners.some((o) => companiesMatch(o, f.dealerName))) {
    return { ...base, status: "pass", reason: "The owner on the certificate is the dealer's company." };
  }
  if (!f.sellerIsOwner) {
    if (!f.hasAuthorisation) return { ...base, status: "fail", reason: "The seller isn't the owner and hasn't uploaded the owner's authorisation." };
    return { ...base, status: "warn", reason: "The seller isn't the registered owner: check the owner's signed authorisation." };
  }
  if (!f.identity.verified || !f.identity.name) {
    return { ...base, status: "warn", identityPending: true, reason: "identity not verified yet" };
  }
  if (owners.some((o) => namesMatch(o, f.identity.name))) {
    return { ...base, status: confident(confidence) ? "pass" : "warn", reason: confident(confidence) ? "The owner on the certificate matches the seller's verified name." : "The names match, but the certificate was read with low confidence." };
  }
  if (!confident(confidence)) return { ...base, status: "warn", reason: "The owner's name doesn't match, but was read with low confidence." };
  return { ...base, status: "fail", reason: "The owner on the registration certificate isn't the seller's verified name, and there's no owner authorisation." };
}

export function checkAppearance(e: Extracted, exteriorColor: string | null, bodyStyle: string | null): Check {
  const seenColour = colourFamily(e.vehicle_colour.value);
  const listedColour = colourFamily(exteriorColor);
  const seenBody = bodyFamily(e.body_type.value);
  const listedBody = bodyFamily(bodyStyle);
  const confidence = lowest(e.vehicle_colour.confidence, e.body_type.confidence);
  const base = { name: "appearance" as const, hard: false, confidence, extracted: { colour: e.vehicle_colour.value, body: e.body_type.value, listing_colour: exteriorColor, listing_body: bodyStyle } };
  const problems: string[] = [];
  if (seenColour && listedColour && seenColour !== listedColour && !(NEAR[listedColour] ?? []).includes(seenColour) && confident(e.vehicle_colour.confidence)) {
    problems.push(`the colour looks ${e.vehicle_colour.value}, the listing says ${exteriorColor}`);
  }
  if (seenBody && listedBody && seenBody !== listedBody && confident(e.body_type.confidence)) {
    problems.push(`the body looks like a ${e.body_type.value}, the listing says ${bodyStyle}`);
  }
  if (problems.length) return { ...base, status: "warn", reason: `Possible mismatch: ${problems.join("; ")}.` };
  return { ...base, status: "pass", reason: "The colour and body type are plausible." };
}

export function checkImages(images: ImageSearch | null): Check {
  const base = { name: "images" as const, hard: true, confidence: null, extracted: images ? { ...images } : {} };
  if (!images) return { ...base, status: "pass", reason: "Not run: reverse image search isn't set up." };
  if (images.fullOnClassifieds.length) {
    return { ...base, status: "fail", reason: `Listing photos appear on other car sites: ${images.fullOnClassifieds.slice(0, 3).join(", ")}.` };
  }
  if (images.fullElsewhere.length) {
    return { ...base, status: "warn", reason: `Listing photos appear elsewhere online: ${images.fullElsewhere.slice(0, 3).join(", ")}.` };
  }
  return {
    ...base,
    status: "pass",
    reason: images.partialCount ? `No exact copies found (${images.partialCount} similar images, normal for the same model).` : "No copies of the photos found elsewhere.",
  };
}

export function runComparisons(e: Extracted, f: ListingFacts): Check[] {
  return [
    checkCode(e, f.issuedCode),
    checkVin(e, f.vin),
    checkMileage(e, f.mileageKm, f.dealerReportMileageKm),
    checkOwner(e, f),
    checkAppearance(e, f.exteriorColor, f.bodyStyle),
    checkImages(e.images),
  ];
}

/**
 * Green: every check passes (the owner check may still wait for the seller's identity).
 * Red: a hard check failed (code, VIN, owner without authorisation, photos on other car sites).
 * Yellow: anything else (an uncertain value, low confidence, mileage outside tolerance, a soft mismatch).
 */
export function outcomeOf(checks: Check[]): { outcome: Outcome; waitingForIdentity: boolean; reasons: string[] } {
  const failed = checks.filter((c) => c.status === "fail");
  const warned = checks.filter((c) => c.status === "warn" && !c.identityPending);
  const waitingForIdentity = checks.some((c) => c.identityPending);
  if (failed.length) return { outcome: "red", waitingForIdentity, reasons: failed.map((c) => c.reason) };
  if (warned.length) return { outcome: "yellow", waitingForIdentity, reasons: warned.map((c) => c.reason) };
  return { outcome: "green", waitingForIdentity, reasons: [] };
}

/** Any value the model wasn't sure about (then the stronger model reads it once more). */
export function hasLowConfidence(e: Extracted): boolean {
  return [e.challenge_code.confidence, e.plate_vin.confidence, e.odometer.confidence, e.certificate_vins.confidence, e.certificate_owners.confidence].includes(
    "low",
  );
}
