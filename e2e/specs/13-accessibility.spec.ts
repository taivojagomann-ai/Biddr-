// Area 13: accessibility. axe (WCAG 2.2 AA, serious and critical issues) on every
// page at desktop and phone size, and the bid and sell flows done with the keyboard only.
import type { Page } from "@playwright/test";
import { test, expect, signIn, expectAccessible } from "../support/fixtures";
import { createAuction, createUser, getAuction, iso, DAY, randomVin, readyBidder, service } from "../support/factory";
import { testJpeg } from "../support/sell";

test.describe("axe on every page", () => {
  test("public pages", async ({ page }) => {
    const seller = await createUser({ role: "seller" });
    const live = await createAuction({ seller, condition: "restored_accident", damageSummary: "Door repaired.", beforePhotos: 2 });
    const upcoming = await createAuction({ seller, status: "upcoming", startsAt: iso(DAY), endsAt: iso(3 * DAY) });
    const sold = await createAuction({ seller, status: "sold", startsAt: iso(-5 * DAY), endsAt: iso(-DAY) });
    const inspected = await createAuction({
      seller,
      inspection: { dealer: "Demo Porsche Zentrum, Stuttgart", date: "2026-11-01", highlights: ["Brakes good", "Tyres good", "No leaks"] },
    });
    for (const path of [
      "/",
      "/?status=newest",
      "/?status=upcoming",
      "/?status=past",
      "/?q=nothing-matches-this",
      "/how-it-works",
      "/terms",
      "/terms/bidding",
      "/privacy",
      "/login",
      `/auctions/${live.id}`,
      `/auctions/${upcoming.id}`,
      `/auctions/${sold.id}`,
      `/auctions/${inspected.id}`,
    ]) {
      await page.goto(path);
      await expectAccessible(page, path);
    }
    const res = await page.goto("/auctions/00000000-0000-0000-0000-000000000000");
    expect(res?.status()).toBe(404);
    await expectAccessible(page, "404");
  });

  test("signed-in pages, the sell form steps and the bid dialog", async ({ page, context }) => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({ seller: await createUser({ role: "seller" }) });
    await createAuction({ seller, status: "draft" });
    await signIn(context, seller);
    for (const path of ["/account/setup", "/account/listings", "/account/watchlist", "/account/notifications", "/sell"]) {
      await page.goto(path);
      await expectAccessible(page, path);
    }
    // Errors shown on the first sell step.
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Choose the make.")).toBeVisible();
    await expectAccessible(page, "/sell with errors");

    // Bid dialog for a ready bidder.
    await signIn(context, await readyBidder(a.id));
    await page.goto(`/auctions/${a.id}`);
    await page.getByRole("button", { name: /^(Bid €[\d,]+|Place bid)$/ }).locator("visible=true").first().click();
    await expect(page.getByRole("dialog", { name: "Confirm your bid" })).toBeVisible();
    await expectAccessible(page, "Bid dialog");
  });

  test("admin pages", async ({ page, context, seed }) => {
    const a = await createAuction({ seller: await createUser({ role: "seller" }), status: "draft" });
    await signIn(context, seed.admin);
    for (const path of ["/admin", "/admin?tab=live", "/admin?tab=closed", `/admin/auctions/${a.id}`]) {
      await page.goto(path);
      await expectAccessible(page, path);
    }
  });
});

/** Presses Tab until the focused element matches, then returns. Fails after `max` presses. */
async function tabTo(page: Page, matches: (el: { id: string; name: string; text: string; type: string }) => boolean, max = 80) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press("Tab");
    const el = await page.evaluate(() => {
      const e = document.activeElement as HTMLInputElement | null;
      return { id: e?.id ?? "", name: e?.getAttribute("name") ?? "", text: (e?.getAttribute("aria-label") || e?.textContent || "").trim(), type: e?.type ?? "" };
    });
    if (matches(el)) return el;
  }
  throw new Error("Element not reached with Tab");
}

