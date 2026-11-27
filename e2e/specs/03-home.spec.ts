// Area 3: home page tabs, search, filters, badges, layout and live updates.
import { test, expect, expectAccessible, expectNoHorizontalScroll, realtimeReady, signIn } from "../support/fixtures";
import { bid, createAuction, createUser, getAuction, iso, service, DAY, HOUR, readyBidder } from "../support/factory";

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

  test("the featured carousel shows only on Live without search or filters", async ({ page }) => {
    const seller = await createUser({ role: "seller" });
    await createAuction({ seller, endsAt: iso(2 * HOUR) });
    await page.goto("/");
    await expect(page.getByRole("region", { name: "Featured cars" })).toBeVisible();
    for (const path of ["/?status=newest", "/?status=upcoming", "/?q=bmw", "/?country=EE", "/?condition=clean"]) {
      await page.goto(path);
      await expect(page.locator("[data-featured-carousel]"), path).toHaveCount(0);
    }
    await page.goto("/");
    const tabs = page.getByRole("navigation", { name: "Auction status" }).getByRole("link");
    await expect(tabs).toHaveText(["Live", "Newly listed", "Ending in 24h", "Coming up", "Past results"]);
    await expectAccessible(page, "Home");
  });

  test("carousel content and order: premium seats (labelled Featured, set by an admin) and cars ending within 24h, most bids first, ties ending soonest; a closing car leaves at once", async ({ page, context, seed, isMobile }) => {
    test.skip(isMobile, "admin desktop; the carousel's phone behaviour is tested below");
    const seller = await createUser({ role: "seller" });
    // Far more bids than anything else on the shared test database, so these come first.
    const base = 1_000_000 + Math.floor(Math.random() * 1_000_000_000);
    const tieLater = await createAuction({ seller, endsAt: iso(5 * HOUR), extra: { bid_count: base + 2, current_bid: 20_000 } });
    const tieSooner = await createAuction({ seller, endsAt: iso(3 * HOUR), extra: { bid_count: base + 2, current_bid: 20_000 } });
    const most = await createAuction({ seller, endsAt: iso(20 * HOUR), extra: { bid_count: base + 3, current_bid: 20_000 } });
    const laterPremium = await createAuction({ seller, endsAt: iso(3 * DAY), extra: { bid_count: base + 1, current_bid: 20_000 } });
    const later = await createAuction({ seller, endsAt: iso(3 * DAY), extra: { bid_count: base + 4, current_bid: 20_000 } });
    const upcoming = await createAuction({ seller, status: "upcoming", startsAt: iso(HOUR), endsAt: iso(5 * HOUR) });

    // An admin gives one of the later cars a premium seat (reason required, logged).
    await signIn(context, seed.admin);
    await page.goto(`/admin/auctions/${laterPremium.id}`);
    const seat = page.getByRole("region", { name: "Premium seat" });
    await seat.getByRole("button", { name: "Give a premium seat" }).click();
    await expect(seat.getByText("Enter the reason.").first()).toBeVisible();
    await seat.getByLabel("Reason (kept in the admin log)").fill("Launch promotion");
    await seat.getByRole("button", { name: "Give a premium seat" }).click();
    await expect(seat.getByText(/Premium seat on/)).toBeVisible();
    const { data: log } = await service().from("admin_actions").select("action, details").eq("auction_id", laterPremium.id);
    expect(log).toEqual(expect.arrayContaining([expect.objectContaining({ action: "premium_seat.set", details: expect.objectContaining({ reason: "Launch promotion" }) })]));
    expect(await getAuction<{ premium_seat_source: string; premium_seat_until: string }>(laterPremium.id)).toMatchObject({ premium_seat_source: "admin" });

    await page.goto("/");
    const carousel = page.getByRole("region", { name: "Featured cars" });
    const mine = new Set([tieLater.id, tieSooner.id, most.id, laterPremium.id, later.id, upcoming.id]);
    const order = async () => (await carousel.locator("[data-slide]").evaluateAll((els) => els.map((e) => e.getAttribute("data-slide")))).filter((id) => mine.has(id!));
    // Most bids first; ties ending soonest; the premium seat in its place by bids; not the later car without a seat, not upcoming.
    expect(await order()).toEqual([most.id, tieSooner.id, tieLater.id, laterPremium.id]);
    const slide = (id: string) => carousel.locator(`[data-slide="${id}"]`);
    await expect(slide(laterPremium.id).locator("[data-featured-label]")).toHaveText("Featured");
    await expect(slide(most.id).locator("[data-featured-label]")).toHaveCount(0);
    await expect(slide(most.id).getByRole("link", { name: new RegExp(`^Place bid on `) })).toHaveAttribute("href", `/auctions/${most.id}#bid`);

    // A car that closes leaves the carousel straight away (no result shown there).
    await page.mouse.move(0, 0);
    await service().from("auctions").update({ status: "sold" }).eq("id", tieSooner.id);
    await expect(slide(tieSooner.id)).toHaveCount(0, { timeout: 15_000 });
    // A realtime bid updates the slide.
    await service().from("auctions").update({ current_bid: 23_500 }).eq("id", most.id);
    await expect(slide(most.id)).toContainText("€23,500", { timeout: 15_000 });

    // Removing the seat (logged) takes the later car out again.
    await page.goto(`/admin/auctions/${laterPremium.id}`);
    await seat.getByLabel("Reason (kept in the admin log)").fill("Promotion over");
    await seat.getByRole("button", { name: "Remove premium seat" }).click();
    await expect(seat.getByText("Premium seat removed.")).toBeVisible();
    await page.goto("/");
    await expect(slide(laterPremium.id)).toHaveCount(0);
  });

  test("carousel controls: plays every 5 s, pauses on hover, focus and the Pause button, never by itself with reduced motion; arrows, keys and swipe", async ({ page, isMobile }) => {
    const seller = await createUser({ role: "seller" });
    await createAuction({ seller, endsAt: iso(2 * HOUR) });
    await createAuction({ seller, endsAt: iso(3 * HOUR) });
    const carousel = page.getByRole("region", { name: "Featured cars" });
    const position = carousel.locator("[data-carousel-position]");

    // Reduced motion: no autoplay.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/");
    await expect(carousel).toHaveAttribute("aria-roledescription", "carousel");
    await expect(position).toHaveText(/^1 \/ \d+$/);
    await expect(carousel.getByRole("button", { name: "Play featured cars automatically" })).toBeVisible();
    await page.waitForTimeout(6_500);
    await expect(position).toHaveText(/^1 \//);

    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.goto("/");
    await page.mouse.move(0, 0);
    await expect(carousel.getByRole("button", { name: "Pause featured cars" })).toBeVisible();
    // Plays by itself.
    await expect(position).toHaveText(/^2 \//, { timeout: 8_000 });
    if (!isMobile) {
      // Paused while the pointer is over it.
      await carousel.hover();
      const at = await position.innerText();
      await page.waitForTimeout(6_500);
      await expect(position).toHaveText(at);
      await page.mouse.move(0, 0);
    }
    // Paused while keyboard focus is inside (arrows and keys work).
    await carousel.getByRole("button", { name: "Next featured car" }).focus();
    const before = Number((await position.innerText()).split(" ")[0]);
    await page.keyboard.press("ArrowRight");
    const afterKey = Number((await position.innerText()).split(" ")[0]);
    expect(afterKey === before + 1 || afterKey === 1).toBe(true);
    await page.keyboard.press("ArrowLeft");
    await expect(position).toHaveText(new RegExp(`^${before} /`));
    await page.waitForTimeout(6_500);
    await expect(position).toHaveText(new RegExp(`^${before} /`));
    await carousel.getByRole("button", { name: "Previous featured car" }).click();
    await carousel.getByRole("button", { name: "Next featured car" }).click();
    await expect(position).toHaveText(new RegExp(`^${before} /`));
    // The slides are named "Slide n of N", and a move by the user is announced.
    await expect(carousel.locator('[aria-roledescription="slide"]').first()).toHaveAttribute("aria-label", /^Slide 1 of \d+$/);
    await expect(carousel.getByText(new RegExp(`^Slide ${before} of \\d+: `))).toBeAttached();

    // The Pause button stops it even with the pointer away and focus gone.
    await carousel.getByRole("button", { name: "Pause featured cars" }).click();
    await page.locator("body").click({ position: { x: 1, y: 1 } });
    await page.mouse.move(0, 0);
    const paused = await position.innerText();
    await page.waitForTimeout(6_500);
    await expect(position).toHaveText(paused);
    await expect(carousel.getByRole("button", { name: "Play featured cars automatically" })).toBeVisible();

    if (isMobile) {
      // Swipe: native scroll snap moves to the next car.
      await page.goto("/");
      await carousel.getByRole("button", { name: "Pause featured cars" }).click();
      await page.locator("body").click({ position: { x: 1, y: 1 } });
      const track = carousel.locator("[data-slide]").first().locator("..");
      await track.evaluate((el) => el.scrollBy({ left: el.clientWidth, behavior: "instant" as ScrollBehavior }));
      await expect(position).toHaveText(/^2 \//);
      await expectNoHorizontalScroll(page, "Home carousel on a phone");
    }
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
    const live = realtimeReady(page, "feed:auctions");
    await page.goto(`/?q=${model}`);
    const c = card(page, auction.id);
    await expect(c).toContainText("€20,000");
    await live;
    const { error } = await bid(bidder, auction.id, 21_000);
    expect(error).toBeNull();
    await expect(c).toContainText("€21,000", { timeout: 15_000 });
    await expect(c).toContainText("1 bid");
  });
});
