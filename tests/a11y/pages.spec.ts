import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// Must match tests/a11y/mock-supabase.mjs
const ACCESS_TOKEN = "a11y-test-access-token";
const ME = "00000000-0000-4000-8000-0000000000aa";
const LIVE = "10000000-0000-4000-8000-000000000001";
const RESTORED = "10000000-0000-4000-8000-000000000002";
const UPCOMING = "10000000-0000-4000-8000-000000000003";
const SOLD = "10000000-0000-4000-8000-000000000004";
const MY_DRAFT = "10000000-0000-4000-8000-000000000005";
const MOCK = "http://127.0.0.1:54329";

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
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  if (include) builder = builder.include(include);
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
      videoUrl: "", startingBid: "60000", reserve: "70000", inspectionCity: "Tallinn", inspectionDates: "", confirmed: false,
    },
    photos: { exterior: list("exterior", 6), interior: list("interior", 4), mechanical: list("mechanical", 2), before: list("before", 2) },
  });
}

const PUBLIC_PAGES = [
  ["Home", "/"],
  ["Home, past results", "/?status=past"],
  ["Home, filtered to no results", "/?make=Lotus"],
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
      await expect(page.getByRole("button", { name: /^Watch(ing)? 2021 Porsche 911 Carrera S$/ })).toBeFocused();
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
      await expectNoSeriousViolations(page, "Account menu", "[aria-controls] + div:not([hidden])");
      await page.keyboard.press("Escape");
      await expect(button).toBeFocused();
    });
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
        const top = header ? header.getBoundingClientRect().bottom : 0;
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
  });
});
