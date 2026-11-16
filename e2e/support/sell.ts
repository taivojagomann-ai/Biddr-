// Fills the sell form step by step, the way a seller would. Shared by the sell
// flow spec and the keyboard-only accessibility check.
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import { randomVin } from "./factory";

export interface SellOptions {
  model?: string;
  vin?: string;
  dealer?: { name: string; registryCode: string };
  damage?: string;
  inspection?: { dealer: string; city: string; country: string; date: string; mileage: string };
  startingBid?: string;
  reserve?: string;
  /** The seller's own carVertical vehicle history report (optional). */
  history?: { file?: boolean; link?: string; share?: boolean };
}

let photo: Buffer | null = null;

/** A real JPEG, made once by screenshotting a coloured box. */
export async function testJpeg(page: Page): Promise<Buffer> {
  if (photo) return photo;
  const p = await page.context().newPage();
  await p.setViewportSize({ width: 640, height: 480 });
  await p.setContent('<body style="margin:0;background:linear-gradient(90deg,#c33,#36c)"></body>');
  photo = await p.screenshot({ type: "jpeg", quality: 70 });
  await p.close();
  return photo;
}

export const continueButton = (page: Page) => page.getByRole("button", { name: "Continue" });

export async function fillCarStep(page: Page, o: SellOptions = {}) {
  await page.getByLabel("Make").selectOption("BMW");
  await page.getByLabel("Model").fill(o.model ?? "M2");
  await page.getByLabel("Variant").fill("Competition");
  await page.getByLabel("Year").fill("2019");
  await page.getByLabel("VIN").fill(o.vin ?? randomVin());
  await page.getByLabel("Mileage (km)").fill("48 500");
  await page.getByLabel("Transmission").fill("7-speed DCT");
  await page.getByLabel("Engine").fill("3.0 L twin-turbo straight-six");
  await page.getByLabel("Drivetrain").selectOption("RWD");
  await page.getByLabel("Exterior colour").fill("Hockenheim Silver");
  await page.getByLabel("Body style").selectOption("coupe");
  await page.getByLabel("Interior colour").fill("Black leather");
  await page.getByLabel("Number of owners").fill("2");
  await page.getByLabel("City where the car is").fill("Munich");
  await page.getByLabel("Country", { exact: true }).selectOption("DE");
  if (o.dealer) {
    await page.getByRole("radio", { name: "Dealer" }).check();
    await page.getByLabel("Company name").fill(o.dealer.name);
    await page.getByLabel("Registry code").fill(o.dealer.registryCode);
  } else {
    await page.getByRole("radio", { name: "Private person" }).check();
  }
  await page.getByLabel("Where is the car registered?").selectOption("DE");
  await page.getByRole("radio", { name: "Yes", exact: true }).check();
}

export async function fillHistoryStep(page: Page, o: SellOptions = {}) {
  if (o.damage) {
    await page.getByRole("radio", { name: /^Yes/ }).check();
    await page.getByLabel("Damage and repair summary").fill(o.damage);
  } else {
    await page.getByRole("radio", { name: /^No/ }).check();
  }
}

export async function fillDetailsStep(page: Page) {
  const highlights = page.getByRole("group", { name: "Highlights" }).getByRole("textbox");
  await highlights.nth(0).fill("Full BMW service history");
  await highlights.nth(1).fill("Two owners from new");
  await highlights.nth(2).fill("Never tracked");
  await page.getByLabel("No modifications, factory specification").check();
  await page.getByLabel("I'm not aware of any flaws").check();
}

export async function fillPhotosStep(page: Page, o: SellOptions = {}) {
  const jpeg = await testJpeg(page);
  const sections: [string, number][] = [["Exterior", 6], ["Interior", 4], ["Engine and underside", 2]];
  if (o.damage) sections.push(["Before repair", 2]);
  for (const [name, n] of sections) {
    const group = page.getByRole("group", { name, exact: true });
    await group.locator('input[type="file"]').setInputFiles(
      Array.from({ length: n }, (_, i) => ({ name: `${name}-${i}.jpg`, mimeType: "image/jpeg", buffer: jpeg })),
    );
    await expect(group.getByText(`${n} of at least ${n} added`)).toBeVisible({ timeout: 60_000 });
  }
}

export async function fillPriceStep(page: Page, o: SellOptions = {}) {
  await page.getByLabel("Starting bid").fill(o.startingBid ?? "20000");
  if (o.reserve) await page.getByLabel("Reserve price").fill(o.reserve);
  if (o.inspection) {
    await page.getByRole("radio", { name: "Yes, I'll upload it" }).check();
    await page.getByLabel("Dealer's name").fill(o.inspection.dealer);
    await page.getByLabel("Dealer's city").fill(o.inspection.city);
    await page.getByLabel("Dealer's country").selectOption(o.inspection.country);
    await page.getByLabel("Inspection date").fill(o.inspection.date);
    await page.getByLabel("Mileage on the report").fill(o.inspection.mileage);
    await page.locator('input[type="file"][accept^="application/pdf"]').first().setInputFiles({
      name: "inspection-report.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"),
    });
    await expect(page.getByRole("list", { name: "Report files" })).toContainText("inspection-report.pdf");
  } else {
    await page.getByRole("radio", { name: "No, list without an inspection" }).check();
  }
}

/** The optional carVertical history report question on the Price and inspection step. */
export async function fillHistoryReport(page: Page, history: SellOptions["history"]) {
  if (!history) {
    await page.getByRole("radio", { name: "No", exact: true }).check();
    return;
  }
  await page.getByRole("radio", { name: "Yes, add it" }).check();
  if (history.file) {
    // The history uploader comes after the dealer report's (if that one is shown).
    await page.locator('input[type="file"][accept^="application/pdf"]').last().setInputFiles({ name: "carvertical-report.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n") });
    await expect(page.getByRole("list", { name: "History report files" })).toContainText("carvertical-report.pdf");
  }
  if (history.link) await page.getByLabel("carVertical share link").fill(history.link);
  if (history.share) await page.getByLabel("I'm allowed to share this report with buyers").check();
}

/** Goes from an empty form to the Review step. */
export async function fillSellForm(page: Page, o: SellOptions = {}) {
  await fillCarStep(page, o);
  await continueButton(page).click();
  await fillHistoryStep(page, o);
  await continueButton(page).click();
  await fillDetailsStep(page);
  await continueButton(page).click();
  await fillPhotosStep(page, o);
  await continueButton(page).click();
  await fillPriceStep(page, o);
  await fillHistoryReport(page, o.history);
  await continueButton(page).click();
  await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
}
