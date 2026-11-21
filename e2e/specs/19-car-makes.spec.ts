// Area 19: the complete car make list. The searchable Make combobox in the sell form
// and the admin editor (keyboard, popular makes, accents and aliases), the "Other"
// path (stored with make_other, admins told, note on the review page, still approvable),
// model suggestions, and home search finding the new names.
import type { Page } from "@playwright/test";
import { test, expect, signIn, expectAccessible } from "../support/fixtures";
import { createAuction, createUser, getAuction, iso, notificationsFor, randomVin, service, DAY } from "../support/factory";
import { continueButton, fillSellForm } from "../support/sell";
import { CAR_MAKES, MAKE_ALIASES, POPULAR_MAKES, findMake, normalizeMake, searchMakes } from "../../lib/data/car-makes";

const optionNames = async (page: Page) => (await page.getByRole("listbox").getByRole("option").allTextContents()).map((t) => t.trim());

test.describe("the make list", () => {
  test.skip(({ isMobile }) => isMobile, "no screen involved: runs once");

  test("is complete, unique and consistent", () => {
    expect(CAR_MAKES.length).toBe(135);
    expect(new Set(CAR_MAKES.map(normalizeMake)).size).toBe(CAR_MAKES.length);
    for (const m of POPULAR_MAKES) expect(CAR_MAKES).toContain(m);
    for (const targets of Object.values(MAKE_ALIASES)) for (const t of targets) expect(CAR_MAKES).toContain(t);
    expect(CAR_MAKES).toEqual(expect.arrayContaining(["Škoda", "Citroën", "Lynk & Co", "smart", "IZh", "Mercedes-Benz", "Mercedes-AMG"]));
  });

  test("search ignores case, accents and punctuation, finds aliases, and puts word starts and popular makes first", () => {
    expect(searchMakes("")).toEqual([...POPULAR_MAKES]);
    expect(searchMakes("skoda")[0]).toBe("Škoda");
    expect(searchMakes("ŠKODA")[0]).toBe("Škoda");
    expect(searchMakes("citroen")[0]).toBe("Citroën");
    expect(searchMakes("vw")[0]).toBe("Volkswagen");
    for (const a of ["merc", "mercedes", "benz"]) expect(searchMakes(a)[0], a).toBe("Mercedes-Benz");
    expect(searchMakes("amg")[0]).toBe("Mercedes-AMG");
    expect(searchMakes("bimmer")[0]).toBe("BMW");
    expect(searchMakes("chevy")[0]).toBe("Chevrolet");
    expect(searchMakes("zhiguli")[0]).toBe("Lada");
    expect(searchMakes("lada-vaz")[0]).toBe("Lada");
    expect(searchMakes("landy")[0]).toBe("Land Rover");
    expect(searchMakes("ssang yong").slice(0, 2).sort()).toEqual(["KGM", "SsangYong"]);
    // The start of the name first, then the start of a later word.
    expect(searchMakes("rover").slice(0, 2)).toEqual(["Rover", "Land Rover"]);
    expect(searchMakes("ro")[0]).toBe("Rolls-Royce");
    // Equally good matches: popular first ("M": Mercedes-Benz before Mahindra).
    expect(searchMakes("m").slice(0, 3)).toEqual(["Mercedes-Benz", "Mercedes-AMG", "McLaren"]);
    expect(searchMakes("a").length).toBe(10);
    expect(searchMakes("zzzz")).toEqual([]);

    expect(findMake("skoda")).toBe("Škoda");
    expect(findMake("  rolls-royce ")).toBe("Rolls-Royce");
    expect(findMake("Lynk and Co")).toBeNull();
    expect(findMake("ssang yong")).toBe("SsangYong");
    expect(findMake("Zenvo")).toBeNull();
  });
});

