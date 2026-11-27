// Area 12: copy consistency with DECISIONS.md. Forbidden phrases never appear in
// the source or on any page, the fixed numbers are used everywhere, and times are
// shown in the viewer's own zone with its abbreviation (Berlin vs Tallinn).
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test, expect, signIn, expectAccessible } from "../support/fixtures";
import { createAuction, createUser, iso, DAY } from "../support/factory";
import { userDb } from "../support/supabase";

/** Phrases DECISIONS.md rules out (points 1, 2, 3, 4, 7, 8 and 11). Case-insensitive. */
const FORBIDDEN: [RegExp, string][] = [
  [/partner verified/i, "4: no partner verification"],
  [/partner workshops?/i, "3/4: no partner workshops"],
  [/independent workshops?/i, "4: no independent workshops"],
  [/professionally restored/i, "4: no 'Professionally restored'"],
  [/restored right/i, "1: no 'restored right' promise"],
  [/baltic time/i, "7: no 'Baltic time' labels"],
  [/biddr['’]s take/i, "8: 'Biddr's take' no longer exists"],
  [/only (for|in) the baltics|baltics only|estonia, latvia and lithuania/i, "2: not only the Baltics"],
  [/book(ing)? an inspection|inspection booking/i, "3: no inspection booking"],
  // The one paid seller product is the optional premium seat (always labelled "Featured"); no fee of any other kind.
  [/seller fee|listing fee|success fee|commission/i, "11: no seller fee"],
  [/(required|mandatory|compulsory) (premium seat|featur)|must (buy|pay for) a premium seat/i, "11: the premium seat is optional"],
  [/carfax|autodna|vin ?audit|history report included|free history report/i, "11: history reports come only from the seller's own carVertical report"],
  [/carvertical (partner|approved|certified|verified)|partnership with carvertical|in partnership with/i, "11: nothing suggests a carVertical partnership"],
  [/\[to be confirmed\]/i, "11: no unconfirmed placeholders"],
];

/** Lines that state the rule itself, so they may name the forbidden phrase. */
const ALLOWED_FILES = [/DECISIONS\.md$/, /CONSISTENCY_REVIEW\.md$/, /12-copy-consistency\.spec\.ts$/];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|sql|md|json)$/.test(name)) out.push(p);
  }
  return out;
}

const PAGES = ["/", "/?status=upcoming", "/?status=past", "/how-it-works", "/about", "/terms", "/terms/bidding", "/privacy", "/login"];

