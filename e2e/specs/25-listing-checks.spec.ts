// Area 25: automated fake-listing checks (DECISIONS.md points 16 and 18). On "Verify your
// car" the seller adds what we need (identity check, registration certificate, two camera
// photos with a live code), which is only ever "Added" (neutral), then submits it for
// checking; the results are a separate block. Claude (mocked: e2e/mock-apis.mjs) reads the
// values, the rules in code decide green, yellow or red; Google Vision (mocked) searches
// the photos; Stripe Identity is simulated (lib/stripe-sim.ts). Approve and schedule waits
// for a verified seller and green checks, or an admin's logged override.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, signIn, expectAccessible, expectNoHorizontalScroll } from "../support/fixtures";
import { userDb } from "../support/supabase";
import { createAuction, createUser, getAuction, iso, notificationsFor, service, DAY, type TestUser } from "../support/factory";
import { APP_URL, CRON_SECRET } from "../support/env";
import { sendWebhook } from "../support/stripe";

test.describe.configure({ timeout: 180_000 });

const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
const VERIFIED_NAME = "E2E Private Name";
const draft = (seller: TestUser, model = "M3", extra: Parameters<typeof createAuction>[0] = { seller }) =>
  createAuction({ ...extra, seller, model, status: "draft", startsAt: iso(2 * DAY), endsAt: iso(5 * DAY), checks: false });

async function verification(auctionId: string) {
  const { data } = await service().from("listing_verifications").select("*").eq("auction_id", auctionId).maybeSingle();
  return data as Record<string, unknown> | null;
}

/** A seller who verified their identity earlier (it's once per member). */
async function verifiedSeller() {
  const seller = await createUser({ role: "seller" });
  await service()
    .from("profiles")
    .update({ identity_status: "verified", identity_verified_name: VERIFIED_NAME, identity_verified_at: new Date().toISOString() })
    .eq("id", seller.id);
  return seller;
}

const row = (page: Page, key: string) => page.locator(`[data-input="${key}"]`);
const result = (page: Page) => page.locator("[data-result]");

/** Adds the registration certificate (a PDF): "Add" opens the form under the row. */
async function addRegistration(page: Page) {
  const input = page.getByLabel("Registration certificate", { exact: true });
  if (!(await input.isVisible())) await page.getByRole("button", { name: /^(Add|Replace): Registration certificate$/ }).click();
  await input.setInputFiles({ name: "registration.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(page.getByText("registration.pdf").first()).toBeVisible();
  await page.getByRole("button", { name: "Save documents" }).click();
  await expect(page.getByText("Saved. Submit for checking when everything required is added.")).toBeVisible();
}

/** Takes one photo with the fake camera. */
async function shoot(page: Page, title: RegExp) {
  await page.getByRole("button", { name: title }).click();
  const camera = page.getByRole("dialog", { name: /^Camera:/ });
  await expect(camera).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.querySelector("video")?.videoWidth ?? 0)).toBeGreaterThan(0);
  await expect(camera.getByRole("button", { name: "Take photo" })).toBeFocused();
  await camera.getByRole("button", { name: "Take photo" }).click();
  await expect(camera).toBeHidden();
}

/** The photo panel ("Start" or "Retake" on the VIN plate row opens it). */
async function photoPanel(page: Page) {
  const panel = page.locator("#panel-photos");
  if (!(await panel.isVisible())) await page.getByRole("button", { name: /^(Start|Retake): VIN plate photo with code$/ }).click();
  await expect(panel).toBeVisible();
  return panel;
}

/** The live challenge: a code, two camera photos, send. */
async function takeChallenge(page: Page, { newCode = true, expectSaved = true } = {}) {
  const photos = await photoPanel(page);
  // A code that is still valid is offered again (retakes within 15 minutes use it).
  if (newCode && !(await photos.getByLabel(/^Code: /).isVisible())) {
    await photos.getByRole("button", { name: /^Get (a|a new) code( to retake them)?$/ }).click();
  }
  await expect(photos.getByLabel(/^Code: /)).toBeVisible();
  await shoot(page, /^Open the camera for Photo 1/);
  await expect(photos.getByRole("img", { name: /Your photo: Photo 1/ })).toBeVisible();
  await expect(photos.getByRole("button", { name: /^Retake Photo 1/ })).toBeVisible();
  await shoot(page, /^Open the camera for Photo 2/);
  await photos.getByRole("button", { name: "Send both photos" }).click();
  if (expectSaved) await expect(page.getByText("Photos saved. Submit for checking when everything required is added.")).toBeVisible();
}

