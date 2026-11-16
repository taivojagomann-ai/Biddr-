import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// Must match tests/a11y/mock-supabase.mjs
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const ACCESS_TOKEN = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
  sub: "00000000-0000-4000-8000-0000000000aa", aud: "authenticated", role: "authenticated",
  aal: "aal2", amr: [{ method: "totp", timestamp: 1700000000 }], exp: 4102444800,
})}.a11y-signature`;
const ME = "00000000-0000-4000-8000-0000000000aa";
const LIVE = "10000000-0000-4000-8000-000000000001";
const RESTORED = "10000000-0000-4000-8000-000000000002";
const UPCOMING = "10000000-0000-4000-8000-000000000003";
const SOLD = "10000000-0000-4000-8000-000000000004";
const MY_DRAFT = "10000000-0000-4000-8000-000000000005";
const MY_REJECTED = "10000000-0000-4000-8000-000000000006";
const MOCK = "http://127.0.0.1:54329";

// Embedded YouTube/Vimeo players are third-party code we can't change (YouTube's
// player has its own axe findings). Our <iframe> must still have a title; checked below.
// The player loads from youtube-nocookie.com or player.vimeo.com.
const THIRD_PARTY_FRAMES = 'iframe[src*="youtube"], iframe[src*="vimeo"]';
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/** Signs the browser in as the mock's admin user by setting the Supabase auth cookie. */
async function signIn(context: BrowserContext) {
  const session = {
    access_token: ACCESS_TOKEN,
    token_type: "bearer",
    expires_in: 86_400,
    expires_at: Math.floor(Date.now() / 1000) + 86_400,
    refresh_token: "a11y-refresh-token",
    user: { id: ME, aud: "authenticated", role: "authenticated", email: "test.admin@example.com", app_metadata: {}, user_metadata: {} },
  };
  await context.addCookies([
    {
      name: "sb-127-auth-token",
      value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64url")}`,
      domain: "127.0.0.1",
      path: "/",
    },
  ]);
}

/**
 * Runs axe and fails on serious or critical WCAG 2.2 A/AA violations. For open
 * popovers, pass `include` to scan just the popover: content underneath it can't be
 * used while it's open, and axe would report those targets as "obscured".
 */
async function expectNoSeriousViolations(page: Page, label: string, include?: string) {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS).exclude(THIRD_PARTY_FRAMES);
  if (include) builder = builder.include(include);
  for (const frame of await page.locator(THIRD_PARTY_FRAMES).all()) {
    expect((await frame.getAttribute("title"))?.trim(), `${label}: video frame needs a title`).toBeTruthy();
  }
  const results = await builder.analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const other = results.violations.filter((v) => !serious.includes(v));
  if (other.length) console.log(`[axe] ${label}: ${other.map((v) => `${v.impact} ${v.id} (${v.nodes.length})`).join(", ")}`);
  const summary = serious.map(
    (v) => `${v.impact} ${v.id}: ${v.help}\n${v.nodes.map((n) => `    ${n.target.join(" ")}: ${n.failureSummary?.split("\n")[1] ?? ""}`).join("\n")}`,
  );
  expect(serious, `${label}\n${summary.join("\n")}`).toEqual([]);
}

