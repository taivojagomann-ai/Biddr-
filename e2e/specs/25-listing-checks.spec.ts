// Area 25: automated fake-listing checks (DECISIONS.md point 16). The seller adds the
// registration certificate and takes two photos with the in-app camera and a live code;
// Claude (mocked: e2e/mock-apis.mjs) reads the values, the rules in code decide green,
// yellow or red; Google Vision (mocked) searches the photos; Stripe Identity (simulated:
// lib/stripe-sim.ts) verifies the seller once the content is approved. Approve and
// schedule waits for a verified seller and green checks, or an admin's logged override.
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
const draft = (seller: TestUser, model = "M3", extra: Parameters<typeof createAuction>[0] = { seller }) =>
  createAuction({ ...extra, seller, model, status: "draft", startsAt: iso(2 * DAY), endsAt: iso(5 * DAY), checks: false });

async function verification(auctionId: string) {
  const { data } = await service().from("listing_verifications").select("*").eq("auction_id", auctionId).maybeSingle();
  return data as Record<string, unknown> | null;
}

/** Adds the registration certificate (a PDF) on the verify page. */
async function addRegistration(page: Page) {
  await page.getByLabel("Registration certificate", { exact: true }).setInputFiles({ name: "registration.pdf", mimeType: "application/pdf", buffer: PDF });
  await expect(page.getByText("registration.pdf")).toBeVisible();
  await page.getByRole("button", { name: "Save documents" }).click();
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

/** The live challenge: a code, two camera photos, send. Returns the status text. */
async function takeChallenge(page: Page, { newCode = true } = {}) {
  const photos = page.getByRole("region", { name: "2. Two photos at the car" });
  if (newCode) await photos.getByRole("button", { name: /^Get (a|a new) code( to retake them)?$/ }).click();
  await expect(photos.getByLabel(/^Code: /)).toBeVisible();
  await shoot(page, /^Open the camera for Photo 1/);
  await expect(photos.getByRole("img", { name: /Your photo: Photo 1/ })).toBeVisible();
  await expect(photos.getByRole("button", { name: /^Retake Photo 1/ })).toBeVisible();
  await shoot(page, /^Open the camera for Photo 2/);
  await photos.getByRole("button", { name: "Send both photos" }).click();
}

function writeIdentity(userId: string, result: Record<string, string>) {
  const dir = join(process.cwd(), "e2e", ".state");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "identity-sim.json");
  const all = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
  all[userId] = result;
  writeFileSync(file, JSON.stringify(all));
}

/** The seller starts Stripe Identity from My listings, then Stripe's webhook says verified. */
async function verifyIdentity(page: Page, request: Parameters<typeof sendWebhook>[0], seller: TestUser, name = { first: "E2E Private", last: "Name" }) {
  await page.goto("/account/listings");
  await page.getByRole("button", { name: "Verify your identity" }).click();
  await expect(page).toHaveURL(/\/account\/listings\?identity=return/);
  await expect(page.getByText(/Stripe is checking your identity/)).toBeVisible();
  const { data: p } = await service().from("profiles").select("identity_session_id, identity_status").eq("id", seller.id).single();
  expect(p!.identity_status).toBe("pending");
  writeIdentity(seller.id, { status: "verified", first_name: name.first, last_name: name.last, country: "EE" });
  const { res } = await sendWebhook(request, "identity.verification_session.verified", {
    id: p!.identity_session_id,
    object: "identity.verification_session",
    status: "verified",
    metadata: { user_id: seller.id },
  });
  expect(res.status()).toBe(200);
}

async function asAdmin(context: BrowserContext, admin: TestUser & { totpSecret?: string }) {
  await signIn(context, admin);
}