/** "Submit for checking", then the result block (the checks take a moment). */
async function submit(page: Page) {
  await page.getByRole("button", { name: "Submit for checking" }).click();
  await expect(result(page)).toBeVisible({ timeout: 60_000 });
}

function writeIdentity(userId: string, r: Record<string, string>) {
  const dir = join(process.cwd(), "e2e", ".state");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "identity-sim.json");
  const all = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
  all[userId] = r;
  writeFileSync(file, JSON.stringify(all));
}

/** "Start" on the identity row: Stripe's page (simulated), where the seller submits the documents. */
async function startIdentity(page: Page, seller: TestUser) {
  writeIdentity(seller.id, { status: "processing" });
  await row(page, "identity").getByRole("button", { name: "Start" }).click();
  await expect(page).toHaveURL(/\/verify\?identity=return/);
  await expect(row(page, "identity")).toHaveAttribute("data-state", "added");
  await expect(row(page, "identity")).toContainText("Stripe is confirming it.");
}

/** Stripe's webhook: the identity is verified. */
async function stripeVerifies(request: Parameters<typeof sendWebhook>[0], seller: TestUser, name = { first: "E2E Private", last: "Name" }) {
  const { data: p } = await service().from("profiles").select("identity_session_id").eq("id", seller.id).single();
  writeIdentity(seller.id, { status: "verified", first_name: name.first, last_name: name.last, country: "EE" });
  const { res } = await sendWebhook(request, "identity.verification_session.verified", {
    id: p!.identity_session_id,
    object: "identity.verification_session",
    status: "verified",
    metadata: { user_id: seller.id },
  });
  expect(res.status()).toBe(200);
}

/** Everything required by a verified seller, submitted. */
async function addAllAndSubmit(page: Page) {
  await addRegistration(page);
  await takeChallenge(page);
  await submit(page);
}

async function asAdmin(context: BrowserContext, admin: TestUser & { totpSecret?: string }) {
  await signIn(context, admin);
}

