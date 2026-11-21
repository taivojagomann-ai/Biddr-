import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { COUNTRY_NAMES } from "@/lib/countries";
import type { InvoiceRow } from "./issue";
import type { ReceiptRow } from "@/lib/receipts/issue";

// Liberation Sans (SIL Open Font License, lib/invoice/fonts/OFL.txt): covers every
// European letter, so names and car titles like "Škoda" or "Ģirts" print correctly.
const FONT_DIR = join(process.cwd(), "lib", "invoice", "fonts");
let fonts: Promise<[Uint8Array, Uint8Array]> | null = null;
const loadFonts = () =>
  (fonts ??= Promise.all([readFile(join(FONT_DIR, "LiberationSans-Regular.ttf")), readFile(join(FONT_DIR, "LiberationSans-Bold.ttf"))]).then(
    ([r, b]) => [new Uint8Array(r), new Uint8Array(b)] as [Uint8Array, Uint8Array],
  ));

const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "EUR", minimumFractionDigits: 2 });
export const formatCents = (cents: number) => money.format(cents / 100);
const formatDate = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Tallinn" }).format(new Date(iso));
const countryName = (code: string) => (COUNTRY_NAMES as Record<string, string>)[code] ?? code;
const rateText = (rate: number) => `${Number(rate).toLocaleString("en-GB", { maximumFractionDigits: 2 })}%`;

const INK = rgb(0.06, 0.06, 0.07);
const MUTE = rgb(0.38, 0.38, 0.42);
const LINE = rgb(0.85, 0.85, 0.87);
const SIGNAL = rgb(0.85, 0.27, 0.04);