async function noHorizontalScroll(page: Page, label: string) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label} scrolls sideways by ${overflow}px at 320px`).toBeLessThanOrEqual(0);
}

/** A complete saved /sell draft, so each step can be opened directly. */
function sellDraft(step: number) {
  const url = (s: string, i: number) => `${MOCK}/storage/v1/object/public/auction-photos/${ME}/3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f/${s}/${i}0000000-0000-4000-8000-000000000000.webp`;
  const list = (s: string, n: number) => Array.from({ length: n }, (_, i) => url(s, i + 1));
  return JSON.stringify({
    v: 2,
    draftId: "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    step,
    furthest: 5,
    values: {
      make: "BMW", makeOther: "", model: "M3", variant: "Touring", year: "2023", vin: "WBS8M9C50G5K12345",
      mileageKm: "12000", engine: "3.0 inline-6 twin-turbo, 510 hp", transmission: "8-speed automatic", drivetrain: "AWD",
      exteriorColor: "Frozen Deep Grey", city: "Tallinn", country: "EE", hadDamage: "yes",
      bodyStyle: "estate", interiorColor: "Black Merino leather", ownerCount: "1", sellerType: "dealer",
      dealerName: "Example Motors OÜ", dealerRegistryCode: "12345678", registrationCountry: "EE", isRegistered: "yes",
      highlights: ["One owner from new", "Carbon bucket seats", "Full BMW service history"],
      equipment: ["Harman Kardon sound", "Head-up display"], modifications: [""], noModifications: true,
      knownFlaws: ["Stone chips on the bonnet"], noKnownFlaws: false,
      serviceHistory: [{ date: "2025-06", mileage: "11000", description: "Oil service", workshop: "BMW Tallinn" }],
      itemsIncluded: ["Second key"], sellerNotes: "Garaged.",
      damageSummary: "Rear bumper replaced at a main-dealer body shop after a car park scrape. Airbags did not deploy.",
      videoUrl: "", startingBid: "60000", reserve: "70000", confirmed: false,
      dealerInspection: "yes", reportDealerName: "Demo BMW Centre", reportDealerCity: "Helsinki", reportDealerCountry: "FI",
      reportDate: new Date(Date.now() - 10 * 86_400_000).toISOString().slice(0, 10), reportMileage: "11900",
      reportFiles: [{ path: `${ME}/3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f/aaaaaaaa-0000-4000-8000-000000000001.pdf`, name: "bmw-report.pdf" }],
    },
    photos: { exterior: list("exterior", 6), interior: list("interior", 4), mechanical: list("mechanical", 2), before: list("before", 2) },
  });
}

const PUBLIC_PAGES = [
  ["Home", "/"],
  ["Home, past results", "/?status=past"],
  ["Home, search with no results", "/?q=Lotus"],
  ["Home, search results", "/?q=bmw"],
  ["Home, search with only past results", "/?q=c63"],
  ["Live auction", `/auctions/${LIVE}`],
  ["Restored car", `/auctions/${RESTORED}`],
  ["Upcoming auction", `/auctions/${UPCOMING}`],
  ["Sold auction (demo listing)", `/auctions/${SOLD}`],
  ["Sign in", "/login"],
  ["Sign in, expired link", "/login?error=link"],
  ["How it works", "/how-it-works"],
  ["Terms", "/terms"],
  ["Privacy", "/privacy"],
  ["Bidding terms", "/terms/bidding"],
  ["Not found", "/no-such-page"],
] as const;

const SIGNED_IN_PAGES = [
  ["Profile", "/account/setup"],
  ["My listings", "/account/listings"],
  ["Notifications", "/account/notifications"],
  ["Watchlist", "/account/watchlist"],
  ["Watchlist, ended", "/account/watchlist?tab=ended"],
  ["Sell, step 1", "/sell"],
  ["Listing submitted", `/sell/submitted?id=${MY_DRAFT}`],
  ["Admin list", "/admin"],
  ["Admin list, live", "/admin?tab=live"],
  ["Admin auction, draft", `/admin/auctions/${MY_DRAFT}`],
  ["Admin auction, live", `/admin/auctions/${LIVE}`],
] as const;

test.describe("public pages", () => {
  for (const [label, path] of PUBLIC_PAGES) {
    test(`${label} has no serious axe violations`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await expectNoSeriousViolations(page, label);
    });
  }

  test("bid dialog (signed out) has no serious axe violations", async ({ page }) => {
    await page.goto(`/auctions/${LIVE}`);
    await page.getByRole("button", { name: /^(Bid|Place bid)/ }).filter({ visible: true }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoSeriousViolations(page, "Bid dialog");
  });

  test("sign-in code step has no serious axe violations", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("someone@example.com");
    await page.getByRole("button", { name: "Email me a sign-in link" }).click();
    await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
    await expectNoSeriousViolations(page, "Sign-in code step");
  });
});

test.describe("signed-in pages", () => {
  test.beforeEach(async ({ context }) => signIn(context));

  for (const [label, path] of SIGNED_IN_PAGES) {
    test(`${label} has no serious axe violations`, async ({ page }) => {
      await page.goto(path);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await expectNoSeriousViolations(page, label);
    });
  }

  test("sell step 1 with errors has no serious axe violations", async ({ page }) => {
    await page.goto("/sell");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Choose the make.")).toBeVisible();
    await expectNoSeriousViolations(page, "Sell step 1 errors");
  });

  for (const step of [2, 3, 4, 5, 6]) {
    test(`sell step ${step} has no serious axe violations`, async ({ page }) => {
      await page.addInitScript(
        ([key, value]) => window.localStorage.setItem(key, value),
        [`biddr:sell:v1:${ME}`, sellDraft(step)] as const,
      );
      await page.goto("/sell");
      await expect(page.getByRole("heading", { level: 2 }).first()).toBeVisible();
      await expectNoSeriousViolations(page, `Sell step ${step}`);
    });
  }

  test("demo data dialog has no serious axe violations", async ({ page }) => {
    await page.goto("/admin");
    await page.getByRole("button", { name: "Reset demo data" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoSeriousViolations(page, "Demo data dialog");
  });

  test("bidding terms step has no serious axe violations and announces errors", async ({ page }) => {
    await page.goto(`/auctions/${LIVE}`);
    await page.getByRole("button", { name: /^(Bid|Place bid)/ }).filter({ visible: true }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Before your first bid" })).toBeVisible();
    await expect(dialog.getByRole("link", { name: /Read the full bidding terms/ })).toHaveAttribute("target", "_blank");
    await expectNoSeriousViolations(page, "Bidding terms step");
    await dialog.getByRole("button", { name: "Agree and continue" }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Tick both boxes to continue.");
    await expect(dialog.getByRole("checkbox", { name: "I am 18 or older" })).toHaveAttribute("aria-invalid", "true");
    await expectNoSeriousViolations(page, "Bidding terms step with error");
  });

  test("admin confirmation dialog has no serious axe violations", async ({ page }) => {
    await page.goto(`/admin/auctions/${LIVE}`);
    await page.getByRole("button", { name: "Withdraw auction" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expectNoSeriousViolations(page, "Withdraw dialog");
  });
});

test.describe("reflow at 320px", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  for (const [label, path] of PUBLIC_PAGES) {
    test(`${label} fits 320px`, async ({ page }) => {
      await page.goto(path);
      await noHorizontalScroll(page, label);
    });
  }

  test.describe("signed in", () => {
    test.beforeEach(async ({ context }) => signIn(context));
    for (const [label, path] of SIGNED_IN_PAGES) {
      test(`${label} fits 320px`, async ({ page }) => {
        await page.goto(path);
        await noHorizontalScroll(page, label);
      });
    }
  });
});

test.describe("keyboard", () => {
  test("skip link is the first tab stop and moves focus to the content", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("#content")).toBeFocused();
  });

  test("bid dialog returns focus to the button that opened it", async ({ page }) => {
    await page.goto(`/auctions/${LIVE}`);
    const trigger = page.getByRole("button", { name: /^(Bid|Place bid)/ }).filter({ visible: true }).first();
    await trigger.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

test.describe("notifications", () => {
  test.beforeEach(async ({ context }) => signIn(context));

  test("bell names the unread count, opens a panel with focus inside, and Escape returns focus", async ({ page }) => {
    await page.goto("/");
    // The mock has 2 unread notifications for the signed-in user.
    const bell = page.getByRole("button", { name: "Notifications, 2 unread" }).filter({ visible: true });
    await expect(bell).toHaveCount(1);
    await expect(bell).toContainText("2"); // the number is visible, not just a red dot
    await bell.click();
    const panel = page.getByRole("dialog", { name: "Notifications" });
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Notifications" })).toBeFocused();
    await expect(panel.getByText("New").first()).toBeVisible();
    await expectNoSeriousViolations(page, "Notifications panel", '[role="dialog"]:not([hidden])');
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
    await expect(bell).toBeFocused();
  });

  test("a comment link focuses that comment", async ({ page }) => {
    await page.goto(`/auctions/${LIVE}#comment-20000000-0000-4000-8000-000000000002`);
    await expect(page.locator("#comment-20000000-0000-4000-8000-000000000002")).toBeFocused();
  });
});

test.describe("watch and share", () => {
  test("Open Graph tags are absolute and the share image renders", async ({ page, request }) => {
    await page.goto(`/auctions/${LIVE}`);
    const og = await page.locator('meta[property="og:image"]').first().getAttribute("content");
    expect(og).toMatch(/^https?:\/\/.+\/auctions\/.+\/opengraph-image/);
    await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute("content", "summary_large_image");
    const res = await request.get(`/auctions/${LIVE}/opengraph-image`);
    expect(res.status()).toBe(200);
    expect(res.headers()["content-type"]).toContain("image/png");
  });

  test("share menu opens, links are safe, Escape returns focus", async ({ page }) => {
    await page.goto(`/auctions/${LIVE}`);
    await page.evaluate(() => {
      // Force the fallback menu even if the test browser has a native share sheet.
      Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
    });
    const share = page.getByRole("button", { name: "Share" });
    await share.click();
    await expect(page.getByRole("button", { name: "Copy link" })).toBeFocused();
    await expect(page.getByRole("link", { name: /^WhatsApp/ })).toHaveAttribute("rel", "noopener noreferrer");
    await expectNoSeriousViolations(page, "Share menu", "[aria-controls] + div:not([hidden])");
    await page.keyboard.press("Escape");
    await expect(share).toBeFocused();
  });

  test.describe("signed in", () => {
    test.beforeEach(async ({ context }) => signIn(context));

    test("watch button toggles aria-pressed", async ({ page }) => {
      await page.goto(`/auctions/${RESTORED}`); // not on the test user's watchlist
      const watch = page.getByRole("button", { name: "Watch", exact: true }).first();
      await expect(watch).toHaveAttribute("aria-pressed", "false");
      await watch.click();
      await expect(page.getByRole("button", { name: "Watching", exact: true }).first()).toHaveAttribute("aria-pressed", "true");
    });

    test("on a card, Tab goes from the card link to its watch button (no button inside the link)", async ({ page }) => {
      await page.goto("/?status=upcoming");
      const link = page.getByRole("link", { name: "2021 Porsche 911 Carrera S" });
      await link.focus();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: /^(Watch|Stop watching) 2021 Porsche 911 Carrera S$/ })).toBeFocused();
      expect(await page.locator("a button, a a").count()).toBe(0);
    });

    test("account menu opens with focus inside and closes with Escape", async ({ page, isMobile }) => {
      test.skip(isMobile, "Phones use the full-width Menu sheet, tested separately.");
      await page.goto("/");
      const button = page.getByRole("button", { name: /account menu/ });
      await button.click();
      await expect(button).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByRole("link", { name: "Profile" })).toBeFocused();
      await expect(page.getByRole("link", { name: "Watchlist" })).toBeVisible();
      await expect(page.getByRole("link", { name: "My listings" })).toHaveAttribute("href", "/account/listings");
      await expectNoSeriousViolations(page, "Account menu", "[aria-controls] + div:not([hidden])");
      await page.keyboard.press("Escape");
      await expect(button).toBeFocused();
    });
  });
});