test.describe("the seller verifies the car", () => {
  test("green: certificate and two camera photos pass; no file upload for the photos; identity after content approval; then it can be scheduled", async ({ page, context, request, seed, isMobile }) => {
    const seller = await createUser({ role: "seller" });
    const a = await draft(seller);
    await signIn(context, seller);
    await context.grantPermissions(["camera"], { origin: APP_URL });

    await page.goto("/account/listings");
    await expect(page.locator("[data-verify-status]").first()).toContainText("Verify your car: add the registration certificate and two photos at the car. The checks start when both are added.");
    await page.getByRole("link", { name: `Verify your car for ${a.title}` }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Verify your car" })).toBeVisible();
    await expectAccessible(page, "Verify your car");

    await addRegistration(page);
    await expect(page.getByText("Documents saved. Now take the two photos at the car (step 2) to run the checks.")).toBeVisible();
    await expect(page.getByText("Your documents are saved. Take the two photos at the car to run the checks.")).toBeVisible();

    // The two photos can only be taken with the camera: no file input, and the reason why.
    const photos = page.getByRole("region", { name: "2. Two photos at the car" });
    await expect(photos.locator('input[type="file"]')).toHaveCount(0);
    await expect(photos).toContainText("Uploading photos from your gallery isn't possible here");
    await takeChallenge(page);
    await expect(page.getByText("Saved. The automated checks passed.")).toBeVisible({ timeout: 60_000 });
    if (isMobile) await expectNoHorizontalScroll(page, "Verify your car on a phone");

    const v = await verification(a.id);
    expect(v).toMatchObject({ outcome: "green", waiting_for_identity: true, on_hold: false, needs_admin: false, run_count: 1 });
    const { data: checks } = await service().from("listing_checks").select("check_name, status").eq("auction_id", a.id);
    expect(checks!.map((c) => c.check_name).sort()).toEqual(["appearance", "code", "images", "mileage", "owner", "vin"]);
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

    if (isMobile) return; // the admin part runs on desktop
    // Admin: approve and schedule waits for the seller's identity.
    await asAdmin(context, seed.admin);
    await page.goto(`/admin/auctions/${a.id}`);
    await expect(page.locator("[data-checks-outcome]")).toHaveText("Green");
    await expect(page.locator('[data-check="owner"]')).toContainText("identity not verified yet");
    await expect(page.getByText("Missing: Seller's identity verified")).toBeAttached();
    await expect(page.getByRole("button", { name: "Approve and schedule", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "Approve content and ask for identity" }).click();
    await expect(page.getByText("Content approved. The seller is asked to verify their identity.")).toBeVisible();
    await expect.poll(async () => (await notificationsFor(seller, "identity_required")).length).toBe(1);

    await signIn(context, seller);
    await page.goto("/account/listings");
    await expect(page.getByRole("heading", { name: "Your listing is approved. Verify your identity to schedule the auction." })).toBeVisible();
    await verifyIdentity(page, request, seller);
    await expect.poll(async () => (await service().from("profiles").select("identity_status, identity_verified_name, identity_document_country").eq("id", seller.id).single()).data).toEqual({
      identity_status: "verified",
      identity_verified_name: "E2E Private Name",
      identity_document_country: "EE",
    });
    // The owner check ran again with the verified name (no API call).
    await expect.poll(async () => (await verification(a.id))?.waiting_for_identity).toBe(false);
    expect((await verification(a.id))?.run_count).toBe(1);

    await asAdmin(context, seed.admin);
    await page.goto(`/admin/auctions/${a.id}`);
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
    const seller = await createUser({ role: "seller" });
    const a = await draft(seller);
    await signIn(context, seller);
    await context.grantPermissions(["camera"], { origin: APP_URL });
    await page.goto(`/account/listings/${a.id}/verify`);
    const photos = page.getByRole("region", { name: "2. Two photos at the car" });
    await photos.getByRole("button", { name: "Get a code" }).click();
    await expect(photos.getByLabel(/^Code: /)).toBeVisible();
    const code = (await verification(a.id))!.challenge_code as string;
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    // The code runs out while the seller is taking the photos.
    await service().from("listing_verifications").update({ challenge_expires_at: iso(-10 * 60_000) }).eq("auction_id", a.id);
    await takeChallenge(page, { newCode: false });
    await expect(page.getByText("The code has expired. Get a new code and take both photos again.")).toBeVisible();
    expect((await verification(a.id))!.vin_photo_path).toBeNull();
    await page.reload();
    await expect(photos.getByLabel(/^Code: /)).toHaveCount(0);
    await expect(photos.getByRole("button", { name: "Get a code" })).toBeVisible();

    // A browser that blocks the camera: the reason, and still no upload.
    await page.addInitScript(() => {
      Object.defineProperty(navigator.mediaDevices, "getUserMedia", {
        value: () => Promise.reject(new DOMException("blocked", "NotAllowedError")),
      });
    });
    await page.reload();
    await photos.getByRole("button", { name: "Get a code" }).click();
    await photos.getByRole("button", { name: /^Open the camera for Photo 1/ }).click();
    await expect(page.getByText("Camera access was blocked. Allow the camera for this site in your browser's settings, then try again.")).toBeVisible();
    await expect(photos.locator('input[type="file"]')).toHaveCount(0);
  });
});

test.describe("photos first, certificate later", () => {
  test.skip(({ isMobile }) => isMobile, "covered on desktop");

  test("the certificate can be added after the code has expired, a new code doesn't spoil the photos sent, and the checks can be run again after an error", async ({ page, context }) => {
    const seller = await createUser({ role: "seller" });
    const a = await draft(seller);
    await signIn(context, seller);
    await context.grantPermissions(["camera"], { origin: APP_URL });
    await page.goto(`/account/listings/${a.id}/verify`);
    await expect(page.getByText("You need both, in any order:")).toBeVisible();

    await takeChallenge(page);
    await expect(page.getByText("Photos saved. Now add the registration certificate (step 1) to run the checks.")).toBeVisible();
    await expect(page.getByText("Your photos are saved. Add the registration certificate here to run the checks.")).toBeVisible();
    // Each step shows its own state: the photos are done, the rest still needed.
    const step = (name: string) => page.getByRole("region", { name }).locator("[data-step-status]");
    await expect(step("2. Two photos at the car")).toHaveText("Done");
    await expect(step("2. Two photos at the car")).toHaveAttribute("data-step-status", "done");
    await expect(step("1. Registration certificate")).toHaveText("Needed");
    await expect(step("3. Your identity")).toHaveText("After approval");
    const sent = await verification(a.id);
    expect(sent).toMatchObject({ outcome: "pending", run_count: 0, photos_code: sent!.challenge_code });

    // Later: the code has long expired, and the seller even asked for a new one.
    await service().from("listing_verifications").update({ challenge_expires_at: iso(-60 * 60_000) }).eq("auction_id", a.id);
    await page.reload();
    const photos = page.getByRole("region", { name: "2. Two photos at the car" });
    await expect(photos.getByText("Both photos are sent. You don't need to take them again.")).toBeVisible();
    await photos.getByRole("button", { name: "Get a new code to retake them" }).click();
    await expect(photos.getByLabel(/^Code: /)).toBeVisible();
    expect((await verification(a.id))!.challenge_code).not.toBe(sent!.challenge_code);

    await addRegistration(page);
    await expect(page.getByText("Saved. The automated checks passed.")).toBeVisible({ timeout: 60_000 });
    expect(await verification(a.id)).toMatchObject({ outcome: "green", run_count: 1 });
    await expect(step("1. Registration certificate")).toHaveText("Done");

    // A run that didn't finish (an error or a timeout): the seller can run it again.
    await service().from("listing_verifications").update({ outcome: "pending", checked_at: null }).eq("auction_id", a.id);
    await page.reload();
    await expect(page.getByText("We couldn't check your car yet. Run the checks again: your files are saved.")).toBeVisible();
    await expectAccessible(page, "Verify your car: run the checks again");
    await page.getByRole("button", { name: "Run the checks" }).click();
    await expect(page.getByText("Saved. The automated checks passed.")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: "Run the checks" })).toHaveCount(0);
    expect(await verification(a.id)).toMatchObject({ outcome: "green", run_count: 2 });
  });
});