/** The invoice or credit note as an A4 PDF. `testMode` adds a "not a valid invoice" line (sandbox). */
export async function renderInvoicePdf(inv: InvoiceRow, { testMode }: { testMode: boolean }): Promise<Uint8Array> {
  const [regularBytes, boldBytes] = await loadFonts();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });
  const credit = inv.kind === "credit_note";
  const title = credit ? "Credit note" : "Invoice";
  doc.setTitle(`${title} ${inv.number}`);
  doc.setAuthor(inv.details.issuer.name);
  doc.setLanguage("en-GB");

  const page = doc.addPage([595.28, 841.89]);
  const left = 56;
  const right = 595.28 - 56;
  let y = 841.89 - 64;

  const text = (s: string, x: number, yy: number, o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; align?: "left" | "right" } = {}) => {
    const font = o.font ?? regular;
    const size = o.size ?? 10;
    const w = font.widthOfTextAtSize(s, size);
    page.drawText(s, { x: o.align === "right" ? x - w : x, y: yy, size, font, color: o.color ?? INK });
  };
  const rule = (yy: number) => page.drawLine({ start: { x: left, y: yy }, end: { x: right, y: yy }, thickness: 0.75, color: LINE });

  // Header: wordmark and document title.
  text("Biddr", left, y, { font: bold, size: 24 });
  page.drawCircle({ x: left + bold.widthOfTextAtSize("Biddr", 24) + 4, y: y + 2.5, size: 2.6, color: SIGNAL });
  text(title.toUpperCase(), right, y + 2, { font: bold, size: 18, align: "right" });
  y -= 22;
  if (testMode) {
    text("Test mode (Stripe sandbox): not a valid invoice.", right, y, { size: 9, color: SIGNAL, align: "right" });
  }
  y -= 26;

  // Number and dates (right), issuer (left).
  const meta: [string, string][] = [
    [`${title} number`, inv.number],
    ["Date of issue", formatDate(inv.issued_at)],
  ];
  if (credit && inv.details.credits) meta.push(["Credits invoice", `${inv.details.credits.number} (${formatDate(inv.details.credits.issuedAt)})`]);
  if (!credit && inv.details.paidAt) meta.push(["Paid on", formatDate(inv.details.paidAt)]);

  const issuer = inv.details.issuer;
  const fromLines = [issuer.name, ...issuer.addressLines, `Registry code ${issuer.registryCode}`, `VAT number ${issuer.vatNumber}`, issuer.email];
  let yl = y;
  text("From", left, yl, { font: bold, size: 9, color: MUTE });
  yl -= 15;
  fromLines.forEach((l, i) => {
    text(l, left, yl, { font: i === 0 ? bold : regular });
    yl -= 14;
  });
  let yr = y;
  for (const [k, v] of meta) {
    text(k, right - 190, yr, { size: 9, color: MUTE });
    text(v, right, yr, { font: bold, size: 10, align: "right" });
    yr -= 16;
  }
  yr -= 10;
  text("Bill to", right - 190, yr, { font: bold, size: 9, color: MUTE });
  yr -= 15;
  text(inv.details.buyer.name, right - 190, yr, { font: bold });
  yr -= 14;
  if (inv.details.buyer.email) {
    text(inv.details.buyer.email, right - 190, yr);
    yr -= 14;
  }
  y = Math.min(yl, yr) - 24;

  // The line: description and amount.
  text("Description", left, y, { font: bold, size: 9, color: MUTE });
  text("Amount", right, y, { font: bold, size: 9, color: MUTE, align: "right" });
  y -= 8;
  rule(y);
  y -= 18;
  const descWidth = right - left - 120;
  for (const l of wrap(inv.details.line.description, bold, 11, descWidth)) {
    text(l, left, y, { font: bold, size: 11 });
    y -= 15;
  }
  text(formatCents(inv.total_cents), right, y + 15, { font: bold, size: 11, align: "right" });
  const sub = [
    `Winning bid ${formatCents(inv.details.line.winningBid * 100)}`,
    inv.details.line.basis,
    `Car located in ${countryName(inv.details.line.carCountry)}`,
  ];
  for (const s of sub) for (const l of wrap(s, regular, 9.5, descWidth)) {
    text(l, left, y, { size: 9.5, color: MUTE });
    y -= 13;
  }
  y -= 8;
  rule(y);
  y -= 20;

  // Totals.
  const totals: [string, string, boolean][] = [
    ["Amount excluding VAT", formatCents(inv.net_cents), false],
    [`VAT ${rateText(inv.vat_rate)} (${countryName(inv.vat_country)})`, formatCents(inv.vat_cents), false],
    [credit ? "Total credited (EUR)" : "Total (EUR)", formatCents(inv.total_cents), true],
  ];
  for (const [k, v, strong] of totals) {
    text(k, right - 190, y, { font: strong ? bold : regular, size: strong ? 11 : 10 });
    text(v, right, y, { font: strong ? bold : regular, size: strong ? 11 : 10, align: "right" });
    y -= strong ? 20 : 16;
  }
  y -= 14;

  // Payment.
  text(credit ? "Refund" : "Payment", left, y, { font: bold, size: 9, color: MUTE });
  y -= 15;
  text(credit ? "Refunded to the buyer's card." : "Paid in full by card. Nothing is due.", left, y);
  y -= 15;
  for (const p of inv.details.payments) {
    text(`${p.label}: ${formatCents(p.amountCents)}${p.reference ? `  (Stripe ${p.reference})` : ""}`, left, y, { size: 9.5, color: MUTE });
    y -= 13;
  }
  y -= 18;

  // Notes.
  const notes = credit
    ? [`This credit note cancels invoice ${inv.details.credits?.number ?? ""} in full.`]
    : [
        "The buyer's premium includes VAT. Biddr's service is the intermediation of the car's sale.",
        "The car itself is paid directly to the seller and is not part of this invoice.",
      ];
  for (const n of notes) for (const l of wrap(n, regular, 9, right - left)) {
    text(l, left, y, { size: 9, color: MUTE });
    y -= 12;
  }

  footer(page, regular, `${issuer.name}  ·  Registry code ${issuer.registryCode}  ·  VAT ${issuer.vatNumber}  ·  ${issuer.email}`);
  return doc.save();
}

function footer(page: PDFPage, font: PDFFont, s: string) {
  const size = 8;
  const w = font.widthOfTextAtSize(s, size);
  page.drawText(s, { x: (595.28 - w) / 2, y: 36, size, font, color: MUTE });
}