test.describe("phone auction cards", () => {
  for (const width of [320, 360, 390]) {
    test(`two cards per row fit at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await page.goto("/");
      const cards = page.locator("ul > li > article.auction-card");
      await expect(cards.first()).toBeVisible();
      const problems = await page.evaluate(() => {
        const out: string[] = [];
        const articles = Array.from(document.querySelectorAll<HTMLElement>("ul > li > article.auction-card"));
        const tops = new Map<number, number>();
        for (const card of articles) {
          const box = card.getBoundingClientRect();
          tops.set(Math.round(box.top), (tops.get(Math.round(box.top)) ?? 0) + 1);
          for (const el of Array.from(card.querySelectorAll<HTMLElement>("*"))) {
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) continue;
            const style = getComputedStyle(el);
            if (style.position === "absolute" && style.clip !== "auto") continue; // visually hidden text
            if (r.right > box.right + 0.5 || r.left < box.left - 0.5) {
              out.push(`overflow: <${el.tagName.toLowerCase()}> "${(el.textContent ?? "").trim().slice(0, 30)}" in "${card.querySelector("h3")?.textContent?.slice(0, 20)}"`);
            }
            const ownText = Array.from(el.childNodes).some((n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim());
            if (ownText && parseFloat(style.fontSize) < 11) out.push(`text under 11px: "${el.textContent?.trim().slice(0, 30)}" (${style.fontSize})`);
          }
          const watch = card.querySelector<HTMLElement>("button[aria-label^='Watch'], button[aria-label^='Stop watching']");
          const w = watch?.getBoundingClientRect();
          if (!w || w.width < 44 || w.height < 44) out.push(`watch tap area ${w ? `${w.width}x${w.height}` : "missing"}`);
        }
        if (![...tops.values()].some((n) => n === 2)) out.push("no row with two cards");
        return out;
      });
      expect(problems).toEqual([]);
      await noHorizontalScroll(page, `Home at ${width}px`);
    });
  }

  test("the footer follows the card's own width (container query at 180px)", async ({ page }) => {
    const footDirection = async () =>
      page.locator("article.auction-card .ac-foot").first().evaluate((el) => getComputedStyle(el).flexDirection);
    await page.setViewportSize({ width: 320, height: 800 }); // cards ~146px: time chip under the price
    await page.goto("/");
    expect(await footDirection()).toBe("column");
    await page.setViewportSize({ width: 430, height: 800 }); // cards ~187px: side by side
    expect(await footDirection()).toBe("row");
  });

  test("restored badge collapses to its icon on narrow cards and keeps its name", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/");
    const card = page.locator("article.auction-card", { hasText: "Black Series" });
    await expect(card.getByText("Accident repaired")).toHaveCSS("position", "absolute");
    await expect(card.getByRole("button", { name: /^(Watch|Stop watching) 2021 Mercedes-AMG GT Black Series/ })).toBeVisible();
  });
});

test.describe("newly listed", () => {
  test("tabs are in order, Newly listed shows its count and announces it", async ({ page }) => {
    await page.goto("/");
    const tabs = page.getByRole("navigation", { name: "Auction status" }).getByRole("link");
    await expect(tabs).toHaveText(["Live", "Newly listed", "Ending in 24h", "Coming up", "Past results"]);
    await page.getByRole("link", { name: "Newly listed" }).click();
    await expect(page).toHaveURL(/\?status=newest/);
    await expect(page.getByRole("link", { name: "Newly listed" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { name: /^Newly listed \(\d+\)$/ })).toBeVisible();
    await expect(page.getByText("Ending next")).toHaveCount(0); // no featured block on this tab
    await expect(page.getByRole("status").filter({ hasText: /^Newly listed: \d+ auctions?\.$/ })).toHaveCount(1);
    const fresh = page.locator("article.auction-card", { hasText: "Black Series" });
    await expect(fresh.getByText("New", { exact: true })).toBeVisible();
    await expectNoSeriousViolations(page, "Newly listed tab");
  });

  test("an unknown status falls back to Live", async ({ page }) => {
    await page.goto("/?status=bogus");
    await expect(page.getByRole("link", { name: "Live", exact: true })).toHaveAttribute("aria-current", "page");
  });

  test("cars that went live days ago have no New badge", async ({ page }) => {
    await page.goto("/?status=newest");
    const older = page.locator("article.auction-card", { hasText: "Audi RS 4" });
    await expect(older).toBeVisible();
    await expect(older.getByText("New", { exact: true })).toHaveCount(0);
  });

  test("on a narrow phone the active tab is scrolled into view", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/?status=past");
    const nav = page.getByRole("navigation", { name: "Auction status" });
    const active = nav.getByRole("link", { name: "Past results" });
    await expect(async () => {
      const n = await nav.boundingBox();
      const t = await active.boundingBox();
      expect(n && t && t.x >= n.x - 1 && t.x + t.width <= n.x + n.width + 1).toBeTruthy();
    }).toPass();
  });
});

test.describe("contextual help", () => {
  test("home page has no how-it-works strip", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "How buying works" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "How it works", exact: true }).first()).toBeAttached(); // menu link stays
  });

  test("info tip opens by keyboard, focus moves in, Escape returns focus", async ({ page }) => {
    await page.goto(`/auctions/${LIVE}`);
    const tip = page.getByRole("button", { name: "What does Dealer inspected mean?" });
    await tip.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "What does Dealer inspected mean?" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toBeFocused();
    await expect(dialog).toContainText("An authorised dealer of the car's brand inspected it before the auction");
    await expect(dialog.getByRole("link", { name: /Learn more/ })).toHaveAttribute("href", "/how-it-works#badges");
    await expect(tip).toHaveAttribute("aria-expanded", "true");
    await expectNoSeriousViolations(page, "Info tip", '[role="dialog"]');
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(tip).toBeFocused();
  });

  test("bid box has the reserve, premium, hold and countdown tips", async ({ page, isMobile }) => {
    test.skip(isMobile, "The bid box is shown from 1024px; phones use the sticky bar.");
    await page.goto(`/auctions/${LIVE}`);
    const box = page.locator("section[aria-labelledby=bid-heading]");
    for (const name of ["What is a reserve?", "What is the buyer's premium?", "What is the card hold?", "Why can the end time change?"]) {
      await expect(box.getByRole("button", { name })).toBeVisible();
    }
  });

  test("on phones the tip is a full-width bottom sheet and a tap outside closes it", async ({ page, isMobile }) => {
    test.skip(!isMobile, "Phone layout only.");
    await page.goto(`/auctions/${LIVE}`);
    const tip = page.locator("[data-sticky-bottom] button[aria-label='Why can the end time change?']");
    await tip.click();
    const dialog = page.getByRole("dialog", { name: "Why can the end time change?" });
    const box = await dialog.boundingBox();
    const viewport = page.viewportSize();
    expect(box && viewport && Math.round(box.width) >= viewport.width - 1 && Math.round(box.y + box.height) >= viewport.height - 1).toBeTruthy();
    await page.mouse.click(10, 200);
    await expect(dialog).toHaveCount(0);
  });
});

test.describe("listing details", () => {
  test("long lists show 8 items until Show all is pressed", async ({ page }) => {
    await page.goto(`/auctions/${LIVE}`);
    const equipment = page.getByRole("region", { name: "Equipment" }).or(page.locator("section[aria-labelledby=equipment-heading]"));
    await expect(equipment.getByRole("listitem")).toHaveCount(8);
    const toggle = equipment.getByRole("button", { name: "Show all 10 items" });
    await toggle.click();
    await expect(equipment.getByRole("listitem")).toHaveCount(10);
    await expect(equipment.getByRole("button", { name: "Show fewer" })).toHaveAttribute("aria-expanded", "true");
  });

  test("service history is a table with column headers", async ({ page }) => {
    await page.goto(`/auctions/${LIVE}`);
    const table = page.getByRole("table", { name: "Service history" });
    await expect(table.getByRole("columnheader", { name: "Month" })).toBeVisible();
    await expect(table.getByRole("row")).toHaveCount(4); // header + 3 rows
  });

  test.describe("signed in", () => {
    test.beforeEach(async ({ context }) => signIn(context));
    test("list editor adds and removes rows by keyboard, keeping focus in the list", async ({ page }) => {
      await page.addInitScript(
        ([key, value]) => window.localStorage.setItem(key, value),
        [`biddr:sell:v1:${ME}`, sellDraft(3)] as const,
      );
      await page.goto("/sell");
      const add = page.getByRole("button", { name: "Add highlight" });
      await add.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByLabel("Highlight 4", { exact: true })).toBeFocused();
      await page.keyboard.type("Never tracked");
      await page.getByRole("button", { name: "Remove highlight 4" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByLabel("Highlight 3", { exact: true })).toBeFocused();
      await expect(page.getByLabel("Highlight 4", { exact: true })).toHaveCount(0);
    });
  });
});

test.describe("keyboard on a phone", () => {
  test.use({ viewport: { width: 390, height: 700 } });

  test("menu opens by keyboard and Escape returns focus", async ({ page }) => {
    await page.goto("/");
    const menu = page.getByRole("button", { name: "Menu" });
    await menu.focus();
    await page.keyboard.press("Enter");
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("link", { name: "How it works" }).first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await expect(menu).toBeFocused();
  });

  /** Tabs through the page and fails if any focused element is hidden by the sticky header or bottom bar. */
  async function expectFocusNeverObscured(page: Page, label: string, maxTabs = 120) {
    for (let i = 0; i < maxTabs; i++) {
      await page.keyboard.press("Tab");
      const problem = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el || el === document.body) return "end";
        const header = document.querySelector("header");
        const bar = document.querySelector<HTMLElement>("[data-sticky-bottom]");
        if (header?.contains(el) || bar?.contains(el)) return null;
        if (getComputedStyle(el).position === "fixed") return null; // e.g. the skip link, shown on top of everything
        // Third-party embeds (YouTube/Vimeo) scroll into view by focusing their own first control, which can't
        // load in the offline test browser; see ACCESSIBILITY.md.
        if (el.tagName === "IFRAME") return null;
        if (el.closest("footer")) return "end"; // reached the footer: page done
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return null; // visually hidden helpers
        const stickyTop = document.querySelector<HTMLElement>("[data-sticky-top]");
        if (stickyTop?.contains(el)) return null;
        const top = Math.max(header ? header.getBoundingClientRect().bottom : 0, stickyTop ? stickyTop.getBoundingClientRect().bottom : 0);
        const barVisible = bar && getComputedStyle(bar).position === "fixed";
        const bottom = barVisible ? bar.getBoundingClientRect().top : window.innerHeight;
        // WCAG 2.4.11 (AA): never entirely hidden. We hold ordinary controls (up to 100px tall)
        // to the stricter rule of being fully visible; large ones like a video only need to show.
        const entirelyHidden = r.bottom <= top || r.top >= bottom;
        const partlyHidden = r.top < top - 1 || r.bottom > bottom + 1;
        if (entirelyHidden || (partlyHidden && r.height <= 100)) {
          return `${el.tagName} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 40)}" at ${Math.round(r.top)}-${Math.round(r.bottom)}, visible area ${Math.round(top)}-${Math.round(bottom)}`;
        }
        return null;
      });
      if (problem === "end") return;
      expect(problem, `${label}: focused element is covered`).toBeNull();
    }
  }

  test("focus is never hidden behind the header or bid bar on the auction page", async ({ page }) => {
    await page.goto(`/auctions/${LIVE}`);
    await expectFocusNeverObscured(page, "Auction page");
  });

  test.describe("signed in", () => {
    test.beforeEach(async ({ context }) => signIn(context));
    test("focus is never hidden behind the header or the sell bar", async ({ page }) => {
      await page.addInitScript(
        ([key, value]) => window.localStorage.setItem(key, value),
        [`biddr:sell:v1:${ME}`, sellDraft(1)] as const,
      );
      await page.goto("/sell");
      await expectFocusNeverObscured(page, "Sell form");
    });

    test("focus is never hidden behind the header or the preview banner in the sell preview", async ({ page }) => {
      await page.addInitScript(
        ([key, value]) => window.localStorage.setItem(key, value),
        [`biddr:sell:v1:${ME}`, sellDraft(6)] as const,
      );
      await page.goto("/sell?preview=1");
      await expect(page.getByRole("heading", { level: 1, name: "2023 BMW M3 Touring" })).toBeVisible();
      await expectFocusNeverObscured(page, "Sell preview");
    });
  });
});