test.describe("the seller verifies the car", () => {
  test("inputs are only ever added (neutral), submit runs the checks, results are separate; identity verified; then it can be scheduled", async ({ page, context, request, seed, isMobile }) => {
    const seller = await createUser({ role: "seller" });
    const a = await draft(seller);
    await signIn(context, seller);
    await context.grantPermissions(["camera"], { origin: APP_URL });

    await page.goto("/account/listings");
    await expect(page.locator("[data-verify-status]").first()).toHaveAttribute("data-verify-status", "todo");
    await expect(page.locator("[data-verify-status]").first()).toContainText("Verify your car: 0 of 4 required items added.");
    await page.getByRole("link", { name: `Verify your car for ${a.title}` }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Verify your car" })).toBeVisible();
    for (const name of ["How verification works", "What we need from you"]) await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Check results" })).toHaveCount(0);
    await expect(page.getByText("Your documents are only seen by Biddr. Buyers see a Verified seller badge.")).toBeVisible();
    await expect(page.getByText("0 of 4 required items added")).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit for checking" })).toBeDisabled();
    for (const key of ["identity", "registration", "vin_photo", "dashboard_photo", "dealer_report", "history_report"]) {
      await expect(row(page, key)).toHaveAttribute("data-state", "not-added");
    }
    await expect(row(page, "dealer_report")).toContainText("Optional");
    await expect(row(page, "authorisation")).toHaveCount(0);
    await expectAccessible(page, "Verify your car");

    await startIdentity(page, seller);
    await addRegistration(page);
    await expect(row(page, "registration")).toHaveAttribute("data-state", "added");
    await expect(row(page, "registration")).toContainText(/Added \d/);

    // The two photos can only be taken with the camera: no file input, and the reason why.
    const photos = await photoPanel(page);
    await expect(photos.locator('input[type="file"]')).toHaveCount(0);
    await expect(photos).toContainText("Uploading photos from your gallery isn't possible here");
    await takeChallenge(page);
    await page.reload();
    await expect(page.getByText("4 of 4 required items added")).toBeVisible();
    // Added is never green: adding isn't passing.
    await expect(page.locator('#what-we-need [data-status-icon="passed"]')).toHaveCount(0);
    await expect(page.locator('#what-we-need [data-status-icon="added"]')).toHaveCount(4);

    await submit(page);
    // Stripe hasn't confirmed the identity yet: the owner check waits, so it's still "Checking…".
    await expect(result(page)).toHaveAttribute("data-result", "checking");
    await expect(result(page)).toContainText("Waiting for Stripe to confirm your identity.");
    const checks = page.locator("[data-check]");
    await expect(checks).toHaveCount(5);
    await expect(page.locator('[data-check="code"]')).toHaveAttribute("data-state", "passed");
    await expect(page.locator('[data-check="vin"]')).toHaveAttribute("data-state", "passed");
    await expect(page.locator('[data-check="mileage"]')).toHaveAttribute("data-state", "passed");
    await expect(page.locator('[data-check="images"]')).toHaveAttribute("data-state", "passed");
    await expect(page.locator('[data-check="owner"]')).toHaveAttribute("data-state", "waiting");
    await expect(page.locator('[data-check="owner"]')).toContainText("Owner matches: Waiting");
    await expect(page.locator('[data-check="owner"] [data-status-icon="waiting"]')).toBeVisible();
    // Submitted: read-only now.
    await expect(page.getByRole("button", { name: "Submit for checking" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^(Replace|Retake):/ })).toHaveCount(0);
    await page.evaluate(() => window.scrollTo(0, 0));
    await expectAccessible(page, "Verify your car: check results");
    if (isMobile) {
      await expectNoHorizontalScroll(page, "Verify your car on a phone");
      // The overall result is in view without scrolling.
      await page.reload();
      await expect(result(page).locator('[role="status"]')).toBeInViewport();
    }

    const v = await verification(a.id);
    expect(v).toMatchObject({ outcome: "green", waiting_for_identity: true, on_hold: false, needs_admin: false, run_count: 1 });
    const { data: rows } = await service().from("listing_checks").select("check_name, status").eq("auction_id", a.id);
    expect(rows!.map((c) => c.check_name).sort()).toEqual(["appearance", "code", "images", "mileage", "owner", "vin"]);
    const { data: costs } = await service().from("listing_check_costs").select("provider, model, input_tokens, output_tokens").eq("auction_id", a.id);
    expect(costs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: "anthropic", model: "claude-sonnet-5-5", input_tokens: 2400, output_tokens: 180 }),
        expect.objectContaining({ provider: "google_vision" }),
      ]),
    );
    // The originals are private: no member can read them.
    const { data: own } = await (await userDb(seller.email)).from("listing_verifications").select("auction_id");
    expect(own ?? []).toEqual([]);

    if (isMobile) return; // Stripe and the admin part run on desktop
    await stripeVerifies(request, seller);
    // The owner check ran again with the verified name (no API call): all passed.
    await expect.poll(async () => (await verification(a.id))?.waiting_for_identity).toBe(false);
    expect((await verification(a.id))?.run_count).toBe(1);
    await page.reload();
    await expect(result(page)).toHaveAttribute("data-result", "passed");
    await expect(result(page)).toContainText("All checks passed");
    await expect(page.locator('[data-check="owner"]')).toHaveAttribute("data-state", "passed");
    await page.goto("/account/listings");
    await expect(page.locator("[data-verify-status]").first()).toHaveAttribute("data-verify-status", "passed");

    await asAdmin(context, seed.admin);
    await page.goto(`/admin/auctions/${a.id}`);
    await expect(page.locator("[data-checks-outcome]")).toHaveText("Green");
    await expect(page.getByText("Done: Seller's identity verified")).toBeAttached();
    await page.getByRole("button", { name: "Approve and schedule", exact: true }).click();
    await page.getByRole("dialog").or(page.getByRole("alertdialog")).last().getByRole("button", { name: "Approve and schedule" }).click();
    await expect.poll(async () => (await getAuction<{ status: string }>(a.id)).status).toBe("upcoming");

    // Buyers see "Verified seller" on the seller card.
    await page.goto(`/auctions/${a.id}`);
    await expect(page.getByRole("region", { name: "Seller" })).toContainText("Verified seller");
    await expect(page.getByRole("button", { name: "What does Verified seller mean?" })).toBeVisible();
  });

  test("an expired code is refused and a new one is needed; a blocked camera explains why upload isn't possible", async ({ page, context }) => {
    const seller = await verifiedSeller();
    const a = await draft(seller);
    await signIn(context, seller);
    await context.grantPermissions(["camera"], { origin: APP_URL });
    await page.goto(`/account/listings/${a.id}/verify`);
    const photos = await photoPanel(page);
    await photos.getByRole("button", { name: "Get a code" }).click();
    await expect(photos.getByLabel(/^Code: /)).toBeVisible();
    const code = (await verification(a.id))!.challenge_code as string;
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    // The code runs out while the seller is taking the photos.
    await service().from("listing_verifications").update({ challenge_expires_at: iso(-10 * 60_000) }).eq("auction_id", a.id);
    await takeChallenge(page, { newCode: false, expectSaved: false });
    await expect(page.getByText("The code has expired. Get a new code and take both photos again.")).toBeVisible();
    expect((await verification(a.id))!.vin_photo_path).toBeNull();
    await page.reload();
    const again = await photoPanel(page);
    await expect(again.getByLabel(/^Code: /)).toHaveCount(0);
    await expect(again.getByRole("button", { name: "Get a code" })).toBeVisible();

    // A browser that blocks the camera: the reason, and still no upload.
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: () => Promise.reject(new DOMException("blocked", "NotAllowedError")),
      });
    });
    await page.reload();
    const blocked = await photoPanel(page);
    await blocked.getByRole("button", { name: "Get a code" }).click();
    await blocked.getByRole("button", { name: /^Open the camera for Photo 1/ }).click();
    await expect(page.getByText("Camera access was blocked. Allow the camera for this site in your browser's settings, then try again.")).toBeVisible();
    await expect(blocked.locator('input[type="file"]')).toHaveCount(0);
  });
});

