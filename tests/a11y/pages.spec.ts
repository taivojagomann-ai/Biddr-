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

/** Runs axe and fails on serious or critical WCAG 2.2 A/AA violations. */
async function expectNoSeriousViolations(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
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
    v: 1,
    draftId: "3f1c2d4e-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    step,
    furthest: 5,
    values: {
      make: "BMW", makeOther: "", model: "M3", variant: "Touring", year: "2023", vin: "WBS8M9C50G5K12345",
      mileageKm: "12000", engine: "3.0 inline-6 twin-turbo, 510 hp", transmission: "8-speed automatic", drivetrain: "AWD",
      exteriorColor: "Frozen Deep Grey", city: "Tallinn", country: "EE", hadDamage: "yes",
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
  ["Not found", "/no-such-page"],
] as const;

const SIGNED_IN_PAGES = [
  ["Profile", "/account/setup"],
  ["My listings", "/account/listings"],
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

  for (const step of [2, 3, 4, 5]) {
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