test.describe("listing preview", () => {
  test("signed out, a draft or rejected listing is not found", async ({ page }) => {
    for (const id of [MY_DRAFT, MY_REJECTED]) {
      const res = await page.goto(`/auctions/${id}`);
      expect(res?.status()).toBe(404);
      await expect(page.getByRole("heading", { name: "This auction isn't listed" })).toBeVisible();
    }
  });

  test.describe("signed in", () => {
    test.beforeEach(async ({ context }) => signIn(context));

    /** Visible copy of a text that the bid box (desktop) and the bid bar (phones) both carry. */
    const visibleText = (page: Page, text: string) => page.getByText(text, { exact: true }).locator("visible=true");

    test("My listings links drafts and rejected listings to their preview", async ({ page }) => {
      await page.goto("/account/listings");
      await expect(page.getByRole("link", { name: "Preview 2020 BMW M2 Competition" })).toHaveAttribute("href", `/auctions/${MY_DRAFT}`);
      await expect(page.getByRole("link", { name: "Preview 2016 Audi RS 3 Sportback" })).toHaveAttribute("href", `/auctions/${MY_REJECTED}`);
    });

    test("a draft shows the preview banner, disabled bidding and questions, and is not indexed", async ({ page }) => {
      await page.goto(`/auctions/${MY_DRAFT}`);
      const banner = page.getByRole("region", { name: "Preview: only you can see this." });
      await expect(banner).toContainText("Waiting for review.");
      await expect(banner.getByRole("link", { name: "Open in admin" })).toHaveAttribute("href", `/admin/auctions/${MY_DRAFT}`);
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
      await expect(page.getByRole("heading", { level: 1, name: "2020 BMW M2 Competition" })).toBeVisible();

      await expect(visibleText(page, "Bidding opens after review.")).toHaveCount(1);
      const bid = page.getByRole("button", { name: "Place bid" }).locator("visible=true");
      await expect(bid).toBeDisabled();
      await expect(bid).toHaveAccessibleDescription("Bidding opens after review.");
      await expect(page.getByText("Questions open when the auction starts.")).toBeVisible();
      await expect(page.getByLabel("Ask the seller a question")).toHaveCount(0);
      await expect(page.getByText("Your dealer inspection report will show here once Biddr has checked it.")).toBeVisible();
      await expect(page.getByRole("button", { name: /^Watch/ })).toHaveCount(0);
      await expectNoSeriousViolations(page, "Draft preview");
    });

    test("a rejected listing says why", async ({ page }) => {
      await page.goto(`/auctions/${MY_REJECTED}`);
      const banner = page.getByRole("region", { name: "Preview: only you can see this." });
      await expect(banner).toContainText("Not accepted: The photos don't show the underside. Add them and submit again.");
      await expect(banner.getByRole("link", { name: "My listings" })).toBeVisible();
      await expectNoSeriousViolations(page, "Rejected preview");
    });

    test("the sell form previews the listing and Back to edit keeps everything", async ({ page }) => {
      await page.addInitScript(
        ([key, value]) => { if (!window.sessionStorage.getItem("seeded")) { window.localStorage.setItem(key, value); window.sessionStorage.setItem("seeded", "1"); } },
        [`biddr:sell:v1:${ME}`, sellDraft(6)] as const,
      );
      await page.goto("/sell");
      await page.getByRole("button", { name: "Preview listing" }).click();
      await expect(page).toHaveURL(/\/sell\?preview=1$/);

      const banner = page.getByRole("region", { name: "Preview: this is how buyers will see your listing." });
      await expect(banner.getByRole("heading")).toBeFocused();
      await expect(page.getByRole("heading", { level: 1, name: "2023 BMW M3 Touring" })).toBeVisible();
      await expect(visibleText(page, "Bidding opens after review.")).toHaveCount(1);
      await expect(page.getByText("Questions open when the auction starts.")).toBeVisible();
      await expect(page.getByText("Your dealer inspection report will show here once Biddr has checked it.")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Sell your car" })).toHaveCount(0);
      await expectNoSeriousViolations(page, "Sell preview");

      await banner.getByRole("button", { name: "Back to edit" }).click();
      await expect(page).toHaveURL(/\/sell$/);
      await expect(page.getByRole("button", { name: "Preview listing" })).toBeFocused();
      await expect(page.getByText("WBS8M9C50G5K12345")).toBeVisible();

      // The browser's Back button closes the preview too.
      await page.getByRole("button", { name: "Preview listing" }).click();
      await expect(page).toHaveURL(/preview=1/);
      await page.goBack();
      await expect(page.getByRole("button", { name: "Preview listing" })).toBeVisible();
    });

    test("Submit for review in the preview asks for the confirmation first", async ({ page }) => {
      await page.addInitScript(
        ([key, value]) => window.localStorage.setItem(key, value),
        [`biddr:sell:v1:${ME}`, sellDraft(6)] as const,
      );
      await page.goto("/sell?preview=1");
      await page.getByRole("button", { name: "Submit for review" }).click();
      await expect(page).toHaveURL(/\/sell$/);
      await expect(page.getByText("Tick the box to confirm before you submit.")).toBeVisible();
    });

    test("previews fit 320px", async ({ page }) => {
      await page.setViewportSize({ width: 320, height: 640 });
      await page.addInitScript(
        ([key, value]) => window.localStorage.setItem(key, value),
        [`biddr:sell:v1:${ME}`, sellDraft(6)] as const,
      );
      await page.goto("/sell?preview=1");
      await expect(page.getByRole("heading", { level: 1, name: "2023 BMW M3 Touring" })).toBeVisible();
      await noHorizontalScroll(page, "Sell preview at 320px");
      await page.goto(`/auctions/${MY_DRAFT}`);
      await noHorizontalScroll(page, "Draft preview at 320px");
    });
  });
});

test.describe("search", () => {
  const box = (page: Page) => page.getByRole("combobox", { name: "Search make, model or year" });

  test("the Make filter is gone and the search box is labelled", async ({ page }) => {
    await page.goto("/");
    await expect(box(page)).toBeVisible();
    await expect(page.getByLabel("Make", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("search")).toHaveCount(1);
  });

  test("suggestions work by keyboard and choosing one searches", async ({ page }) => {
    await page.goto("/");
    await box(page).click();
    await box(page).pressSequentially("merc");
    const list = page.getByRole("listbox", { name: "Suggestions" });
    await expect(list.getByRole("option").first()).toHaveText("Mercedes-AMG (2 listings)");
    await expect(box(page)).toHaveAttribute("aria-expanded", "true");
    await expectNoSeriousViolations(page, "Search suggestions", "[role=search]");

    await box(page).press("ArrowDown");
    await box(page).press("ArrowDown");
    const second = list.getByRole("option").nth(1);
    await expect(second).toHaveAttribute("aria-selected", "true");
    await expect(box(page)).toHaveAttribute("aria-activedescendant", (await second.getAttribute("id")) ?? "");
    const label = (await second.locator("span").first().textContent()) ?? "";
    await box(page).press("Enter");

    await expect(box(page)).toHaveValue(label);
    await expect(box(page)).toHaveAttribute("aria-expanded", "false");
    await expect(box(page)).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(label).replace(/%20/g, "\\+")}`));
  });

  test("Escape closes the suggestions, then clears the text", async ({ page }) => {
    await page.goto("/");
    await box(page).click();
    await box(page).pressSequentially("audi");
    await expect(box(page)).toHaveAttribute("aria-expanded", "true");
    await box(page).press("Escape");
    await expect(box(page)).toHaveAttribute("aria-expanded", "false");
    await expect(box(page)).toHaveValue("audi");
    await box(page).press("Escape");
    await expect(box(page)).toHaveValue("");
  });

  test("typing searches after a pause; results get a heading, no featured car, and an announcement", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Ending next")).toBeVisible();
    await box(page).click();
    await box(page).pressSequentially("bmw");
    await expect(page).toHaveURL(/q=bmw/);
    await expect(page.getByRole("heading", { name: "Results for “bmw” (1)" })).toBeVisible();
    await expect(page.getByText("Ending next")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Live: 1 result for “bmw”." })).toHaveCount(1);
    await expect(page.locator("article.auction-card")).toHaveCount(1);

    // Leaving the field closes the suggestions. Filters and tabs keep the search.
    await box(page).press("Tab");
    await expect(box(page)).toHaveAttribute("aria-expanded", "false");
    await page.getByLabel("History").selectOption("clean");
    await expect(page).toHaveURL(/condition=clean/);
    await expect(page).toHaveURL(/q=bmw/);
    await page.getByRole("link", { name: "Past results" }).click();
    await expect(page).toHaveURL(/status=past/);
    await expect(page).toHaveURL(/q=bmw/);
    await expect(box(page)).toHaveValue("bmw");
  });

  test("no live results offers past results and clearing the search", async ({ page }) => {
    await page.goto("/?q=c63");
    await expect(page.getByText("No live results for “c63”.")).toBeVisible();
    await page.getByRole("link", { name: "See 1 past result for “c63”" }).click();
    await expect(page).toHaveURL(/status=past/);
    await expect(page.getByRole("heading", { name: "Results for “c63” (1)" })).toBeVisible();
    await expect(page.locator("article.auction-card", { hasText: "C 63 S" })).toBeVisible();

    await page.goto("/?q=Lotus");
    await expect(page.getByText("No live results for “Lotus”.")).toBeVisible();
    await expect(page.getByRole("link", { name: /past result/ })).toHaveCount(0);
    await page.getByRole("link", { name: "Clear the search" }).click();
    await expect(page).not.toHaveURL(/q=/);
    await expect(box(page)).toHaveValue("");
  });

  test("the clear button empties the search and keeps focus in the field", async ({ page }) => {
    await page.goto("/?q=bmw");
    const clear = page.getByRole("button", { name: "Clear search" });
    await clear.click();
    await expect(box(page)).toHaveValue("");
    await expect(box(page)).toBeFocused();
    await expect(page).not.toHaveURL(/q=/);
    await expect(clear).toHaveCount(0);
  });

  test("the search field is full width on a 320px phone", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await page.goto("/?q=audi");
    const field = await box(page).boundingBox();
    expect(field && field.width).toBeGreaterThan(320 - 2 * 16 - 2);
    await noHorizontalScroll(page, "search at 320px");
  });
});

test.describe("dealer inspections", () => {
  test("a restored car without a dealer inspection says so in words, with no badge", async ({ page }) => {
    await page.goto(`/auctions/${UPCOMING}`);
    const section = page.getByRole("region", { name: "Not inspected by a dealer" });
    await expect(section).toContainText(
      "This accident-repaired car hasn't been inspected by an authorised dealer. Ask the seller for repair documents and photos.",
    );
    await expect(section).toContainText("Rear-right quarter panel repaired");
    await expect(page.getByText("Dealer inspected", { exact: true })).toHaveCount(0);
    const specs = page.getByRole("region", { name: "Specifications" });
    await expect(specs.getByText("Not inspected", { exact: true })).toBeVisible();
    await expectNoSeriousViolations(page, "Restored, not inspected");
  });

  test("a dealer-inspected car shows the badge, the dealer card and the spec row", async ({ page }) => {
    await page.goto(`/auctions/${RESTORED}`);
    await expect(page.getByText("Dealer inspected", { exact: true }).first()).toBeVisible();
    const card = page.getByRole("region", { name: "Dealer inspected" });
    await expect(card).toContainText("Inspected by Demo Audi Centre, Riga (authorised Audi dealer)");
    await expect(card).toContainText("Report checked by Biddr.");
    await expect(card.getByRole("link", { name: "Download report (PDF)" })).toBeVisible();
    const specs = page.getByRole("region", { name: "Specifications" });
    await expect(specs.getByText("Dealer inspected", { exact: true })).toBeVisible();
    await expect(page.getByText(/Partner verified/)).toHaveCount(0);
    await expectNoSeriousViolations(page, "Dealer inspected");
  });

  test("the History filter offers any restored car and dealer-inspected restored cars", async ({ page }) => {
    await page.goto("/?status=upcoming");
    const history = page.getByLabel("History");
    await expect(history.locator("option")).toHaveText(["Any history", "Clean history", "Accident repaired", "Accident repaired, dealer inspected"]);
    await history.selectOption("restored_any");
    await expect(page).toHaveURL(/condition=restored_any/);
    await expect(page.locator("article.auction-card", { hasText: "Porsche 911" })).toBeVisible();
    await history.selectOption("restored");
    await expect(page).toHaveURL(/condition=restored(&|$)/);
    await expect(page.locator("article.auction-card", { hasText: "Porsche 911" })).toHaveCount(0);
  });

  test("the home page intro, meta description and link preview use the positioning line", async ({ page }) => {
    const intro = "Rare finds. Brought back to life. Ready for a new story.";
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Cars worth chasing" })).toBeVisible();
    await expect(page.getByText(intro, { exact: true })).toBeVisible();
    await expect(page.locator('meta[name="description"]')).toHaveAttribute("content", intro);
    await expect(page.locator('meta[property="og:description"]')).toHaveAttribute("content", intro);
    // No marketing promise about inspections in the intro (badges on inspected cars are fine).
    await expect(page.getByText(intro, { exact: true })).not.toContainText(/inspect/i);
  });

  test.describe("signed in", () => {
    test.beforeEach(async ({ context }) => signIn(context));

    test("the sell form asks for a dealer report with no default; Yes shows the dealer fields and upload", async ({ page }) => {
      await page.addInitScript(
        ([key, value]) => window.localStorage.setItem(key, value),
        [`biddr:sell:v1:${ME}`, sellDraft(5).replace('"dealerInspection":"yes"', '"dealerInspection":""')] as const,
      );
      await page.goto("/sell");
      const question = page.getByRole("group", { name: "Do you have a pre-sale inspection report from an authorised BMW dealer?" });
      await expect(question).toHaveAccessibleDescription(/We only accept inspections done by an official dealer/);
      const yes = question.getByRole("radio", { name: "Yes, I'll upload it" });
      const no = question.getByRole("radio", { name: "No, list without an inspection" });
      await expect(yes).not.toBeChecked();
      await expect(no).not.toBeChecked();
      await expect(page.getByLabel("Dealer's name")).toHaveCount(0);

      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText("Choose whether you have a dealer inspection report.")).toBeVisible();
      await expect(yes).toBeFocused();

      await no.check();
      await expect(page.getByText("Your listing will show that the car hasn't been inspected by a dealer.", { exact: false })).toBeVisible();

      await yes.check();
      await expect(page.getByLabel("Dealer's name")).toHaveValue("Demo BMW Centre");
      await expect(page.getByLabel("Dealer's country")).toHaveValue("FI");
      await expect(page.getByLabel("Inspection date")).toBeVisible();
      await expect(page.getByLabel("Mileage on the report")).toHaveValue("11900");
      await expect(page.getByRole("button", { name: "Add report files" })).toHaveAccessibleDescription(/Only Biddr's team sees this file/);
      await expect(page.getByRole("list", { name: "Report files" })).toContainText("bmw-report.pdf");
      await expectNoSeriousViolations(page, "Dealer report question");

      // An old report is refused.
      await page.getByLabel("Inspection date").fill("2020-01-01");
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText("The report must be from the last 90 days.")).toBeVisible();
      await expect(page.getByLabel("Inspection date")).toBeFocused();
    });

    test("without a report, the review step and the next steps say we'll review the listing", async ({ page }) => {
      await page.addInitScript(
        ([key, value]) => window.localStorage.setItem(key, value),
        [`biddr:sell:v1:${ME}`, sellDraft(6).replace('"dealerInspection":"yes"', '"dealerInspection":"no"')] as const,
      );
      await page.goto("/sell");
      await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
      await expect(page.getByText("No, list without an inspection")).toBeVisible();
      await expect(page.getByText("We'll review your listing.")).toBeVisible();
      await expect(page.getByText("Report files")).toHaveCount(0);
    });

    test("admins review the dealer report: details, warning, private files, checklist and reject reason", async ({ page }) => {
      await page.goto(`/admin/auctions/${MY_DRAFT}`);
      await expect(page.getByText("Dealer inspection:").first()).toBeVisible();
      const section = page.locator("#inspection");
      await expect(section).toContainText("Demo BMW Centre, Helsinki, Finland");
      await expect(section).toContainText("The report shows 36,100 km, more than the 35,500 km in the listing.");

      const file = section.getByRole("link", { name: /File 1 \(PDF\)/ });
      await expect(file).toHaveAttribute("href", `/api/admin/inspection-file?auction=${MY_DRAFT}&file=0`);
      const res = await page.request.get(`/api/admin/inspection-file?auction=${MY_DRAFT}&file=0`, { maxRedirects: 0 });
      expect(res.status()).toBe(302);
      expect(res.headers()["location"]).toContain("/object/sign/inspection-uploads/");

      await section.getByRole("button", { name: "Accept report" }).click();
      await expect(section.getByText("Confirm this before accepting the report.").first()).toBeVisible();
      await expect(section.getByRole("checkbox", { name: "VIN on the report matches the listing" })).toHaveAttribute("aria-invalid", "true");

      await section.getByRole("button", { name: "Reject report" }).click();
      await expect(section.getByLabel("Reason")).toHaveAttribute("aria-invalid", "true");
      await expectNoSeriousViolations(page, "Admin dealer report review", "#inspection");

      // Approving doesn't wait for the report.
      await expect(page.getByText(/can.t be approved until the inspection/)).toHaveCount(0);
    });

    test("signed out, the private report file link is not available", async ({ browser }) => {
      const context = await browser.newContext();
      const res = await context.request.get(`/api/admin/inspection-file?auction=${MY_DRAFT}&file=0`, { maxRedirects: 0 });
      expect(res.status()).toBe(404);
      await context.close();
    });
  });
});

test.describe("seller withdrawals", () => {
  const LIVE_MINE = "10000000-0000-4000-8000-000000000008";

  test.describe("signed in", () => {
    test.beforeEach(async ({ context }) => signIn(context));

    test("waiting for review: withdraw directly with an optional reason; rejected listings have no button", async ({ page }) => {
      await page.goto("/account/listings");
      const trigger = page.getByRole("button", { name: "Withdraw listing: 2020 BMW M2 Competition" });
      await expect(page.getByRole("button", { name: /2016 Audi RS 3 Sportback/ })).toHaveCount(0);

      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Withdraw this listing?" });
      await expect(dialog.getByLabel("Reason (optional)")).toBeVisible();
      await expectNoSeriousViolations(page, "Withdraw dialog", "[role=dialog]");
      await dialog.getByLabel("Reason (optional)").fill("Sold privately");
      await dialog.getByRole("button", { name: "Withdraw listing" }).click();
      const done = page.getByRole("status").filter({ hasText: "Listing withdrawn." });
      await expect(done).toBeVisible();
      await expect(done).toBeFocused();
    });

    test("live: only a request, with the note and a reason of at least 20 characters", async ({ page }) => {
      await page.goto("/account/listings");
      await page.getByRole("button", { name: "Request withdrawal: 2019 Alpine A110 Premiere" }).click();
      const dialog = page.getByRole("dialog", { name: "Request withdrawal?" });
      await expect(dialog).toContainText("live auctions can only be withdrawn by the Biddr team for a good reason");
      const reason = dialog.getByLabel("Why do you want to withdraw it?");
      await expect(reason).toHaveAccessibleDescription(/At least 20 characters/);

      await reason.fill("Changed my mind");
      await dialog.getByRole("button", { name: "Send request" }).click();
      await expect(dialog.getByRole("alert")).toHaveText("Explain why in at least 20 characters.");
      await expect(reason).toHaveAttribute("aria-invalid", "true");
      await expectNoSeriousViolations(page, "Request withdrawal dialog", "[role=dialog]");

      await reason.fill("The car was damaged in a hailstorm yesterday.");
      await dialog.getByRole("button", { name: "Send request" }).click();
      const done = page.getByRole("status").filter({ hasText: "Withdrawal requested." });
      await expect(done).toBeFocused();
      await expect(page.getByRole("link", { name: /2019 Alpine A110 Premiere/ })).toHaveAttribute("href", `/auctions/${LIVE_MINE}`);
    });

    test("admins see the count, can filter, and decide from the auction page", async ({ page }) => {
      await page.goto("/admin?tab=live");
      const filter = page.getByRole("navigation", { name: "Live auction filter" });
      await expect(filter.getByRole("link", { name: /Withdrawal requests\s*1/ })).toBeVisible();
      await filter.getByRole("link", { name: /Withdrawal requests/ }).click();
      await expect(page).toHaveURL(/requests=1/);
      await expect(page.getByText("Withdrawal requested")).toHaveCount(1);
      await expect(page.getByRole("link", { name: /BMW M3/ })).toBeVisible();
      await expect(page.getByRole("link", { name: /Alpine/ })).toHaveCount(0);

      await page.goto(`/admin/auctions/${LIVE}`);
      const panel = page.getByRole("region", { name: "The seller asked to withdraw this auction" });
      await expect(panel).toContainText("damaged in a hailstorm");
      await panel.getByRole("button", { name: "Approve and withdraw" }).click();
      const approve = page.getByRole("dialog", { name: "Approve the request and withdraw this auction?" });
      await expect(approve).toContainText(/bids? (is|are) cancelled/);
      await expectNoSeriousViolations(page, "Approve withdrawal dialog", "[role=dialog]");
      await approve.getByRole("button", { name: "Cancel" }).click();
      await expect(panel.getByRole("button", { name: "Approve and withdraw" })).toBeFocused();

      await panel.getByRole("button", { name: "Decline" }).click();
      const decline = page.getByRole("dialog", { name: "Decline the withdrawal request?" });
      await expect(decline.getByLabel("Note to the seller (optional)")).toBeVisible();
      await page.keyboard.press("Escape");
      await expectNoSeriousViolations(page, "Admin withdrawal request");
    });
  });
});

test.describe("seller decides after a rejected inspection report", () => {
  const GT4 = "10000000-0000-4000-8000-000000000009";

  test.describe("signed in", () => {
    test.beforeEach(async ({ context }) => signIn(context));

    test("My listings shows the decision panel with the reason, the deadline and three choices", async ({ page }) => {
      await page.goto("/account/listings");
      await expect(page.getByText("Waiting for your decision", { exact: true }).first()).toBeVisible();
      const panel = page.getByRole("region", { name: "Waiting for your decision" });
      await expect(panel).toContainText("Your inspection report wasn't accepted: Not an authorised Porsche dealer");
      await expect(panel).toContainText(/Please choose by \d{1,2} \w+ \d{4}\./);
      await expect(panel.getByRole("button", { name: "Withdraw listing: 2019 Porsche 718 Cayman GT4" })).toBeVisible();
      await expectNoSeriousViolations(page, "Decision panel");

      // Upload a new report: the same fields as the sell form, validated.
      const upload = panel.getByRole("button", { name: "Upload a new report" });
      await expect(upload).toHaveAttribute("aria-expanded", "false");
      await upload.click();
      await expect(upload).toHaveAttribute("aria-expanded", "true");
      const form = panel.getByRole("form", { name: "New inspection report" });
      for (const label of ["Dealer's name", "Dealer's city", "Dealer's country", "Inspection date", "Mileage on the report"]) {
        await expect(form.getByLabel(label)).toBeVisible();
      }
      await expect(form.getByRole("button", { name: "Add report files" })).toHaveAccessibleDescription(/Only Biddr's team sees this file/);
      await form.getByRole("button", { name: "Send the new report" }).click();
      await expect(form.getByText("Enter the dealer's name.")).toBeVisible();
      await expect(form.getByLabel("Dealer's name")).toBeFocused();
      await expect(form.getByLabel("Dealer's name")).toHaveAttribute("aria-invalid", "true");
      await expectNoSeriousViolations(page, "New report form", "[aria-label='New inspection report']");
    });

    test("List without an inspection asks first, then shows the outcome with focus", async ({ page }) => {
      await page.goto("/account/listings");
      const panel = page.getByRole("region", { name: "Waiting for your decision" });
      await panel.getByRole("button", { name: "List without an inspection: 2019 Porsche 718 Cayman GT4" }).click();
      const dialog = page.getByRole("dialog", { name: "List without an inspection?" });
      await expect(dialog).toContainText(
        "Your listing will go live without a Dealer inspected badge. Buyers will see that the car hasn't been inspected by a dealer.",
      );
      await expectNoSeriousViolations(page, "List without inspection dialog", "[role=dialog]");
      await dialog.getByRole("button", { name: "List without an inspection" }).click();
      const done = page.getByRole("status").filter({ hasText: "reviewed without a dealer inspection" });
      await expect(done).toBeFocused();
    });

    test("the listing preview shows the same decision panel", async ({ page }) => {
      await page.goto(`/auctions/${GT4}`);
      await expect(page.getByRole("region", { name: "Preview: only you can see this." })).toContainText(
        "Waiting for your decision about the inspection report.",
      );
      await expect(page.getByRole("region", { name: "Waiting for your decision" })).toContainText("Not an authorised Porsche dealer");
    });

    test("admins can't approve while the seller decides, and see the deadline", async ({ page }) => {
      await page.goto(`/admin/auctions/${GT4}`);
      await expect(page.getByText("Waiting for the seller to choose: new report or list without an inspection.")).toBeVisible();
      await expect(page.getByText(/Deadline \w{3}, \d{1,2} \w{3} \d{4}, \d{2}:\d{2} \S+\./).first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Approve and schedule" })).toBeDisabled();
      const section = page.locator("#inspection");
      await expect(section).toContainText("Seller's decision: waiting for them to choose");
      await expect(section.getByRole("button", { name: "Accept report" })).toHaveCount(0);
      await expectNoSeriousViolations(page, "Admin waiting for seller");
    });
  });
});

test.describe("Dealer inspected and Accident repaired badges", () => {
  const GT = "10000000-0000-4000-8000-000000000007";

  test("no page uses the old badge names", async ({ page }) => {
    for (const path of ["/", `/auctions/${RESTORED}`, "/how-it-works"]) {
      await page.goto(path);
      await expect(page.getByText(/Professionally restored|Partner verified/)).toHaveCount(0);
    }
  });

  test("accident-repaired cars have the badge and an info tip", async ({ page }) => {
    await page.goto(`/auctions/${RESTORED}`);
    await expect(page.getByText("Accident repaired", { exact: true }).first()).toBeVisible();
    const tip = page.getByRole("button", { name: "What does Accident repaired mean?" }).first();
    await tip.click();
    await expect(page.getByRole("dialog", { name: "What does Accident repaired mean?" })).toContainText(
      "Biddr doesn't check the repair itself",
    );
  });

  test("a selling dealer's own inspection says so on the card and in the tip", async ({ page }) => {
    await page.goto(`/auctions/${GT}`);
    const card = page.getByRole("region", { name: "Dealer inspected" });
    await expect(card).toContainText("Inspected by the selling dealer, Demo Mercedes-Benz Centre, Helsinki");
    const tip = page.getByRole("button", { name: "What does Dealer inspected mean?" }).first();
    await tip.click();
    await expect(page.getByRole("dialog", { name: "What does Dealer inspected mean?" })).toContainText(
      "this isn't an independent check",
    );
    await expectNoSeriousViolations(page, "Selling dealer inspection");
  });

  test("the accident damage photo section is called Before repair", async ({ page }) => {
    await page.goto(`/auctions/${RESTORED}`);
    await expect(page.getByRole("tab", { name: /^Before repair/ })).toBeVisible();
    await expect(page.getByText(/Before restoration/i)).toHaveCount(0);
  });

  test("an independent dealer's inspection doesn't mention the seller", async ({ page }) => {
    await page.goto(`/auctions/${RESTORED}`);
    await expect(page.getByRole("region", { name: "Dealer inspected" })).not.toContainText("selling dealer");
  });

  test("how it works explains both badges with the agreed text", async ({ page }) => {
    await page.goto("/how-it-works");
    const section = page.getByRole("region", { name: "Dealer inspected and Accident repaired" });
    await expect(section).toContainText(
      "An authorised dealer of the car's brand inspected it before the auction. The seller arranged the inspection and sent us the report.",
    );
    await expect(section).toContainText('the specifications say "Not inspected".');
    await expect(section).toContainText("Biddr doesn't check the repair itself.");
  });

  test.describe("signed in", () => {
    test.beforeEach(async ({ context }) => signIn(context));

    test("admins can mark a dealer seller's own inspection", async ({ page }) => {
      await page.goto(`/admin/auctions/${MY_DRAFT}`);
      const box = page.locator("#inspection").getByRole("checkbox", { name: "Inspected by the selling dealer" });
      await expect(box).not.toBeChecked();
      await expect(box).toHaveAccessibleDescription(/same business as the seller/);
    });
  });
});

test.describe("consistency with DECISIONS.md", () => {
  test("the auction page has a seller card with public facts only", async ({ page }) => {
    await page.goto(`/auctions/${LIVE}`);
    const card = page.getByRole("region", { name: "Seller", exact: true });
    await expect(card).toContainText("baltic_m");
    await expect(card).toContainText("Estonia");
    await expect(card).toContainText("Member since");
    await expect(card).toContainText(/cars? listed, \d+ sold/);
    // Never the full name or phone number.
    await expect(page.getByText("Mari Maasikas")).toHaveCount(0);
    await expect(page.getByText("+37255555555")).toHaveCount(0);
    await expectNoSeriousViolations(page, "Seller card", "[aria-labelledby=seller-heading]");
  });

  test("the country filter lists only countries with listings", async ({ page }) => {
    await page.goto("/");
    const options = await page.getByLabel("Country").locator("option").allTextContents();
    expect(options[0]).toBe("All countries");
    expect(options.slice(1).sort()).toEqual(["Estonia", "Latvia", "Lithuania"]);
  });

  test("no seller fee, no Baltic time, and the legal pages are marked drafts", async ({ page }) => {
    await page.goto("/how-it-works");
    await expect(page.getByText(/seller fee|to be confirmed/i)).toHaveCount(0);
    await expect(page.getByText(/pay for the car directly to the seller/)).toBeVisible();
    for (const path of ["/terms", "/privacy", "/terms/bidding"]) {
      await page.goto(path);
      await expect(page.getByRole("note")).toContainText("Draft");
    }
    await page.goto("/");
    await expect(page).toHaveTitle(/^(?!.*Baltic).*$/);
  });

  test.describe("signed in", () => {
    test.beforeEach(async ({ context }) => signIn(context));

    test("profile offers all 27 EU countries", async ({ page }) => {
      await page.goto("/account/setup");
      const options = page.getByLabel("Country").locator("option:not([disabled])");
      await expect(options).toHaveCount(27);
      await expect(page.getByLabel("Country").locator("option", { hasText: "Germany" })).toHaveCount(1);
    });

    test("admin schedule inputs say which time zone they use", async ({ page }) => {
      await page.goto(`/admin/auctions/${MY_DRAFT}`);
      await expect(page.getByText(/^Start \(.+, your time zone\)$/)).toBeVisible();
      await expect(page.getByText(/Eastern European time|Baltic time/)).toHaveCount(0);
    });
  });
});

test("the featured box explains itself: Ending next, and what the countdown means", async ({ page }) => {
  await page.goto("/");
  const featured = page.locator("article", { hasText: "Ending next" }).first();
  await expect(featured).toContainText("Ending next: the next live auction to close");
  await expect(featured.getByText("Ends in", { exact: true })).toBeVisible();
  await expectNoSeriousViolations(page, "Featured box");
});