test.describe("yellow and red", () => {
  test.skip(({ isMobile }) => isMobile, "seller and admin flows on desktop");

  test("red (VIN): on hold, the seller is told and may try once more; red again goes to the admins and is logged", async ({ page, context, seed }) => {
    const seller = await createUser({ role: "seller" });
    const a = await draft(seller, "M3 redvin");
    await signIn(context, seller);
    await context.grantPermissions(["camera"], { origin: APP_URL });
    await page.goto(`/account/listings/${a.id}/verify`);
    await addRegistration(page);
    await takeChallenge(page);
    await expect(page.getByText("Saved. Something didn't match: see above.")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/The VIN on the plate \(WBA00000000000000\) doesn't match the listing's VIN/)).toBeVisible();
    await expect(page.getByText("You can try once more")).toBeVisible();
    expect(await verification(a.id)).toMatchObject({ outcome: "red", on_hold: true, red_count: 1, needs_admin: false });
    expect((await notificationsFor(seller, "listing_on_hold"))[0]?.data).toMatchObject({ retry: true });

    // The second attempt is red too: the admins take over.
    await takeChallenge(page);
    await expect(page.getByText("On hold: Biddr's team is reviewing your listing.")).toBeVisible({ timeout: 60_000 });
    await expect(page.getByRole("button", { name: /Get (a|a new) code/ })).toHaveCount(0);
    expect(await verification(a.id)).toMatchObject({ outcome: "red", red_count: 2, needs_admin: true });
    await expect.poll(async () => (await notificationsFor(seed.admin, "listing_needs_check")).some((n) => n.auction_id === a.id)).toBe(true);
    const { data: log } = await service().from("admin_actions").select("action").eq("auction_id", a.id);
    expect(log!.map((l) => l.action)).toContain("checks.repeated_red");

    await signIn(context, seed.admin);
    await page.goto("/admin?tab=checks");
    await expect(page.locator(`a[href="/admin/auctions/${a.id}"]`).first()).toBeVisible();
  });

  test("yellow (mileage): needs a check with the values next to the photos; the admin overrides with a logged reason; approve still needs the identity", async ({ page, context, seed }) => {
    const seller = await createUser({ role: "seller" });
    const a = await draft(seller, "M3 yellowmileage");
    await signIn(context, seller);
    await context.grantPermissions(["camera"], { origin: APP_URL });
    await page.goto(`/account/listings/${a.id}/verify`);
    await addRegistration(page);
    await takeChallenge(page);
    await expect(page.getByText("Saved. Biddr's team will take a closer look.")).toBeVisible({ timeout: 60_000 });
    expect(await verification(a.id)).toMatchObject({ outcome: "yellow", needs_admin: true, on_hold: false });

    await signIn(context, seed.admin);
    await page.goto("/admin?tab=checks");
    await page.locator(`a[href="/admin/auctions/${a.id}"]`).first().click();
    await expect(page.locator("[data-checks-outcome]")).toHaveText("Yellow: needs a check");
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
    await service().from("profiles").update({ identity_status: "verified", identity_verified_name: "E2E Private Name" }).eq("id", seller.id);
    await page.reload();
    await expect(page.getByRole("button", { name: "Approve and schedule", exact: true })).toBeEnabled();
  });

  test("low confidence is read again with claude-opus-5-5; both calls are logged with tokens", async ({ page, context }) => {
    const seller = await createUser({ role: "seller" });
    const a = await draft(seller, "M3 retryopus");
    await signIn(context, seller);
    await context.grantPermissions(["camera"], { origin: APP_URL });
    await page.goto(`/account/listings/${a.id}/verify`);
    await addRegistration(page);
    await takeChallenge(page);
    await expect(page.getByText("Saved. The automated checks passed.")).toBeVisible({ timeout: 60_000 });
    const calls = await (await fetch(`http://127.0.0.1:54330/__calls?listing=${a.id}`)).json();
    expect(calls).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
    const { data: costs } = await service().from("listing_check_costs").select("model, input_tokens, output_tokens, cost_usd").eq("auction_id", a.id).eq("provider", "anthropic").order("created_at");
    expect(costs!.map((c) => c.model)).toEqual(["claude-sonnet-5-5", "claude-opus-5-5"]);
    expect(Number(costs![1]!.cost_usd)).toBeGreaterThan(Number(costs![0]!.cost_usd));
  });

  test("red (photos found on a car classifieds site, and an owner who isn't the verified seller)", async ({ page, context, request }) => {
    const seller = await createUser({ role: "seller" });
    const photo = `${APP_URL}/stolen-photo.jpg`;
    const stolen = await draft(seller, "M3", { seller, extra: { gallery_urls: { exterior: [photo], interior: [photo], mechanical: [photo] } } });
    const otherOwner = await draft(seller, "M3 rednamex");
    await signIn(context, seller);
    await context.grantPermissions(["camera"], { origin: APP_URL });

    await page.goto(`/account/listings/${stolen.id}/verify`);
    await addRegistration(page);
    await takeChallenge(page);
    await expect(page.getByText(/Listing photos appear on other car sites: https:\/\/suchen\.mobile\.de/)).toBeVisible({ timeout: 60_000 });
    expect(await verification(stolen.id)).toMatchObject({ outcome: "red", on_hold: true });

    // Green until the identity is verified; then the owner's name doesn't match: red.
    await page.goto(`/account/listings/${otherOwner.id}/verify`);
    await addRegistration(page);
    await takeChallenge(page);
    await expect(page.getByText("Saved. The automated checks passed.")).toBeVisible({ timeout: 60_000 });
    await service().from("listing_verifications").update({ content_approved_at: new Date().toISOString() }).in("auction_id", [stolen.id, otherOwner.id]);
    await verifyIdentity(page, request, seller);
    await expect.poll(async () => (await verification(otherOwner.id))?.outcome).toBe("red");
    expect((await verification(otherOwner.id))!.outcome_reasons).toEqual(["The owner on the registration certificate isn't the seller's verified name, and there's no owner authorisation."]);
  });
});

test.describe("privacy", () => {
  test.skip(({ isMobile }) => isMobile, "server job: runs once");

  test("photos and documents are deleted 30 days after the auction ends; the job needs the cron secret", async ({ page, context, request }) => {
    const seller = await createUser({ role: "seller" });
    const a = await draft(seller);
    await signIn(context, seller);
    await context.grantPermissions(["camera"], { origin: APP_URL });
    await page.goto(`/account/listings/${a.id}/verify`);
    await addRegistration(page);
    await takeChallenge(page);
    await expect(page.getByText("Saved. The automated checks passed.")).toBeVisible({ timeout: 60_000 });
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