test.describe("copy consistency", () => {
  test("no forbidden phrase in the code, migrations, demo data or docs", async ({}, info) => {
    test.skip(info.project.name !== "desktop-berlin", "Source check runs once");
    const hits: string[] = [];
    for (const file of ["app", "components", "lib", "hooks", "supabase/migrations", "README.md"].flatMap((d) => {
      try {
        return statSync(d).isDirectory() ? walk(d) : [d];
      } catch {
        return [];
      }
    })) {
      if (ALLOWED_FILES.some((r) => r.test(file))) continue;
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, i) => {
          // Code comments explain the rules (for example "no partner workshops"); only shipped text counts.
          if (/^\s*(--|\/\/|\*|\/\*)/.test(line)) return;
          for (const [re, why] of FORBIDDEN) if (re.test(line)) hits.push(`${file}:${i + 1} (${why}): ${line.trim().slice(0, 120)}`);
        });
    }
    expect(hits, hits.join("\n")).toEqual([]);
  });

  test("the premium seat is the only paid seller product: optional, and disclosed as \"Featured\" wherever it's offered", async ({}, info) => {
    test.skip(info.project.name !== "desktop-berlin", "Source check runs once");
    // Every file that offers the seat to sellers says it's optional and labelled "Featured".
    const offers = ["app/account/listings/feature-car.tsx", "app/sell/submitted/page.tsx"];
    for (const f of offers) {
      const text = readFileSync(f, "utf8");
      expect(text, f).toMatch(/Optional/);
      expect(text, f).toMatch(/Featured/);
    }
    // The carousel always shows the label for a premium seat.
    expect(readFileSync("components/auction/featured-lot.tsx", "utf8")).toMatch(/premium \? \(\s*<span data-featured-label[^>]*>\s*Featured/);
  });

  test("the carVertical logo is used only in the history report section", async ({}, info) => {
    test.skip(info.project.name !== "desktop-berlin", "Source check runs once");
    const users = ["app", "components", "lib"]
      .flatMap((d) => walk(d))
      .filter((f) => /carvertical-logo/.test(readFileSync(f, "utf8")));
    expect(users).toEqual(["components/auction/history-report.tsx"]);
  });

  test("no forbidden phrase on any public page, signed out or in", async ({ page, context }) => {
    const seller = await createUser({ role: "seller" });
    const repaired = await createAuction({ seller, condition: "restored_accident", damageSummary: "Bumper replaced." });
    const inspected = await createAuction({
      seller,
      condition: "restored_accident",
      inspection: { dealer: "Demo Audi Zentrum, Hamburg", date: "2026-11-01", highlights: ["Brakes good", "Tyres good", "No leaks"] },
    });
    const check = async (label: string) => {
      const html = await page.content();
      for (const [re, why] of FORBIDDEN) expect(html, `${label}: ${why}`).not.toMatch(re);
      expect(await page.title(), `${label}: title`).not.toMatch(/baltic/i);
    };
    for (const path of [...PAGES, `/auctions/${repaired.id}`, `/auctions/${inspected.id}`]) {
      await page.goto(path);
      await check(path);
    }
    await signIn(context, seller);
    for (const path of ["/account/listings", "/account/watchlist", "/account/notifications", "/account/setup", "/sell"]) {
      await page.goto(path);
      await check(path);
    }
  });

  test("brand, title and meta description match the decisions", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cars worth chasing");
    const intro = "Rare finds. Brought back to life. Ready for a new story.";
    await expect(page.getByText(intro).first()).toBeVisible();
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", intro);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", intro);
    expect(await page.title()).toMatch(/^Biddr/);
  });

  test("bidding numbers are exactly €500 hold, 5% premium (€350 to €3,500), 2 minutes and 7 days", async ({ page }) => {
    // The full bidding terms are still a marked draft, so only How it works must state every number.
    for (const path of ["/how-it-works", "/about", "/terms/bidding", "/", "/sell"]) {
      await page.goto(path);
      const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
      if (path === "/how-it-works") {
        for (const must of ["€500", "5%", "€350", "€3,500", "2 minutes"]) expect(text, `${path} mentions ${must}`).toContain(must);
      }
      // Any hold amount or premium percentage named must be the decided one.
      for (const m of text.matchAll(/€\s?([\d,]+)\s+(?:refundable\s+)?(?:card\s+)?hold/gi)) expect(m[1], `${path}: hold`).toBe("500");
      for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s?%\s+buyer/gi)) expect(m[1], `${path}: premium`).toBe("5");
      for (const m of text.matchAll(/(?:last|final)\s+(\d+)\s+minutes?/gi)) expect(m[1], `${path}: anti-sniping`).toBe("2");
      for (const m of text.matchAll(/(?:at most|up to|maximum of)\s+(\d+)\s+days/gi)) expect(m[1], `${path}: duration`).toBe("7");
    }
  });

  test("navigation: Sell a car is a button, then the links in order; no About or Notifications in the menu; About in the footer", async ({ page, context, isMobile }) => {
    const footer = () => page.getByRole("contentinfo");
    const header = page.getByRole("banner");
    const sell = header.getByRole("link", { name: "Sell a car", exact: true }).locator("visible=true");
    // An outline button: 1px #71717A border, 8px corners, centred semibold text.
    async function expectSellButton(minHeight: number) {
      await expect(sell).toHaveCount(1);
      await expect(sell).toHaveCSS("border-top-width", "1px");
      await expect(sell).toHaveCSS("border-top-color", "rgb(113, 113, 122)");
      await expect(sell).toHaveCSS("border-top-left-radius", "8px");
      await expect(sell).toHaveCSS("justify-content", "center");
      await expect(sell).toHaveCSS("font-weight", "600");
      expect((await sell.boundingBox())!.height).toBeGreaterThanOrEqual(minHeight);
    }

    // Signed out.
    await page.goto("/how-it-works");
    await expect(footer().getByRole("link", { name: "How it works" })).toHaveCount(0);
    await expect(footer().getByRole("link", { name: "About", exact: true })).toHaveAttribute("href", "/about");
    if (isMobile) {
      await page.getByRole("button", { name: "Menu" }).click();
      const items = page.locator("header ul").locator("visible=true").getByRole("link");
      await expect(items).toHaveText(["Sell a car", "Auctions", "How it works", "Sign in"]);
      await expectSellButton(48);
      // Full width: as wide as the links under it.
      const [b, l] = [await sell.boundingBox(), await items.nth(1).boundingBox()];
      expect(Math.abs(b!.width - l!.width)).toBeLessThanOrEqual(1);
      await expect(header.getByRole("link", { name: "How it works" }).locator("visible=true")).toHaveAttribute("aria-current", "page");
      await page.keyboard.press("Escape");
    } else {
      const items = header.getByRole("navigation", { name: "Main" }).getByRole("link").locator("visible=true");
      await expect(items).toHaveText(["Auctions", "How it works", "Sell a car", "Sign in"]);
      await expectSellButton(40);
      await expect(header.getByRole("link", { name: "How it works" })).toHaveAttribute("aria-current", "page");
    }
    await expect(header.getByRole("link", { name: "About", exact: true })).toHaveCount(0);

    // Signed in, with one unanswered question and one answered on a live listing.
    const user = await createUser({ role: "seller" });
    const a = await createAuction({ seller: user });
    const asker = await createUser();
    const askerDb = await userDb(asker.email);
    await askerDb.from("comments").insert({ auction_id: a.id, content: "Any rust underneath?" });
    const { data: answeredQ } = await askerDb.from("comments").insert({ auction_id: a.id, content: "Two keys?" }).select("id").single();
    await (await userDb(user.email)).from("comments").insert({ auction_id: a.id, parent_id: answeredQ!.id, content: "Yes, two keys." });
    await signIn(context, user);
    await page.goto("/account/watchlist");
    if (isMobile) {
      await page.getByRole("button", { name: "Menu" }).click();
      const panel = page.locator("header ul").locator("visible=true");
      await expect(panel.getByRole("link")).toHaveText(["Sell a car", "Auctions", "How it works", "My listings 1 unanswered question", "My purchases", "Messages", "Watchlist", `Profile (${user.username})`]);
      await expect(panel.getByRole("link", { name: "My listings 1 unanswered question" })).toBeVisible();
      await expect(panel.getByRole("button", { name: "Sign out" })).toBeVisible();
      await expect(panel.getByRole("link", { name: "Watchlist" })).toHaveAttribute("aria-current", "page");
      // Every target in the phone menu is at least 44 px high.
      for (const el of await panel.locator("a, button").all()) expect((await el.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await expectSellButton(48);
    } else {
      await expect(header.getByRole("navigation", { name: "Main" }).getByRole("link").locator("visible=true")).toHaveText(["Auctions", "How it works", "Sell a car"]);
      await page.getByRole("button", { name: new RegExp(`^${user.username} 1 unanswered question, account menu$`) }).click();
      const items = page.locator("header li").filter({ visible: true });
      await expect(items).toHaveText(["My listings 1 unanswered question", "My purchases", "Messages", "Watchlist", "Profile", "Sign out"]);
      await expect(page.getByRole("link", { name: "Watchlist" })).toHaveAttribute("aria-current", "page");
    }
    await expect(header.getByRole("link", { name: /^Notifications/ })).toHaveCount(0);
    await expect(page.getByText("Selling", { exact: true })).toHaveCount(0);

    // My listings shows the count on the listing.
    await page.goto("/account/listings");
    await expect(page.getByRole("link", { name: new RegExp(`${a.title}.*1 unanswered question`) })).toBeVisible();
  });

  test("admins see Admin in the menu, after Profile", async ({ page, context, isMobile }) => {
    const admin = await createUser({ role: "admin" });
    await signIn(context, admin);
    await page.goto("/");
    if (isMobile) {
      await page.getByRole("button", { name: "Menu" }).click();
      await expect(page.locator("header ul").locator("visible=true").getByRole("link").last()).toHaveText("Admin");
    } else {
      await page.getByRole("button", { name: /account menu/ }).click();
      await expect(page.locator("header li").filter({ visible: true })).toHaveText(["My listings", "My purchases", "Messages", "Watchlist", "Profile", "Admin", "Sign out"]);
    }
  });

  test("footer: wordmark and company line, then the links in order; About is marked on the About page", async ({ page, isMobile }) => {
    await page.goto("/about");
    await expect(page.getByRole("heading", { level: 1, name: "About Biddr" })).toBeVisible();
    const footer = page.getByRole("contentinfo");
    const home = footer.getByRole("link", { name: /^Biddr\. ?, home$/ });
    await expect(home).toHaveAttribute("href", "/");
    await expect(home.locator("span.text-signal")).toHaveText(".");
    const company = footer.getByText("[Company name, registry code, address]");
    const nav = footer.getByRole("navigation", { name: "Help and information" });
    const links = nav.getByRole("link");
    await expect(links).toHaveText(["About", "Help and contact", "Terms", "Bidding terms", "Privacy"]);
    await expect(nav.getByRole("link", { name: "About" })).toHaveAttribute("aria-current", "page");
    await expect(nav.getByRole("link", { name: "About" })).toHaveCSS("color", "rgb(255, 85, 0)");
    await expect(nav.locator('[aria-current="page"]')).toHaveCount(1);

    const [h, c, n] = [await home.boundingBox(), await company.boundingBox(), await nav.boundingBox()];
    // About 6 px between the wordmark and the company line.
    expect(Math.abs(c!.y - (h!.y + h!.height) - 6)).toBeLessThanOrEqual(2);
    for (const box of await links.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) {
      expect(box).toBeGreaterThanOrEqual(44);
    }
    if (isMobile) {
      // Phones: logo and company line first, then the links below, left-aligned with them.
      expect(n!.y).toBeGreaterThanOrEqual(c!.y + c!.height);
      const firstText = await links.first().evaluate((a) => {
        const r = document.createRange();
        r.selectNodeContents(a);
        return r.getBoundingClientRect().left;
      });
      expect(Math.abs(firstText - h!.x)).toBeLessThanOrEqual(2);
    } else {
      // Desktop: one row, right-aligned, both sides vertically centred against each other.
      const tops = await links.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
      expect(new Set(tops).size).toBe(1);
      const left = { top: h!.y, bottom: c!.y + c!.height };
      expect(Math.abs((left.top + left.bottom) / 2 - (n!.y + n!.height / 2))).toBeLessThanOrEqual(2);
      // Right-aligned: the last link's text ends at the footer's right content edge.
      const gap = await footer.locator("> div").evaluate((div) => {
        const right = div.getBoundingClientRect().right - parseFloat(getComputedStyle(div).paddingRight);
        const last = Array.from(div.querySelectorAll("nav a")).pop()!;
        const r = document.createRange();
        r.selectNodeContents(last);
        return right - r.getBoundingClientRect().right;
      });
      expect(Math.abs(gap)).toBeLessThanOrEqual(2);
    }
    await expectAccessible(page, "About page and footer");

    // Elsewhere nothing in the footer is marked current.
    await page.goto("/how-it-works");
    await expect(page.getByRole("contentinfo").locator('[aria-current="page"]')).toHaveCount(0);
  });

  test("times are shown in the viewer's zone with its abbreviation", async ({ page, context, seed }, info) => {
    const tz = info.project.use.timezoneId;
    const [abbr, hour] = tz === "Europe/Tallinn" ? ["EET", "21:00"] : ["CET", "20:00"];
    const seller = await createUser({ role: "seller" });
    // 1 December 2026, 19:00 UTC: 20:00 CET in Berlin, 21:00 EET in Tallinn.
    const a = await createAuction({ seller, status: "upcoming", startsAt: "2026-12-01T19:00:00.000Z", endsAt: "2026-12-03T19:00:00.000Z" });
    await signIn(context, seed.admin);
    await page.goto(`/admin/auctions/${a.id}`);
    await expect(page.getByText(`Bidding opens Tue, 1 Dec 2026, ${hour} ${abbr}`)).toBeVisible();
    await expect(page.getByText(/Baltic/i)).toHaveCount(0);

    // A comment's exact time (on hover) is in the viewer's zone too.
    const live = await createAuction({ seller, endsAt: iso(DAY) });
    await (await userDb(seller.email)).from("comments").insert({ auction_id: live.id, content: "Happy to answer questions." });
    await page.goto(`/auctions/${live.id}`);
    const stamp = page.getByRole("region", { name: "Questions and comments" }).locator("[title]").first();
    await expect(stamp).toHaveText("just now");
    await expect(stamp).toHaveAttribute("title", new RegExp(`\\d{2}:\\d{2} ${abbr}$`));
  });
});
