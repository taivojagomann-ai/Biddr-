// Area 4: the auction page: gallery, specifications, inspection variants, seller
// card, info tips, sharing, metadata, watching, and previews of unpublished listings.
import { test, expect, signIn, expectAccessible } from "../support/fixtures";
import { createAuction, createUser, iso, DAY } from "../support/factory";

const inspection = { dealer: "Demo BMW Centre, Munich", date: "2026-11-02", highlights: ["Brake discs at 80%", "No fault codes", "Tyres 6 mm"] };

test.describe("auction page", () => {
  test("an accident-repaired car with an accepted dealer inspection", async ({ page }) => {
    const seller = await createUser({ role: "seller", country: "DE" });
    const a = await createAuction({ seller, make: "BMW", condition: "restored_accident", inspection, beforePhotos: 2 });
    await page.goto(`/auctions/${a.id}`);
    await expect(page.getByRole("heading", { level: 1, name: a.title })).toBeVisible();
    await expect(page.getByRole("tab", { name: /^Before repair/ })).toBeVisible();
    const card = page.getByRole("region", { name: "Dealer inspected" });
    await expect(card).toContainText("Inspected by Demo BMW Centre, Munich (authorised BMW dealer)");
    await expect(card).toContainText("Report checked by Biddr.");
    await expect(card).toContainText("Brake discs at 80%");
    const specs = page.getByRole("region", { name: "Specifications" });
    await expect(specs.getByText("Dealer inspected", { exact: true })).toBeVisible();
    await expect(page.getByText("Accident repaired", { exact: true }).first()).toBeVisible();
    await expectAccessible(page, "Auction, inspected");
  });

  test("inspected by the selling dealer says so on the card", async ({ page }) => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({
      seller,
      sellerType: "dealer",
      dealerName: "Demo Motors GmbH",
      dealerRegistryCode: "HRB 12345",
      inspection: { ...inspection, dealer: "Demo Motors GmbH, Munich", bySeller: true },
    });
    await page.goto(`/auctions/${a.id}`);
    await expect(page.getByRole("region", { name: "Dealer inspected" })).toContainText("Inspected by the selling dealer, Demo Motors GmbH, Munich");
    const sellerCard = page.getByRole("region", { name: "Seller", exact: true });
    await expect(sellerCard).toContainText("Dealer: Demo Motors GmbH");
    await expect(sellerCard).toContainText("Registry code HRB 12345");
  });

  test("an accident-repaired car without an inspection: no badge, a notice and no Before repair tab for clean cars", async ({ page }) => {
    const seller = await createUser({ role: "seller" });
    const repaired = await createAuction({ seller, condition: "restored_accident", damageSummary: "Rear quarter repaired in 2023." });
    await page.goto(`/auctions/${repaired.id}`);
    const notice = page.getByRole("region", { name: "Not inspected by a dealer" });
    await expect(notice).toContainText("This accident-repaired car hasn't been inspected by an authorised dealer.");
    await expect(notice).toContainText("Rear quarter repaired in 2023.");
    await expect(page.getByRole("region", { name: "Specifications" }).getByText("Not inspected", { exact: true })).toBeVisible();

    const clean = await createAuction({ seller });
    await page.goto(`/auctions/${clean.id}`);
    await expect(page.getByRole("tab", { name: /^Before repair/ })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Not inspected by a dealer" })).toHaveCount(0);
  });

  test("the seller card shows public facts and stats, never private details", async ({ page }) => {
    const seller = await createUser({ role: "seller", country: "FI", fullName: "Very Private Name", phone: "+358401111111" });
    const a = await createAuction({ seller });
    await createAuction({ seller, status: "sold", startsAt: iso(-5 * DAY), endsAt: iso(-1 * DAY) });
    await page.goto(`/auctions/${a.id}`);
    const sellerCard = page.getByRole("region", { name: "Seller", exact: true });
    await expect(sellerCard).toContainText(seller.username!);
    await expect(sellerCard).toContainText("Finland");
    await expect(sellerCard).toContainText("Private seller");
    await expect(sellerCard).toContainText("Member since");
    await expect(sellerCard).toContainText("2 cars listed, 1 sold");
    await expect(page.getByText("Very Private Name")).toHaveCount(0);
    await expect(page.getByText("+358401111111")).toHaveCount(0);
  });

  test("info tips open and close by keyboard; share offers Copy link", async ({ page, isMobile }) => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({ seller, inspection, condition: "restored_accident" });
    await page.goto(`/auctions/${a.id}`);
    const tip = page.getByRole("button", { name: "What does Accident repaired mean?" }).first();
    await tip.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "What does Accident repaired mean?" });
    await expect(dialog).toContainText("Biddr doesn't check the repair itself");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(tip).toBeFocused();

    test.skip(isMobile, "Phones use the native share sheet");
    await page.getByRole("button", { name: /^Share/ }).first().click();
    await expect(page.getByRole("button", { name: "Copy link" })).toBeVisible();
  });

  test("Open Graph and Twitter tags are present and absolute", async ({ page, request }) => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({ seller });
    await page.goto(`/auctions/${a.id}`);
    await expect(page.locator('meta[property="og:title"]')).toHaveAttribute("content", a.title);
    await expect(page.locator('meta[property="og:url"]')).toHaveAttribute("content", new RegExp(`^http.*/auctions/${a.id}$`));
    const image = await page.locator('meta[property="og:image"]').first().getAttribute("content");
    expect(image).toMatch(/^http/);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    const res = await request.get(image!);
    expect(res.headers()["content-type"]).toContain("image/png");
  });

  test("watching toggles and the count updates", async ({ page, context }) => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({ seller });
    const user = await createUser();
    await signIn(context, user);
    await page.goto(`/auctions/${a.id}`);
    const watch = page.getByRole("button", { name: /^Watch/, pressed: false }).first();
    await watch.click();
    await expect(page.getByRole("button", { name: /^Watching/ }).first()).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("1 watching").first()).toBeVisible();
    await page.reload();
    await expect(page.getByRole("button", { name: /^Watching/ }).first()).toBeVisible();
    await page.getByRole("button", { name: /^Watching/ }).first().click();
    await expect(page.getByRole("button", { name: /^Watch/, pressed: false }).first()).toBeVisible();
  });

  test("drafts and rejected listings: the seller sees a preview with bidding and questions off; others get 404", async ({ page, context }) => {
    const seller = await createUser({ role: "seller" });
    const draft = await createAuction({ seller, status: "draft" });
    const rejected = await createAuction({ seller, status: "rejected" });
    await page.goto(`/auctions/${draft.id}`);
    await expect(page.getByRole("heading", { name: "This auction isn't listed" })).toBeVisible();
    await signIn(context, await createUser());
    expect((await page.goto(`/auctions/${rejected.id}`))?.status()).toBe(404);

    await signIn(context, seller);
    await page.goto(`/auctions/${draft.id}`);
    const banner = page.getByRole("region", { name: "Preview: only you can see this." });
    await expect(banner).toContainText("Waiting for review.");
    await expect(page.getByText("Bidding opens after review.").locator("visible=true").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Place bid" }).locator("visible=true").first()).toBeDisabled();
    await expect(page.getByText("Questions open when the auction starts.")).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
    await page.goto(`/auctions/${rejected.id}`);
    await expect(page.getByRole("region", { name: "Preview: only you can see this." })).toContainText("Not accepted:");
  });

  test("the location links to a Google Maps search for the city and country only", async ({ page }) => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({ seller, city: "Tartu", country: "EE" });
    await page.goto(`/auctions/${a.id}`);
    const specs = page.getByRole("region", { name: "Specifications" });
    await expect(specs).toContainText("Tartu, Estonia");
    const link = specs.getByRole("link", { name: "View on map (opens Google Maps in a new tab)" });
    await expect(link).toHaveAttribute("href", "https://www.google.com/maps/search/?api=1&query=Tartu%2C%20Estonia");
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noopener/);
    // No embedded map and no raw URL on the page.
    await expect(page.locator('iframe[src*="google.com/maps"], iframe[src*="maps.google"]')).toHaveCount(0);
    await expect(page.getByText(/google\.com\/maps/)).toHaveCount(0);
  });
});