test.describe("sell form: Make", () => {
  test.describe.configure({ timeout: 180_000 });

  test("popular makes when empty; typing filters; keys choose; Escape closes; an alias typed and left is chosen", async ({ page, context }) => {
    const seller = await createUser();
    await signIn(context, seller);
    await page.goto("/sell");
    const make = page.getByRole("combobox", { name: "Make" });
    await expect(make).toHaveAttribute("aria-expanded", "false");

    // Focused and empty: the popular makes.
    await make.focus();
    await expect(make).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("listbox", { name: "Popular makes" })).toBeVisible();
    expect(await optionNames(page)).toEqual([...POPULAR_MAKES]);
    await expectAccessible(page, "Sell: Make list open");

    // Typing filters, with "Other: <text>" always last.
    await make.fill("skoda");
    await expect(page.getByRole("listbox", { name: "Makes" })).toBeVisible();
    expect(await optionNames(page)).toEqual(["Škoda", "Other: skoda"]);
    await expect(page.getByText("1 make found.")).toBeAttached();

    // ↓ highlights (aria-activedescendant), Enter chooses without submitting.
    await page.keyboard.press("ArrowDown");
    const first = page.getByRole("option", { name: "Škoda" });
    await expect(make).toHaveAttribute("aria-activedescendant", (await first.getAttribute("id"))!);
    await page.keyboard.press("Enter");
    await expect(make).toHaveValue("Škoda");
    await expect(make).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("heading", { name: "The car" })).toBeVisible();

    // ↑ wraps to "Other"; Escape closes the list and keeps the text.
    await make.fill("merc");
    await page.keyboard.press("ArrowUp");
    await expect(page.getByRole("option", { name: "Other: merc" })).toHaveAttribute("id", (await make.getAttribute("aria-activedescendant"))!);
    await page.keyboard.press("Escape");
    await expect(make).toHaveAttribute("aria-expanded", "false");
    await expect(make).toHaveValue("merc");
    // Alt+↓ opens without moving the highlight.
    await page.keyboard.press("Alt+ArrowDown");
    await expect(make).toHaveAttribute("aria-expanded", "true");
    expect(await make.getAttribute("aria-activedescendant")).toBeNull();
    expect((await optionNames(page))[0]).toBe("Mercedes-Benz");

    // An alias typed and left (Tab) becomes the make.
    await make.fill("vw");
    await page.keyboard.press("Tab");
    await expect(make).toHaveValue("Volkswagen");

    // Text that isn't a make, not chosen as Other: Continue explains.
    await make.fill("Zenvo");
    await page.keyboard.press("Tab");
    await expect(make).toHaveValue("Zenvo");
    await continueButton(page).click();
    await expect(page.getByText("Choose a make from the list, or choose “Other: Zenvo”.")).toBeVisible();
    await expect(make).toHaveAttribute("aria-invalid", "true");

    // Clicking an option chooses it.
    await make.fill("porsch");
    await page.getByRole("option", { name: "Porsche", exact: true }).click();
    await expect(make).toHaveValue("Porsche");
    await expect(page.getByText(/Choose a make from the list/)).toHaveCount(0);
  });

  test("model suggestions come from models already listed for the make", async ({ page, context }) => {
    const seller = await createUser({ role: "seller" });
    await createAuction({ seller, make: "Lotus", model: "Exige Sport 390" });
    await signIn(context, seller);
    await page.goto("/sell");
    await page.getByRole("combobox", { name: "Make" }).fill("Lotus");
    await page.getByRole("option", { name: "Lotus", exact: true }).click();
    const model = page.getByLabel("Model");
    await expect(model).toHaveAttribute("list", "sell-model-suggestions");
    await expect(page.locator('#sell-model-suggestions option[value="Exige Sport 390"]')).toBeAttached();
    // Any model can still be typed.
    await model.fill("Evora");
    await expect(model).toHaveValue("Evora");
  });

  test("Other: the typed make is stored with make_other, admins are told, and the admin sees a note and can still approve", async ({ page, context, seed }) => {
    const seller = await createUser();
    await signIn(context, seller);
    await page.goto("/sell");
    const vin = randomVin();
    await fillSellForm(page, { make: "Zenvo", otherMake: true, model: "TSR-S", vin });
    await page.getByLabel("I confirm the information is accurate and I have the right to sell this car.").check();
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByRole("heading", { name: "Thanks, your car is submitted" })).toBeVisible({ timeout: 30_000 });

    const { data: auction } = await service().from("auctions").select("id, make, make_other, title").eq("vin", vin).single();
    expect(auction).toMatchObject({ make: "Zenvo", make_other: true });
    await expect
      .poll(async () => (await notificationsFor(seed.admin, "make_suggested")).filter((n) => n.auction_id === auction!.id).map((n) => n.data))
      .toEqual([{ make: "Zenvo" }]);

    // The admin's notification and the review page.
    await signIn(context, seed.admin);
    // Other tests running at the same time also notify the shared test admin, so the
    // notification may be on a later page of the list: look through the first few.
    let shown = false;
    for (let n = 1; n <= 5 && !shown; n++) {
      await page.goto(`/account/notifications?page=${n}`);
      shown = (await page.locator("main").getByText("New make suggested: Zenvo").count()) > 0;
    }
    expect(shown, "New make suggested: Zenvo on the notifications page").toBe(true);
    // This test is about the make: the fake-listing checks (spec 25) are passed here directly.
    const { data: owner } = await service().from("auctions").select("seller_id").eq("id", auction!.id).single();
    await service().from("listing_verifications").update({ outcome: "green", checked_at: new Date().toISOString() }).eq("auction_id", auction!.id);
    await service().from("profiles").update({ identity_status: "verified", identity_verified_name: "E2E Private Name" }).eq("id", owner!.seller_id);
    await page.goto(`/admin/auctions/${auction!.id}`);
    const note = page.getByRole("note", { name: "Suggested make" });
    await expect(note).toContainText("Suggested make: Zenvo.");
    await expect(note).toContainText("Add it to lib/data/car-makes.ts in a future update");
    await expect(page.getByRole("combobox", { name: "Make" })).toHaveValue("Zenvo");
    await expectAccessible(page, "Admin: suggested make");

    // It can still be approved.
    await page.getByRole("button", { name: "Start tomorrow 12:00, end in 7 days at 20:00" }).click();
    await page.getByRole("button", { name: "Save schedule" }).click();
    await expect(page.getByText("Done: Start and end time saved")).toBeAttached({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Approve and schedule", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "Approve and schedule", exact: true }).click();
    const dialog = page.getByRole("dialog").or(page.getByRole("alertdialog")).last();
    await dialog.getByRole("button", { name: "Approve and schedule", exact: true }).click();
    await expect.poll(async () => (await getAuction<{ status: string }>(auction!.id)).status).toBe("upcoming");
  });

  test("an old draft with make Other keeps the typed make", async ({ page, context }) => {
    const seller = await createUser();
    await signIn(context, seller);
    await page.goto("/sell");
    await page.evaluate((id) => {
      window.localStorage.setItem(
        `biddr:sell:v1:${id}`,
        JSON.stringify({ v: 2, draftId: crypto.randomUUID(), step: 1, furthest: 1, values: { make: "Other", makeOther: "skoda" }, photos: {} }),
      );
    }, seller.id);
    await page.reload();
    await expect(page.getByRole("combobox", { name: "Make" })).toHaveValue("Škoda");
  });
});