test.describe("keyboard only", () => {
  test("the bid flow, from the bid button to the high bid, without a mouse", async ({ page, context }) => {
    const a = await createAuction({ seller: await createUser({ role: "seller" }), startingBid: 25_000 });
    const bidder = await readyBidder(a.id);
    await signIn(context, bidder);
    await page.goto(`/auctions/${a.id}`);
    await tabTo(page, (e) => /^(Bid €[\d,]+|Place bid)$/.test(e.text), 120);
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Confirm your bid" });
    await expect(dialog).toBeVisible();
    // Focus starts inside the dialog and stays there.
    expect(await dialog.evaluate((d) => d.contains(document.activeElement))).toBe(true);
    await tabTo(page, (e) => e.id === "modal-bid", 10);
    await page.keyboard.press("Control+A");
    await page.keyboard.type("26000");
    await tabTo(page, (e) => e.text === "Place bid of €26,000", 10);
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog", { name: "You have the high bid" })).toBeVisible();
    expect((await getAuction<{ current_bid: number }>(a.id)).current_bid).toBe(26_000);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("the sell flow, from an empty form to submitted, without a mouse", async ({ page, context }) => {
    test.setTimeout(240_000);
    const seller = await createUser();
    await signIn(context, seller);
    await page.goto("/sell");
    const vin = randomVin();
    const jpeg = await testJpeg(page);
    page.on("filechooser", (chooser) =>
      void chooser.setFiles(Array.from({ length: 6 }, (_, i) => ({ name: `photo-${i}.jpg`, mimeType: "image/jpeg", buffer: jpeg }))),
    );

    // Each step: Tab through the form, act on the fields we know, then Enter on Continue.
    type Act = string | ((page: Page) => Promise<void>);
    const step = async (actions: Record<string, Act>, finish = "Continue", ready?: () => Promise<void>) => {
      const pending = new Map(Object.entries(actions));
      for (let i = 0; i < 250 && pending.size; i++) {
        await page.keyboard.press("Tab");
        const keys = await page.evaluate(() => {
          const e = document.activeElement as HTMLElement | null;
          return [e?.id ?? "", e?.getAttribute("name") ? `name:${e.getAttribute("name")}` : ""].filter(Boolean);
        });
        const key = keys.find((k) => pending.has(k));
        if (key === undefined) continue;
        const act = pending.get(key)!;
        pending.delete(key);
        if (typeof act === "string") await page.keyboard.type(act);
        else await act(page);
      }
      expect([...pending.keys()], "fields not reached by Tab").toEqual([]);
      await ready?.();
      await tabTo(page, (e) => e.text === finish, 80);
      await page.keyboard.press("Enter");
    };
    const space = async (p: Page) => p.keyboard.press("Space");
    const second = async (p: Page) => p.keyboard.press("ArrowDown");

    await step({
      "sell-make": "BMW",
      "sell-model": "M3",
      "sell-year": "2018",
      "sell-vin": vin,
      "sell-mileageKm": "61000",
      "sell-transmission": "6-speed manual",
      "sell-engine": "3.0 L twin-turbo straight-six",
      "sell-drivetrain": "R",
      "sell-exteriorColor": "San Marino Blue",
      "sell-bodyStyle": "Sedan",
      "sell-interiorColor": "Black leather",
      "sell-ownerCount": "2",
      "sell-city": "Hamburg",
      "sell-country": "Germany",
      "name:sellerType": space,
      "sell-registrationCountry": "Germany",
      "name:isRegistered": space,
    });
    await expect(page.getByRole("heading", { name: "History" })).toBeFocused();
    await step({ "name:hadDamage": space });
    await step({
      "sell-highlights": "Full service history",
      "sell-highlights-1": "Manual gearbox",
      "sell-highlights-2": "Never tracked",
      "sell-noModifications": space,
      "sell-noKnownFlaws": space,
    });
    const addPhotos = (section: string) => async (p: Page) => {
      await p.keyboard.press("Enter");
      await expect(page.getByRole("group", { name: section, exact: true }).getByText(/of at least \d+ added/)).toContainText(/^[2-9] of|^6 of/, { timeout: 60_000 });
    };
    await step({
      "sell-photos-exterior": addPhotos("Exterior"),
      "sell-photos-interior": addPhotos("Interior"),
      "sell-photos-mechanical": addPhotos("Engine and underside"),
    }, "Continue", async () => {
      // "Added" counts photos as soon as they're chosen; like a person, wait until
      // every one has finished uploading before continuing.
      await expect(page.getByText(/^(Uploading \d+%|Resizing…|Waiting…)$/)).toHaveCount(0, { timeout: 90_000 });
    });
    await step({ "sell-startingBid": "30000", "name:dealerInspection": second });
    await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
    await step({ "sell-confirmed": space }, "Submit for review");
    await expect(page.getByRole("heading", { name: "Thanks, your car is submitted" })).toBeVisible({ timeout: 30_000 });
    const { data } = await service().from("auctions").select("status").eq("vin", vin).single();
    expect(data?.status).toBe("draft");
  });
});
