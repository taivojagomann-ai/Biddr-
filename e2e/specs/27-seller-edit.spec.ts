// Area 27: the seller corrects their listing while it's in review (DECISIONS.md point 17).
// A VIN typo puts the listing on hold; the seller fixes it on "Edit listing" and the checks
// run again on the values already read (no new API calls). Admins see every change, and a
// change after the content approval sends the listing back for review. Photos aren't edited.
import { test, expect, signIn, expectAccessible, expectNoHorizontalScroll } from "../support/fixtures";
import { createAuction, createUser, getAuction, iso, notificationsFor, randomVin, service, DAY, type TestUser } from "../support/factory";

const VERIFIED_NAME = "E2E Private Name";

/** A listing in review whose photos and certificate were already read: plate and certificate say `realVin`. */
async function checkedDraft(seller: TestUser, realVin: string, listingVin: string, o: { approved?: boolean } = {}) {
  // As a listing from the sell form: ownership, registration and the declarations filled in.
  const a = await createAuction({
    seller,
    status: "draft",
    startsAt: iso(2 * DAY),
    endsAt: iso(5 * DAY),
    checks: false,
    vin: listingVin,
    extra: {
      body_style: "coupe",
      interior_color: "Black leather",
      owner_count: 2,
      registration_country: "EE",
      is_registered: true,
      no_modifications: true,
      no_known_flaws: true,
    },
  });
  const row = await getAuction<{ mileage_km: number; exterior_color: string }>(a.id);
  await service()
    .from("profiles")
    .update({ identity_status: "verified", identity_verified_name: VERIFIED_NAME, identity_verified_at: new Date().toISOString() })
    .eq("id", seller.id);
  const mismatch = realVin !== listingVin;
  const { error } = await service()
    .from("listing_verifications")
    .upsert({
      auction_id: a.id,
      seller_id: seller.id,
      challenge_code: "ABC234",
      photos_code: "ABC234",
      extracted: {
        challenge_code: { value: "ABC234", confidence: "high" },
        plate_vin: { value: realVin, confidence: "high" },
        odometer: { value: row.mileage_km, unit: "km", confidence: "high" },
        vehicle_colour: { value: row.exterior_color, confidence: "high" },
        body_type: { value: null, confidence: "high" },
        certificate_vins: { values: [realVin], confidence: "high" },
        certificate_owners: { values: [VERIFIED_NAME], confidence: "high" },
        authorisation: null,
        images: null,
      },
      outcome: mismatch ? "red" : "green",
      outcome_reasons: mismatch ? ["The VIN on the plate doesn't match the listing's VIN."] : [],
      on_hold: mismatch,
      red_count: mismatch ? 1 : 0,
      run_count: 1,
      checked_at: new Date().toISOString(),
      content_approved_at: o.approved ? new Date().toISOString() : null,
    });
  if (error) throw error;
  return a;
}

async function verification(auctionId: string) {
  const { data } = await service().from("listing_verifications").select("*").eq("auction_id", auctionId).single();
  return data as Record<string, unknown>;
}

