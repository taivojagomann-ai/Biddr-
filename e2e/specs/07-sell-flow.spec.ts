// Area 7: the sell form, from an empty form to "submitted": validation on each
// step, the draft kept on the device, preview, private and dealer sellers,
// accident-repaired cars and the dealer inspection report.
import { test, expect, signIn, expectAccessible } from "../support/fixtures";
import { createAuction, createUser, randomVin, service } from "../support/factory";
import { continueButton, fillCarStep, fillHistoryStep, fillDetailsStep, fillPhotosStep, fillPriceStep, fillSellForm } from "../support/sell";

const recentDate = () => new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10);

async function submit(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("Tick the box to confirm before you submit.")).toBeVisible();
  await page.getByLabel("I confirm the information is accurate and I have the right to sell this car.").check();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByRole("heading", { name: "Thanks, your car is submitted" })).toBeVisible({ timeout: 30_000 });
}

async function submittedListing(sellerId: string, vin: string) {
  const { data } = await service().from("auctions").select("*").eq("seller_id", sellerId).eq("vin", vin).single();
  const { data: priv } = await service().from("auction_private").select("*").eq("auction_id", data!.id).single();
  return { auction: data!, priv: priv! };
}

test.describe("sell flow", () => {
  test.describe.configure({ timeout: 180_000 });

  test("a private seller submits a car: step validation, preview, then a draft waiting for review", async ({ page, context }) => {
    const seller = await createUser();
    await signIn(context, seller);
    await page.goto("/sell");
    await expectAccessible(page, "Sell, step 1");

    // Continue on an empty step shows what's missing.
    await continueButton(page).click();
    await expect(page.getByText("Choose the make.")).toBeVisible();
    await expect(page.getByText("Enter the VIN.")).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Make" })).toHaveAttribute("aria-invalid", "true");
    await page.getByLabel("VIN").fill("WBS-IO0Q");
    await continueButton(page).click();
    await expect(page.getByText(/A VIN has exactly 17 characters/)).toBeVisible();

    const vin = randomVin();
    await fillCarStep(page, { vin });
    await continueButton(page).click();
    await continueButton(page).click();
    await expect(page.getByText("Choose yes or no.")).toBeVisible();
    await fillHistoryStep(page);
    await continueButton(page).click();
    await continueButton(page).click();
    await expect(page.getByText(/List the modifications, or tick/)).toBeVisible();
    await fillDetailsStep(page);
    await continueButton(page).click();
    await continueButton(page).click();
    await expect(page.getByText("Add at least 6 photos here (0 so far).")).toBeVisible();
    await fillPhotosStep(page);
    await continueButton(page).click();

    // Price: minimum starting bid and reserve rules.
    await page.getByLabel("Starting bid").fill("500");
    await page.getByLabel("Reserve price").fill("400");
    await page.getByRole("radio", { name: "No, list without an inspection" }).check();
    await continueButton(page).click();
    await expect(page.getByText("The starting bid must be at least €1,000.")).toBeVisible();
    await page.getByLabel("Starting bid").fill("20 000");
    await continueButton(page).click();
    await expect(page.getByText(/The reserve can't be lower than the starting bid/)).toBeVisible();
    await page.getByLabel("Reserve price").fill("25000");
    await continueButton(page).click();

    // Review and preview.
    await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
    await expect(page.getByText(vin)).toBeVisible();
    await expect(page.getByText("After you submit:").locator("xpath=..")).toHaveText("After you submit: We'll review your listing.");
    await page.getByRole("button", { name: "Preview listing" }).click();
    await expect(page.getByRole("heading", { level: 1, name: /2019 BMW M2 Competition/ })).toBeVisible();
    await page.getByRole("button", { name: "Back to edit" }).first().click();
    await submit(page);

    const { auction, priv } = await submittedListing(seller.id, vin);
    expect(auction).toMatchObject({ status: "draft", seller_type: "private", has_reserve: true, starting_bid: 20_000, condition_type: "clean", mileage_km: 48_500 });
    expect(priv).toMatchObject({ requested_reserve: 25_000, dealer_inspection_provided: false });
    await page.goto("/account/listings");
    await expect(page.getByText(/2019 BMW M2 Competition/).first()).toBeVisible();
  });

  test("answers are kept on this device after a reload, and Start over clears them", async ({ page, context }) => {
    await signIn(context, await createUser());
    await page.goto("/sell");
    await fillCarStep(page, { model: "M4" });
    await continueButton(page).click();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "History" })).toBeVisible();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByLabel("Model")).toHaveValue("M4");
    page.once("dialog", (d) => {
      expect(d.message()).toContain("Start over?");
      void d.accept();
    });
    await page.getByRole("button", { name: "Start over" }).click();
    await expect(page.getByLabel("Model")).toHaveValue("");
  });

  test("a dealer sells an accident-repaired car with a dealer inspection report", async ({ page, context }) => {
    const seller = await createUser({ role: "seller", country: "DE" });
    await signIn(context, seller);
    await page.goto("/sell");
    const vin = randomVin();
    // The damage summary needs some detail.
    await fillCarStep(page, { vin, dealer: { name: "Demo Motors GmbH", registryCode: "HRB 12345" } });
    await continueButton(page).click();
    await fillHistoryStep(page, { damage: "Front bumper" });
    await continueButton(page).click();
    await expect(page.getByText(/at least 40 characters \(now 12\)/)).toBeVisible();
    await page.getByLabel("Damage and repair summary").fill("Front bumper and left headlight replaced after a parking impact in 2024.");
    await continueButton(page).click();
    await fillDetailsStep(page);
    await continueButton(page).click();
    // Accident-repaired cars need Before repair photos.
    await expect(page.getByRole("group", { name: "Before repair", exact: true })).toBeVisible();
    await fillPhotosStep(page, { damage: "yes" });
    await continueButton(page).click();

    // An old report is refused, then a recent one is accepted.
    const inspection = { dealer: "BMW Niederlassung München", city: "Munich", country: "DE", date: "2020-01-01", mileage: "48 400" };
    await fillPriceStep(page, { inspection });
    await continueButton(page).click();
    await expect(page.getByText("The report must be from the last 90 days.")).toBeVisible();
    await page.getByLabel("Inspection date").fill(recentDate());
    await continueButton(page).click();
    await expect(page.getByText("After you submit:").locator("xpath=..")).toHaveText("After you submit: We'll review your listing and check the dealer's inspection report.");
    await submit(page);

    const { auction, priv } = await submittedListing(seller.id, vin);
    expect(auction).toMatchObject({ status: "draft", seller_type: "dealer", dealer_name: "Demo Motors GmbH", condition_type: "restored_accident", has_reserve: false });
    expect(priv).toMatchObject({
      dealer_inspection_provided: true,
      dealer_name: "BMW Niederlassung München",
      dealer_city: "Munich",
      dealer_country: "DE",
      dealer_inspection_mileage_km: 48_400,
      inspection_review_status: "pending",
    });
    // The report is stored privately: no public URL works.
    const path = (priv.dealer_report_paths as string[])[0] ?? "";
    expect(path.startsWith(`${seller.id}/`)).toBe(true);
    const publicUrl = service().storage.from("inspection-uploads").getPublicUrl(path).data.publicUrl;
    expect((await page.request.get(publicUrl)).status()).toBeGreaterThanOrEqual(400);
  });

  test("a VIN that's already listed is refused at submit", async ({ page, context }) => {
    const { vin } = await createAuction({ seller: await createUser({ role: "seller" }) });
    await signIn(context, await createUser());
    await page.goto("/sell");
    await fillSellForm(page, { vin });
    await page.getByLabel("I confirm the information is accurate and I have the right to sell this car.").check();
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByText("This car is already listed or waiting for review.")).toBeVisible({ timeout: 30_000 });
  });

  test("signed out or with an unfinished profile, /sell sends you to finish first", async ({ page, context }) => {
    await page.goto("/sell");
    await expect(page).toHaveURL(/\/login\?next=%2Fsell/);
    await signIn(context, await createUser({ complete: false }));
    await page.goto("/sell");
    await expect(page).toHaveURL(/\/account\/setup\?next=(%2F|\/)sell/);
  });
});
