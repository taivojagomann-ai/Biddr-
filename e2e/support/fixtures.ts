import { readFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { test as base, expect, type BrowserContext, type Page } from "@playwright/test";
import type { SeedState } from "../global-setup";
import { sessionCookies } from "./supabase";
import type { TestUser } from "./factory";

/** Signs `user` in for this browser context (the same cookies a real sign-in sets). */
export async function signIn(context: BrowserContext, user: Pick<TestUser, "email">): Promise<void> {
  await context.clearCookies();
  await context.addCookies(await sessionCookies(user.email));
}

/** axe (WCAG 2.2 AA): fails on serious or critical problems. */
export async function expectAccessible(page: Page, label: string, include?: string): Promise<void> {
  let builder = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]);
  if (include) builder = builder.include(include);
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