/** Splits text into lines that fit `width`. */
function wrap(s: string, font: PDFFont, size: number, width: number): string[] {
  const words = s.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(next, size) <= width || !line) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

const formatDateTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Tallinn",
    timeZoneName: "short",
  }).format(new Date(iso));

const cardText = (c: { brand: string | null; last4: string | null }) =>
  c.last4 ? `${c.brand ? c.brand.charAt(0).toUpperCase() + c.brand.slice(1) : "Card"} •••• ${c.last4}` : null;

/**
 * A receipt (or refund receipt) as an A4 PDF: the same generator, fonts, branding,
 * company details and VAT breakdown as the invoice it settles.
 */
export async function renderReceiptPdf(r: ReceiptRow, { testMode }: { testMode: boolean }): Promise<Uint8Array> {
  const [regularBytes, boldBytes] = await loadFonts();
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular = await doc.embedFont(regularBytes, { subset: true });
  const bold = await doc.embedFont(boldBytes, { subset: true });
  const refund = r.type === "refund";
  const title = refund ? "Refund receipt" : "Receipt";
  doc.setTitle(`${title} ${r.number}`);
  doc.setAuthor(r.details.payee.name);
  doc.setLanguage("en-GB");

  const page = doc.addPage([595.28, 841.89]);
  const left = 56;
  const right = 595.28 - 56;
  let y = 841.89 - 64;
  const text = (s: string, x: number, yy: number, o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; align?: "left" | "right" } = {}) => {
    const font = o.font ?? regular;
    const size = o.size ?? 10;
    const w = font.widthOfTextAtSize(s, size);
    page.drawText(s, { x: o.align === "right" ? x - w : x, y: yy, size, font, color: o.color ?? INK });
  };
  const rule = (yy: number) => page.drawLine({ start: { x: left, y: yy }, end: { x: right, y: yy }, thickness: 0.75, color: LINE });

  text("Biddr", left, y, { font: bold, size: 24 });
  page.drawCircle({ x: left + bold.widthOfTextAtSize("Biddr", 24) + 4, y: y + 2.5, size: 2.6, color: SIGNAL });
  text(title.toUpperCase(), right, y + 2, { font: bold, size: 18, align: "right" });
  y -= 22;
  if (testMode) text("Test mode (Stripe sandbox): not a valid receipt.", right, y, { size: 9, color: SIGNAL, align: "right" });
  y -= 26;

  const meta: [string, string][] = [
    [`${title} number`, r.number],
    [refund ? "Date and time of refund" : "Date and time of payment", formatDateTime(r.issued_at)],
  ];
  if (r.details.reference.invoiceNumber) meta.push([refund ? "Invoice" : "Settles invoice", r.details.reference.invoiceNumber]);
  if (refund && r.details.refunds) meta.push(["Refers to receipt", r.details.refunds.receiptNumber]);

  const payee = r.details.payee;
  let yl = y;
  text(refund ? "Refunded by" : "Paid to", left, yl, { font: bold, size: 9, color: MUTE });
  yl -= 15;
  [payee.name, ...payee.addressLines, `Registry code ${payee.registryCode}`, `VAT number ${payee.vatNumber}`, payee.email].forEach((l, i) => {
    text(l, left, yl, { font: i === 0 ? bold : regular });
    yl -= 14;
  });
  let yr = y;
  for (const [k, v] of meta) {
    text(k, right - 210, yr, { size: 9, color: MUTE });
    for (const [i, l] of wrap(v, bold, 10, 120).entries()) text(l, right, yr - i * 12, { font: bold, size: 10, align: "right" });
    yr -= 16 + (wrap(v, bold, 10, 120).length - 1) * 12;
  }
  yr -= 10;
  text(refund ? "Refunded to" : "Paid by", right - 210, yr, { font: bold, size: 9, color: MUTE });
  yr -= 15;
  text(r.details.payer.name, right - 210, yr, { font: bold });
  yr -= 14;
  if (r.details.payer.email) {
    text(r.details.payer.email, right - 210, yr);
    yr -= 14;
  }
  y = Math.min(yl, yr) - 20;

  // Reference: the car and the auction.
  text("Reference", left, y, { font: bold, size: 9, color: MUTE });
  y -= 15;
  const ref = [
    r.details.reference.auctionTitle,
    r.details.reference.vin ? `VIN ${r.details.reference.vin}` : null,
    r.details.reference.auctionEndedAt ? `Auction ended ${formatDate(r.details.reference.auctionEndedAt)}` : null,
  ].filter(Boolean) as string[];
  for (const l of ref) {
    text(l, left, y);
    y -= 14;
  }
  y -= 12;

  // The line.
  text("Description", left, y, { font: bold, size: 9, color: MUTE });
  text(refund ? "Refunded" : "Paid", right, y, { font: bold, size: 9, color: MUTE, align: "right" });
  y -= 8;
  rule(y);
  y -= 18;
  const descWidth = right - left - 120;
  const desc = refund ? `Refund of the buyer's premium: ${r.details.reference.auctionTitle}` : r.details.line.description;
  for (const l of wrap(desc, bold, 11, descWidth)) {
    text(l, left, y, { font: bold, size: 11 });
    y -= 15;
  }
  text(formatCents(r.amount), right, y + 15, { font: bold, size: 11, align: "right" });
  for (const s of [
    `Buyer's premium ${formatCents(r.details.line.premium * 100)}: ${r.details.line.basis}`,
    `Winning bid ${formatCents(r.details.line.winningBid * 100)}`,
  ]) for (const l of wrap(s, regular, 9.5, descWidth)) {
    text(l, left, y, { size: 9.5, color: MUTE });
    y -= 13;
  }
  y -= 8;
  rule(y);
  y -= 20;

  // VAT, as on the invoice.
  const totals: [string, string, boolean][] = [
    ["Amount excluding VAT", formatCents(r.net_cents), false],
    [`VAT ${rateText(r.vat_rate)} (${countryName(r.vat_country)})`, formatCents(r.vat_cents), false],
    [refund ? "Total refunded (EUR)" : "Total paid (EUR)", formatCents(r.amount), true],
  ];
  for (const [k, v, strong] of totals) {
    text(k, right - 210, y, { font: strong ? bold : regular, size: strong ? 11 : 10 });
    text(v, right, y, { font: strong ? bold : regular, size: strong ? 11 : 10, align: "right" });
    y -= strong ? 20 : 16;
  }
  y -= 12;

  // Payment details: each charge (or refund), the card and Stripe's reference.
  text(refund ? "Refund details" : "Payment details", left, y, { font: bold, size: 9, color: MUTE });
  y -= 15;
  for (const c of r.charges) {
    const card = cardText(c);
    const line = `${formatCents(c.amountCents)} ${c.label.charAt(0).toLowerCase()}${c.label.slice(1)}${card ? `, ${card}` : ""}`;
    text(line, left, y);
    y -= 13;
    const stripeRef = [c.refund, c.paymentIntent, c.charge].filter(Boolean).join(" · ");
    if (stripeRef) {
      text(`Stripe reference: ${stripeRef}`, left + 10, y, { size: 8.5, color: MUTE });
      y -= 13;
    }
  }
  y -= 10;
  text(refund ? "Refunded to your card. It can take 5–10 days to appear." : "Paid in full. Thank you.", left, y, { font: bold, size: 11 });
  y -= 22;

  const notes = refund
    ? [`This refund refers to receipt ${r.details.refunds?.receiptNumber ?? ""} and invoice ${r.details.reference.invoiceNumber ?? ""}.`]
    : [
        "The buyer's premium includes VAT. The car itself is paid directly to the seller and is not part of this receipt.",
        "Questions about this payment? Write to us with the receipt number and the Stripe reference above.",
      ];
  for (const n of notes) for (const l of wrap(n, regular, 9, right - left)) {
    text(l, left, y, { size: 9, color: MUTE });
    y -= 12;
  }

  footer(page, regular, `${payee.name}  ·  Registry code ${payee.registryCode}  ·  VAT ${payee.vatNumber}  ·  ${payee.email}`);
  return doc.save();
}
