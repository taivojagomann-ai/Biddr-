import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import type { SeedState } from "../global-setup";
import { sessionCookies } from "./supabase";
import type { TestUser } from "./factory";

/**
 * Signs `user` in for this browser context (the same cookies a real sign-in sets).
 * A user with a `totpSecret` (the seeded admin) also passes two-step verification,
 * as admins must; pass `{ twoFactor: false }` to stop after the first step.
 */
export async function signIn(
  context: BrowserContext,
  user: Pick<TestUser, "email"> & { totpSecret?: string },
  { twoFactor = true }: { twoFactor?: boolean } = {},
): Promise<void> {
  await context.clearCookies();
  await context.addCookies(await sessionCookies(user.email, { totpSecret: twoFactor ? user.totpSecret : undefined }));
}

// Embedded YouTube/Vimeo players are third-party code we can't change (YouTube's
// player has its own axe findings). Our <iframe> must still have a title; checked below.
// The player loads from youtube-nocookie.com or player.vimeo.com.
const THIRD_PARTY_FRAMES = 'iframe[src*="youtube"], iframe[src*="vimeo"]';

/** axe (WCAG 2.2 AA): fails on serious or critical problems. */
export async function expectAccessible(page: Page, label: string, include?: string): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).exclude(THIRD_PARTY_FRAMES);
  if (include) builder = builder.include(include);
  for (const frame of await page.locator(THIRD_PARTY_FRAMES).all()) {
    expect((await frame.getAttribute("title"))?.trim(), `${label}: video frame needs a title`).toBeTruthy();
  }
  const { violations } = await builder.analyze();
  const bad = violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  expect(bad.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(", ")})`), label).toEqual([]);
}

/** No horizontal scrolling at the current viewport. */
export async function expectNoHorizontalScroll(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${label}: page scrolls sideways`).toBeLessThanOrEqual(1);
}

/**
 * Resolves once the page's Realtime channel whose name contains `channel` is
 * subscribed on the server (`count` channels, e.g. 2 for the header's two bells).
 * Call it BEFORE page.goto, then await it after.
 */
export function realtimeReady(page: Page, channel: string, { count = 1, timeout = 30_000 } = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Realtime channel "${channel}" didn't subscribe in ${timeout} ms`)), timeout);
    page.on("websocket", (ws) => {
      ws.on("framereceived", (frame) => {
        const text = String(frame.payload);
        if (text.includes("Subscribed to PostgreSQL") && text.includes(channel) && --count <= 0) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
  });
}

export const test = base.extend<{ seed: SeedState }>({
  // eslint-disable-next-line no-empty-pattern
  seed: async ({}, use) => {
    await use(JSON.parse(readFileSync("e2e/.state/seed.json", "utf8")) as SeedState);
  },
});

export { expect };