test.describe("Edit listing", () => {
  test("a VIN typo: the seller fixes it next to Preview, the checks pass again and the hold is lifted; the admin sees the change", async ({ page, context, seed, isMobile }) => {
    const seller = await createUser({ role: "seller" });
    const realVin = randomVin("WP0");
    const typo = realVin.slice(0, 16) + (realVin.endsWith("A") ? "B" : "A");
    const a = await checkedDraft(seller, realVin, typo);
    await signIn(context, seller);

    await page.goto("/account/listings");
    await expect(page.locator("[data-verify-status]").first()).toHaveAttribute("data-verify-status", "failed");
    await expect(page.locator("[data-verify-status]").first()).toContainText("Couldn't verify");
    await page.getByRole("link", { name: `Edit ${a.title}` }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Edit listing" })).toBeVisible();
    await expect(page.getByText("Photos can't be changed here")).toBeVisible();
    await expectAccessible(page, "Edit listing");
    if (isMobile) await expectNoHorizontalScroll(page, "Edit listing on a phone");

    const car = page.getByRole("region", { name: "Car and listing" });
    await expect(car.getByLabel("VIN")).toHaveValue(typo);
    // A VIN with a forbidden letter is refused with the reason.
    await car.getByLabel("VIN").fill(realVin.slice(0, 16) + "O");
    await car.getByRole("button", { name: "Save changes" }).click();
    await expect(car.getByText("A VIN uses only letters and numbers, never I, O or Q. Check for typos.").first()).toBeVisible();

    await car.getByLabel("VIN").fill(realVin.toLowerCase());
    await car.getByRole("button", { name: "Save changes" }).click();
    await expect(car.getByText("Changes saved. The automated checks passed with the new details.")).toBeVisible();
    expect((await getAuction<{ vin: string }>(a.id)).vin).toBe(realVin);
    expect(await verification(a.id)).toMatchObject({ outcome: "green", on_hold: false, red_count: 1, run_count: 1 });

    // Saving again without changes changes nothing.
    await car.getByRole("button", { name: "Save changes" }).click();
    await expect(car.getByText("Nothing changed.")).toBeVisible();
    const { data: edits } = await service().from("listing_edits").select("changes, rechecked, approval_undone").eq("auction_id", a.id);
    expect(edits).toEqual([{ changes: { vin: { from: typo, to: realVin } }, rechecked: true, approval_undone: false }]);

    await page.goto("/account/listings");
    await expect(page.locator("[data-verify-status]").first()).toHaveAttribute("data-verify-status", "passed");
    await expect(page.locator("[data-verify-status]").first()).toContainText("All checks passed");

    if (isMobile) return; // the admin part runs on desktop
    await signIn(context, seed.admin);
    await page.goto(`/admin/auctions/${a.id}`);
    const changes = page.getByRole("region", { name: "Seller's changes" });
    await expect(changes.locator("[data-seller-edit]")).toHaveCount(1);
    await expect(changes).toContainText("the checks ran again");
    const vinChange = changes.locator("div", { has: page.getByText("VIN", { exact: true }) }).last();
    await expect(vinChange).toContainText(typo);
    await expect(vinChange).toContainText(`changed to ${realVin}`);
  });

  test("a change after the content approval sends it back for review and tells the admins; details and price save too", async ({ page, context, seed, isMobile }) => {
    test.skip(isMobile, "covered on desktop");
    const seller = await createUser({ role: "seller" });
    const vin = randomVin("WP0");
    const a = await checkedDraft(seller, vin, vin, { approved: true });
    await signIn(context, seller);
    await page.goto(`/account/listings/${a.id}/edit`);

    const details = page.getByRole("region", { name: "Details" });
    await details.getByLabel("Seller notes").fill("Winter tyres on rims included.");
    await details.getByRole("button", { name: "Save changes" }).click();
    await expect(details.getByText("Changes saved. Biddr's team will review the listing again.")).toBeVisible();
    expect((await verification(a.id)).content_approved_at).toBeNull();
    await expect.poll(async () => (await notificationsFor(seed.admin, "listing_edited")).filter((n) => n.auction_id === a.id).length).toBe(1);

    const price = page.getByRole("region", { name: "Price" });
    await price.getByLabel("Starting bid (€)").fill("900");
    await price.getByRole("button", { name: "Save changes" }).click();
    await expect(price.getByText("The starting bid must be at least €1,000.").first()).toBeVisible();
    await price.getByLabel("Starting bid (€)").fill("12000");
    await price.getByLabel(/Reserve price/).fill("15000");
    await price.getByRole("button", { name: "Save changes" }).click();
    await expect(price.getByText("Changes saved.", { exact: true })).toBeVisible();
    expect((await getAuction<{ starting_bid: number; has_reserve: boolean }>(a.id))).toMatchObject({ starting_bid: 12000, has_reserve: true });
    const { data: priv } = await service().from("auction_private").select("requested_reserve").eq("auction_id", a.id).single();
    expect(priv!.requested_reserve).toBe(15000);

    // Year, make and model changes give the listing its new title.
    const car = page.getByRole("region", { name: "Car and listing" });
    const year = Number(await car.getByLabel("Year").inputValue());
    await car.getByLabel("Year").fill(String(year - 1));
    await car.getByRole("button", { name: "Save changes" }).click();
    await expect(car.getByText(/^Changes saved\./)).toBeVisible();
    expect((await getAuction<{ title: string }>(a.id)).title.startsWith(String(year - 1))).toBe(true);
  });

  test("a scheduled listing can't be edited: no Edit link, and the page says why", async ({ page, context }) => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({ seller, status: "upcoming" });
    await signIn(context, seller);
    await page.goto("/account/listings");
    await expect(page.getByRole("link", { name: `Edit ${a.title}` })).toHaveCount(0);
    await page.goto(`/account/listings/${a.id}/edit`);
    await expect(page.getByText("This listing can't be changed any more")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  });
});