test.describe("photos first, certificate later", () => {
  test.skip(({ isMobile }) => isMobile, "covered on desktop");

  test("the certificate can be added after the code has expired, a new code doesn't spoil the photos sent, and an unfinished run can be submitted again", async ({ page, context }) => {
    const seller = await verifiedSeller();
    const a = await draft(seller);
    await signIn(context, seller);
    await context.grantPermissions(["camera"], { origin: APP_URL });
    await page.goto(`/account/listings/${a.id}/verify`);
    await expect(row(page, "identity")).toHaveAttribute("data-state", "added");

    await takeChallenge(page);
    await page.reload();
    await expect(row(page, "vin_photo")).toHaveAttribute("data-state", "added");
    await expect(row(page, "dashboard_photo")).toHaveAttribute("data-state", "added");
    await expect(row(page, "registration")).toHaveAttribute("data-state", "not-added");
    await expect(page.getByText("3 of 4 required items added")).toBeVisible();
    await expect(page.getByRole("button", { name: "Submit for checking" })).toBeDisabled();
    const sent = await verification(a.id);
    expect(sent).toMatchObject({ outcome: "pending", run_count: 0, photos_code: sent!.challenge_code });

    // Later: the code has long expired, and the seller even asked for a new one.
    await service().from("listing_verifications").update({ challenge_expires_at: iso(-60 * 60_000) }).eq("auction_id", a.id);
    await page.reload();
    const photos = await photoPanel(page);
    await expect(photos.getByText("Both photos are sent. You don't need to take them again.")).toBeVisible();
    await photos.getByRole("button", { name: "Get a new code to retake them" }).click();
    await expect(photos.getByLabel(/^Code: /)).toBeVisible();
    expect((await verification(a.id))!.challenge_code).not.toBe(sent!.challenge_code);

    await addRegistration(page);
    await page.reload();
    await expect(page.getByRole("button", { name: "Submit for checking" })).toBeEnabled();
    await submit(page);
    await expect(result(page)).toHaveAttribute("data-result", "passed");
    expect(await verification(a.id)).toMatchObject({ outcome: "green", run_count: 1 });

    // A run that didn't finish (an error or a timeout): no result, and it can be submitted again.
    await service().from("listing_verifications").update({ outcome: "pending", checked_at: null }).eq("auction_id", a.id);
    await page.reload();
    await expect(result(page)).toHaveCount(0);
    await submit(page);
    await expect(result(page)).toHaveAttribute("data-result", "passed");
    expect(await verification(a.id)).toMatchObject({ outcome: "green", run_count: 2 });
  });
});