test.describe("admin editor: Make", () => {
  test.skip(({ isMobile }) => isMobile, "admin desktop");

  test("the combobox writes the listed name and clears the suggestion", async ({ page, context, seed }) => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({ seller, make: "Skoda typo", status: "draft", startsAt: iso(2 * DAY), endsAt: iso(5 * DAY) });
    await service().from("auctions").update({ make_other: true }).eq("id", a.id);
    await signIn(context, seed.admin);
    await page.goto(`/admin/auctions/${a.id}`);
    await expect(page.getByRole("note", { name: "Suggested make" })).toContainText("Suggested make: Skoda typo.");
    const make = page.getByRole("combobox", { name: "Make" });
    await make.fill("skod");
    await page.getByRole("option", { name: "Škoda", exact: true }).click();
    await page.getByLabel("Model", { exact: true }).fill("Octavia RS");
    await page.getByRole("button", { name: "Save listing details" }).click();
    await expect.poll(async () => getAuction<{ make: string; make_other: boolean; model: string }>(a.id)).toMatchObject({
      make: "Škoda",
      make_other: false,
      model: "Octavia RS",
    });
    await page.reload();
    await expect(page.getByRole("note", { name: "Suggested make" })).toHaveCount(0);
  });
});

test.describe("home search with the new names", () => {
  test("“skoda” finds a Škoda, “citroen” a Citroën", async ({ page }) => {
    const seller = await createUser({ role: "seller" });
    const skoda = await createAuction({ seller, make: "Škoda", model: "Octavia RS" });
    const citroen = await createAuction({ seller, make: "Citroën", model: "DS3 Racing" });
    await page.goto("/?q=skoda");
    await expect(page.getByRole("link", { name: new RegExp(skoda.title) }).first()).toBeVisible();
    await page.goto("/?q=citroen%20ds3");
    await expect(page.getByRole("link", { name: new RegExp(citroen.title) }).first()).toBeVisible();
    // End them, so repeated runs don't fill the search results with test cars.
    await service().from("auctions").update({ status: "ended" }).in("id", [skoda.id, citroen.id]);
  });
});
