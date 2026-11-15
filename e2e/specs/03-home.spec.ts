// Area 3: home page tabs, search, filters, badges, layout and live updates.
import { test, expect, expectAccessible, expectNoHorizontalScroll } from "../support/fixtures";
import { bid, createAuction, createUser, iso, DAY, HOUR, readyBidder } from "../support/factory";

const tag = () => `Q${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const card = (page: import("@playwright/test").Page, id: string) => page.locator(`article.auction-card:has(a[href="/auctions/${id}"])`);

test.describe("home page", () => {
  test("each tab shows the right auctions in the right order", async ({ page }) => {
    const seller = await createUser({ role: "seller" });
    const model = tag();
    const live1 = await createAuction({ seller, model, startsAt: iso(-3 * DAY), endsAt: iso(30 * HOUR) });
    const live2 = await createAuction({ seller, model, startsAt: iso(-1 * HOUR), endsAt: iso(10 * HOUR) });
    const upcomingLate = await createAuction({ seller, model, status: "upcoming", startsAt: iso(3 * DAY), endsAt: iso(6 * DAY) });
    const upcomingSoon = await createAuction({ seller, model, status: "upcoming", startsAt: iso(1 * DAY), endsAt: iso(4 * DAY) });
    const sold = await createAuction({ seller, model, status: "sold", startsAt: iso(-5 * DAY), endsAt: iso(-1 * DAY) });
    const draft = await createAuction({ seller, model, status: "draft" });

    const order = async (status: string) => {
      await page.goto(`/?${status ? `status=${status}&` : ""}q=${model}`);
      await expect(page.getByRole("heading", { name: new RegExp(`Results for “${model}”`) })).toBeVisible();
      return page.locator("article.auction-card a[href^='/auctions/']").evaluateAll((as) => as.map((a) => a.getAttribute("href")));
    };
    const href = (a: { id: string }) => `/auctions/${a.id}`;
    // Live: ending soonest first.
    expect(await order("")).toEqual([href(live2), href(live1)]);
    // Newly listed: most recently started first.
    expect(await order("newest")).toEqual([href(live2), href(live1)]);
    // Ending in 24h: only the one ending within a day.
    expect(await order("ending")).toEqual([href(live2)]);
    // Coming up: starting soonest first.
    expect(await order("upcoming")).toEqual([href(upcomingSoon), href(upcomingLate)]);
    expect(await order("past")).toEqual([href(sold)]);
    // Drafts never appear.
    await page.goto(`/?q=${model}`);
    await expect(page.locator(`a[href="${href(draft)}"]`)).toHaveCount(0);
  });

  test("the Ending next box shows only on Live without search or filters", async ({ page }) => {
    const seller = await createUser({ role: "seller" });
    await createAuction({ seller, endsAt: iso(2 * HOUR) });
    await page.goto("/");
    await expect(page.getByText("Ending next", { exact: false }).first()).toBeVisible();
    for (const path of ["/?status=newest", "/?status=upcoming", "/?q=bmw", "/?country=EE", "/?condition=clean"]) {
      await page.goto(path);
      await expect(page.locator("article", { hasText: "Ending next" }), path).toHaveCount(0);
    }
    await page.goto("/");
    const tabs = page.getByRole("navigation", { name: "Auction status" }).getByRole("link");
    await expect(tabs).toHaveText(["Live", "Newly listed", "Ending in 24h", "Coming up", "Past results"]);
    await expectAccessible(page, "Home");
  });

  test("search: model codes, spaces, aliases, accents and years", async ({ page }) => {
    const seller = await createUser({ role: "seller" });
    const rs6 = await createAuction({ seller, make: "Audi", model: "RS6", variant: "Avant", year: 2021 });
    const golf = await createAuction({ seller, make: "Volkswagen", model: "Golf", variant: "R", year: 2019 });
    const skoda = await createAuction({ seller, make: "Škoda", model: "Octavia", variant: "RS", year: 2017 });
    const cases: [string, { id: string }, boolean][] = [
      ["rs6", rs6, true],
      ["audi rs6", rs6, true],
      ["rs 6", rs6, true],
      ["RS-6 2021", rs6, true],
      ["rs6 2019", rs6, false],
      ["vw golf", golf, true],
      ["skoda", skoda, true],
      ["škoda octavia", skoda, true],
      ["audi golf", golf, false],
    ];
    for (const [q, auction, found] of cases) {
      await page.goto(`/?q=${encodeURIComponent(q)}`);
      await expect(page.locator(`a[href="/auctions/${auction.id}"]`).first(), `"${q}"`).toHaveCount(found ? 1 : 0);
    }
  });

  test("search suggestions work with the keyboard; no results offers past results", async ({ page }) => {
    const seller = await createUser({ role: "seller" });
    const model = tag();
    await createAuction({ seller, make: "Porsche", model, status: "sold", startsAt: iso(-5 * DAY), endsAt: iso(-1 * DAY) });
    await page.goto("/");
    const box = page.getByRole("combobox", { name: "Search make, model or year" });
    await box.click();
    await box.pressSequentially(model.toLowerCase());
    const option = page.getByRole("listbox", { name: "Suggestions" }).getByRole("option").first();
    await expect(option).toContainText(model);
    await box.press("ArrowDown");
    await expect(option).toHaveAttribute("aria-selected", "true");
    await box.press("Enter");
    await expect(page).toHaveURL(/q=/);
    await expect(page.getByText(new RegExp(`No live results for “.*${model}”\\.`, "i"))).toBeVisible();
    await page.getByRole("link", { name: /See 1 past result for/ }).click();
    await expect(page).toHaveURL(/status=past/);
    await expect(page.getByRole("heading", { name: /Results for .*\(1\)/ })).toBeVisible();
  });

  test("the country filter lists only countries with listings; history filters work", async ({ page }) => {
    const seller = await createUser({ role: "seller" });
    const model = tag();
    const malta = await createAuction({ seller, model, country: "MT", city: "Valletta" });
    const repaired = await createAuction({ seller, model, condition: "restored_accident" });
    const inspected = await createAuction({
      seller,
      model,
      condition: "restored_accident",
      inspection: { dealer: "Demo Dealer, Riga", date: "2026-11-01", highlights: ["Brakes good", "Tyres good", "No leaks"] },
    });
    await page.goto("/");
    const countries = await page.getByLabel("Country").locator("option").allTextContents();
    expect(countries).toContain("Malta");
    expect(countries).not.toContain("Cyprus"); // no test ever lists a car in Cyprus
    await page.goto(`/?country=MT&q=${model}`);
    await expect(page.locator(`a[href="/auctions/${malta.id}"]`).first()).toBeVisible();
    await expect(page.locator(`a[href="/auctions/${repaired.id}"]`)).toHaveCount(0);

    await page.goto(`/?condition=restored_any&q=${model}`);
    await expect(page.locator(`a[href="/auctions/${repaired.id}"]`).first()).toBeVisible();
    await expect(page.locator(`a[href="/auctions/${inspected.id}"]`).first()).toBeVisible();
    await page.goto(`/?condition=restored&q=${model}`);
    await expect(page.locator(`a[href="/auctions/${repaired.id}"]`)).toHaveCount(0);
    await expect(page.locator(`a[href="/auctions/${inspected.id}"]`).first()).toBeVisible();
    await page.goto(`/?condition=clean&q=${model}`);
    await expect(page.locator(`a[href="/auctions/${malta.id}"]`).first()).toBeVisible();
    await expect(page.locator(`a[href="/auctions/${inspected.id}"]`)).toHaveCount(0);
  });

  test("the New badge marks auctions that went live in the last 24 hours", async ({ page }) => {
    const seller = await createUser({ role: "seller" });
    const model = tag();
    const fresh = await createAuction({ seller, model, startsAt: iso(-2 * HOUR) });
    const older = await createAuction({ seller, model, startsAt: iso(-3 * DAY) });
    await page.goto(`/?q=${model}`);
    await expect(card(page, fresh.id).getByText("New", { exact: true })).toBeVisible();
    await expect(card(page, older.id).getByText("New", { exact: true })).toHaveCount(0);
  });

  for (const width of [390, 320]) {
    test(`two cards per row at ${width}px without sideways scrolling`, async ({ page }) => {
      const seller = await createUser({ role: "seller" });
      const model = tag();
      const a = await createAuction({ seller, model, endsAt: iso(2 * DAY) });
      const b = await createAuction({ seller, model, endsAt: iso(3 * DAY) });
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/?q=${model}`);
      const boxA = await card(page, a.id).boundingBox();
      const boxB = await card(page, b.id).boundingBox();
      expect(boxA && boxB && Math.abs(boxA.y - boxB.y) < 2 && boxA.x !== boxB.x, "same row").toBeTruthy();
      await expectNoHorizontalScroll(page, `home at ${width}px`);
    });
  }

  test("a bid placed elsewhere updates the card's price and bid count without reloading", async ({ page }) => {
    const seller = await createUser({ role: "seller" });
    const model = tag();
    const auction = await createAuction({ seller, model, startingBid: 20_000 });
    const bidder = await readyBidder(auction.id);
    await page.goto(`/?q=${model}`);
    const c = card(page, auction.id);
    await expect(c).toContainText("€20,000");
    await page.waitForTimeout(1500); // let the Realtime channel subscribe
    const { error } = await bid(bidder, auction.id, 21_000);
    expect(error).toBeNull();
    await expect(c).toContainText("€21,000", { timeout: 15_000 });
    await expect(c).toContainText("1 bid");
  });
});