test.describe("file formats", () => {
  test.skip(({ isMobile }) => isMobile, "covered on desktop");

  test("an iPhone HEIC photo of the certificate is taken (even without a file type) and stored as a regular image", async ({ page, context }) => {
    const seller = await createUser({ role: "seller" });
    const a = await draft(seller);
    await signIn(context, seller);
    await page.goto(`/account/listings/${a.id}/verify`);
    await page.getByRole("button", { name: "Add: Registration certificate" }).click();
    await expect(page.getByText("as a PDF or clear photos (JPG, PNG, WebP, HEIC or PDF)")).toBeVisible();
    const input = page.getByLabel("Registration certificate", { exact: true });
    await expect(input).toHaveAttribute("accept", /\.heic/);
    // Windows and some Android pickers give HEIC no type: the name and the file's bytes count.
    await input.setInputFiles({ name: "IMG_0001.HEIC", mimeType: "", buffer: readFileSync(join(process.cwd(), "e2e", "fixtures", "registration.heic")) });
    await expect(page.getByText("IMG_0001.HEIC")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "Save documents" }).click();
    await expect.poll(async () => ((await verification(a.id))?.registration_paths as string[] | undefined)?.length ?? 0).toBe(1);
    const [path] = (await verification(a.id))!.registration_paths as string[];
    expect(path).toMatch(/\/registration-[0-9a-f-]{36}\.(webp|jpg)$/);

    // A file that isn't a photo or a PDF is refused with the formats that work.
    await input.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    await expect(page.getByText("notes.txt isn't a PDF or a photo. Add JPG, PNG, WebP, HEIC or PDF files.")).toBeVisible();
  });
});

