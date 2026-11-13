import "server-only";
import sharp from "sharp";
import { pixelText, pixelTextWidth } from "./pixel-font";

export const DEMO_PHOTO_WIDTH = 1600;
export const DEMO_PHOTO_HEIGHT = 1067;

/** A car seen from the side, drawn with lines only. Sized for a 1600x1067 canvas. */
const CAR = `
<g fill="none" stroke="#71717A" stroke-width="8" stroke-linecap="round" stroke-linejoin="round">
  <path d="M300 690 L310 610 Q318 575 360 562 L560 528 L690 440 Q730 414 800 410 L1010 410 Q1075 412 1120 450 L1215 528 L1290 540 Q1330 548 1338 590 L1345 690"/>
  <path d="M590 528 L700 452 Q728 434 770 432 L900 432 L900 528 Z"/>
  <path d="M930 432 L1010 432 Q1060 436 1098 470 L1150 528 L930 528 Z"/>
  <path d="M640 690 L1015 690"/>
  <path d="M1290 690 L1345 690"/>
  <path d="M300 690 L370 690"/>
  <circle cx="505" cy="690" r="112"/>
  <circle cx="505" cy="690" r="52"/>
  <circle cx="1152" cy="690" r="112"/>
  <circle cx="1152" cy="690" r="52"/>
  <path d="M1290 585 L1330 590"/>
  <path d="M318 600 L350 596"/>
</g>
<path d="M120 806 L1480 806" stroke="#3F3F46" stroke-width="4"/>`;

function photoSvg(caption: string): string {
  const big = 14;
  const small = 7;
  const title = "DEMO PHOTO";
  const titleX = (DEMO_PHOTO_WIDTH - pixelTextWidth(title, big)) / 2;
  const captionX = (DEMO_PHOTO_WIDTH - pixelTextWidth(caption, small)) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${DEMO_PHOTO_WIDTH}" height="${DEMO_PHOTO_HEIGHT}" viewBox="0 0 ${DEMO_PHOTO_WIDTH} ${DEMO_PHOTO_HEIGHT}">
  <rect width="100%" height="100%" fill="#141416"/>
  <rect x="24" y="24" width="${DEMO_PHOTO_WIDTH - 48}" height="${DEMO_PHOTO_HEIGHT - 48}" fill="none" stroke="#27272A" stroke-width="4"/>
  ${pixelText(title, titleX, 120, big, "#F4F4F5")}
  ${CAR}
  ${pixelText(caption, captionX, 890, small, "#A1A1AA")}
</svg>`;
}

/** A WebP placeholder photo, e.g. caption "EXTERIOR 3". */
export async function renderDemoPhoto(caption: string): Promise<Buffer> {
  return sharp(Buffer.from(photoSvg(caption)))
    .resize(DEMO_PHOTO_WIDTH, DEMO_PHOTO_HEIGHT)
    .webp({ quality: 80 })
    .toBuffer();
}

// -----------------------------------------------------------------------------
// One-page PDF, written by hand: uses the standard Helvetica font (built into every
// PDF reader), so nothing needs embedding and no PDF library is required.
// -----------------------------------------------------------------------------
function pdfEscape(s: string): string {
  // Standard fonts only cover Latin-1; replace anything outside ASCII to stay safe.
  return s.replace(/[^\x20-\x7E]/g, "?").replace(/([()\\])/g, "\\$1");
}

export function renderDemoReportPdf(title: string, lines: string[]): Buffer {
  const content = [
    "BT",
    "/F1 22 Tf 72 760 Td (Demo inspection report) Tj",
    "/F1 13 Tf 0 -34 Td (" + pdfEscape(title) + ") Tj",
    "/F1 11 Tf 0 -22 Td (Placeholder for testing. This is not a real inspection.) Tj",
    ...lines.map((l) => "0 -20 Td (" + pdfEscape(`- ${l}`) + ") Tj"),
    "0 -36 Td (Inspection partner: Demo inspection partner) Tj",
    "ET",
  ].join("\n");

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