test.describe("yellow and red", () => {
  test.skip(({ isMobile }) => isMobile, "seller and admin flows on desktop");

  test("red (VIN): needs your attention with the values and a fix; the retry is red too, so the team takes over and it's logged", async ({ page, context, seed }) => {
    const seller = await verifiedSeller();
    const a = await draft(seller, "M3 redvin");
    await signIn(context, seller);
    await context.grantPermissions(["camera"], { origin: APP_URL });
    await page.goto(`/account/listings/${a.id}/verify`);
    await addAllAndSubmit(page);
    await expect(result(page)).toHaveAttribute("data-result", "attention");
    await expect(result(page)).toContainText("Needs your attention");
    await expect(result(page)).toContainText("The plate reads WBA00000000000000");
    await expect(result(page).locator('[data-status-icon="attention"]').first()).toBeVisible();
    await expect(result(page).getByRole("link", { name: "Edit VIN" })).toHaveAttribute("href", `/account/listings/${a.id}/edit#edit-car`);
    await expect(page.locator('[data-check="vin"]')).toHaveAttribute("data-state", "failed");
    await expect(page.locator('[data-check="vin"]')).toContainText("VIN matches: Failed");
    expect(await verification(a.id)).toMatchObject({ outcome: "red", on_hold: true, red_count: 1, needs_admin: false });
    expect((await notificationsFor(seller, "listing_on_hold"))[0]?.data).toMatchObject({ retry: true });
    await page.goto("/account/listings");
    await expect(page.locator("[data-verify-status]").first()).toHaveAttribute("data-verify-status", "attention");
    await page.goto(`/account/listings/${a.id}/verify`);

    // A result that asks for a change opens the inputs again: retake the photos and submit.
    await takeChallenge(page);
    await page.reload();
    await submit(page);
    await expect(result(page)).toHaveAttribute("data-result", "failed");
    await expect(result(page)).toContainText("Couldn't verify");
    await expect(result(page)).toContainText("Our team will review it and contact you.");
    await expect(page.getByRole("button", { name: /^(Replace|Retake|Add|Start):/ })).toHaveCount(0);
    expect(await verification(a.id)).toMatchObject({ outcome: "red", red_count: 2, needs_admin: true });
    await expect.poll(async () => (await notificationsFor(seed.admin, "listing_needs_check")).some((n) => n.auction_id === a.id)).toBe(true);
    const { data: log } = await service().from("admin_actions").select("action").eq("auction_id", a.id);
    expect(log!.map((l) => l.action)).toContain("checks.repeated_red");

    await signIn(context, seed.admin);
    await page.goto("/admin?tab=checks");
    await expect(page.getByRole("main").locator(`a[href="/admin/auctions/${a.id}"]`).first()).toBeVisible();
  });

  test("yellow (mileage): the seller sees both values and Edit mileage; the admin overrides with a logged reason (Approved by the Biddr team); approve still needs the identity", async ({ page, context, seed }) => {
    const seller = await createUser({ role: "seller" });
    const a = await draft(seller, "M3 yellowmileage");
    await signIn(context, seller);
    await context.grantPermissions(["camera"], { origin: APP_URL });
    await page.goto(`/account/listings/${a.id}/verify`);
    await startIdentity(page, seller);
    await addAllAndSubmit(page);
    await expect(result(page)).toHaveAttribute("data-result", "attention");
    await expect(result(page)).toContainText("Dashboard shows 30,000 km; your listing says 25,000 km.");
    await expect(result(page).getByRole("link", { name: "Edit mileage" })).toBeVisible();
    await expect(page.locator('[data-check="mileage"]')).toHaveAttribute("data-state", "attention");
    expect(await verification(a.id)).toMatchObject({ outcome: "yellow", needs_admin: true, on_hold: false });

    await signIn(context, seed.admin);
    await page.goto("/admin?tab=checks");
    await page.getByRole("main").locator(`a[href="/admin/auctions/${a.id}"]`).first().click();
    await expect(page.locator("[data-checks-outcome]")).toHaveText("Yellow: needs a check");
    await expect(page.locator('[data-checks-outcome] [data-status-icon="attention"]')).toBeVisible();
    await expect(page.locator('[data-check="mileage"]')).toContainText("The odometer shows 30,000 km; the listing says 25,000 km");
    await expect(page.getByRole("img", { name: "Seller's photo: VIN plate with the code" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Registration certificate 1 \(PDF\)/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve and schedule", exact: true })).toBeDisabled();
    await expectAccessible(page, "Admin: checks", "#checks");

    await page.getByRole("button", { name: "Override with a reason" }).click();
    const dialog = page.getByRole("dialog").or(page.getByRole("alertdialog")).last();
    await dialog.getByLabel("Reason (kept in the admin log)").fill("Odometer photo shows the trip meter area; total matches the service book.");
    await dialog.getByRole("button", { name: "Override" }).click();
    await expect(page.getByText(/Overridden: the yellow result is accepted/)).toBeVisible();
    const { data: log } = await service().from("admin_actions").select("action, details").eq("auction_id", a.id).eq("action", "checks.override");
    expect(log![0]!.details).toMatchObject({ outcome: "yellow", reason: "Odometer photo shows the trip meter area; total matches the service book." });
    expect(await verification(a.id)).toMatchObject({ needs_admin: false });

    // Still blocked until the seller's identity is verified.
    await page.reload();
    await expect(page.getByText("Done: Fake-listing checks green, or overridden with a reason")).toBeAttached();
    await expect(page.getByRole("button", { name: "Approve and schedule", exact: true })).toBeDisabled();
    await service().from("profiles").update({ identity_status: "verified", identity_verified_name: VERIFIED_NAME }).eq("id", seller.id);
    await page.reload();
    await expect(page.getByRole("button", { name: "Approve and schedule", exact: true })).toBeEnabled();

    // The seller sees the override as the team's approval.
    await signIn(context, seller);
    await page.goto(`/account/listings/${a.id}/verify`);
    await expect(result(page)).toHaveAttribute("data-result", "approved");
    await expect(result(page)).toContainText("Approved by the Biddr team");
  });

  test("low confidence is read again with claude-opus-5-5; both calls are logged with tokens", async ({ page, context }) => {
    const seller = await verifiedSeller();
    const a = await draft(seller, "M3 retryopus");
    await signIn(context, seller);
    await context.grantPermissions(["camera"], { origin: APP_URL });
    await page.goto(`/account/listings/${a.id}/verify`);
    await addAllAndSubmit(page);
    await expect(result(page)).toHaveAttribute("data-result", "passed");
    const calls = await (await fetch(`http://127.0.0.1:54330/__calls?listing=${a.id}`)).json();
    expect(calls).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
    const { data: costs } = await service().from("listing_check_costs").select("model, input_tokens, output_tokens, cost_usd").eq("auction_id", a.id).eq("provider", "anthropic").order("created_at");
    expect(costs!.map((c) => c.model)).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
    expect(Number(costs![1]!.cost_usd)).toBeGreaterThan(Number(costs![0]!.cost_usd));
  });

  test("red (photos found on a car classifieds site: told only in general terms; an owner who isn't the verified seller: add authorisation)", async ({ page, context, request }) => {
    const seller = await createUser({ role: "seller" });
    const photo = `${APP_URL}/stolen-photo.jpg`;
    const stolen = await draft(seller, "M3", { seller, extra: { gallery_urls: { exterior: [photo], interior: [photo], mechanical: [photo] } } });
    const otherOwner = await draft(seller, "M3 rednamex");
    await signIn(context, seller);
    await context.grantPermissions(["camera"], { origin: APP_URL });

    await page.goto(`/account/listings/${stolen.id}/verify`);
    await startIdentity(page, seller);
    await addAllAndSubmit(page);
    await expect(result(page)).toHaveAttribute("data-result", "failed");
    await expect(result(page)).toContainText("Couldn't verify");
    await expect(result(page)).toContainText("Biddr's team is checking your listing photos.");
    await expect(result(page).getByRole("link", { name: "Try again" })).toBeVisible();
    await expect(page.locator('[data-check="images"]')).toContainText("Photos are original: Failed");
    await expect(page.getByText(/suchen\.mobile\.de/)).toHaveCount(0);
    expect(await verification(stolen.id)).toMatchObject({ outcome: "red", on_hold: true });
    expect((await verification(stolen.id))!.outcome_reasons).toEqual([expect.stringMatching(/^Listing photos appear on other car sites: https:\/\/suchen\.mobile\.de/)]);

    // Checking until Stripe confirms the identity; then the owner's name doesn't match.
    await page.goto(`/account/listings/${otherOwner.id}/verify`);
    await addAllAndSubmit(page);
    await expect(result(page)).toHaveAttribute("data-result", "checking");
    await stripeVerifies(request, seller);
    await expect.poll(async () => (await verification(otherOwner.id))?.outcome).toBe("red");
    expect((await verification(otherOwner.id))!.outcome_reasons).toEqual(["The owner on the registration certificate isn't the seller's verified name, and there's no owner authorisation."]);
    await page.reload();
    await expect(result(page)).toHaveAttribute("data-result", "attention");
    await expect(result(page).getByRole("link", { name: "Add authorisation" })).toBeVisible();
    await expect(page.locator('[data-check="owner"]')).toHaveAttribute("data-state", "failed");
  });
});

test.describe("privacy", () => {
  test.skip(({ isMobile }) => isMobile, "server job: runs once");

  test("photos and documents are deleted 30 days after the auction ends; the job needs the cron secret", async ({ page, context, request }) => {
    const seller = await verifiedSeller();
    const a = await draft(seller);
    await signIn(context, seller);
    await context.grantPermissions(["camera"], { origin: APP_URL });
    await page.goto(`/account/listings/${a.id}/verify`);
    await addAllAndSubmit(page);
    await expect(result(page)).toHaveAttribute("data-result", "passed");
    const before = await verification(a.id);
    const paths = [...(before!.registration_paths as string[]), before!.vin_photo_path as string, before!.odometer_photo_path as string];

    expect((await request.get(`${APP_URL}/api/listing-checks/purge`)).status()).toBe(401);
    await service().from("auctions").update({ status: "ended", starts_at: iso(-45 * DAY), ends_at: iso(-40 * DAY) }).eq("id", a.id);
    const res = await request.get(`${APP_URL}/api/listing-checks/purge`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(res.status()).toBe(200);
    const after = await verification(a.id);
    expect(after).toMatchObject({ registration_paths: [], vin_photo_path: null, odometer_photo_path: null });
    expect(after!.files_purged_at).not.toBeNull();
    const { data: left } = await service().storage.from("inspection-uploads").list(`${seller.id}/${a.id}`);
    expect((left ?? []).filter((f) => paths.some((p) => p.endsWith(f.name)))).toEqual([]);
    // The results stay for the admins.
    const { count } = await service().from("listing_checks").select("id", { count: "exact", head: true }).eq("auction_id", a.id);
    expect(count).toBe(6);
  });
});
