// Area 18: the full-screen photo viewer that opens from the auction page's gallery
// (click or tap, keys and buttons, swipe, pinch and zoom, closing, the back button).
import type { CDPSession, Page } from "@playwright/test";
import { test, expect, expectAccessible, expectNoHorizontalScroll } from "../support/fixtures";
import { createAuction, createUser } from "../support/factory";

// Factory photos: Exterior 3, Interior 1, Engine and underside 1, Before repair 2.
async function openAuction(page: Page) {
  const seller = await createUser({ role: "seller" });
  const a = await createAuction({ seller, condition: "restored_accident", damageSummary: "Door repaired.", beforePhotos: 2 });
  await page.goto(`/auctions/${a.id}`);
  const photo = page.locator("[data-gallery-photo]").first();
  await expect(photo).toBeVisible();
  return { a, photo };
}

const viewer = (page: Page, title: string) => page.getByRole("dialog", { name: `Photos of ${title}` });
const scale = async (page: Page) => Number(await page.locator("[data-viewer-stage] img").getAttribute("data-scale"));

/** Real touch input through Chrome DevTools: the page gets genuine touch pointer events. */
async function touchPath(cdp: CDPSession, paths: { x: number; y: number }[][], steps = 12) {
  const at = (k: number) =>
    paths.map((p, id) => {
      const [a, b] = [p[0]!, p[p.length - 1]!];
      return { x: a.x + ((b.x - a.x) * k) / steps, y: a.y + ((b.y - a.y) * k) / steps, id };
    });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(0) });
  for (let k = 1; k <= steps; k++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(k) });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
async function tapAt(cdp: CDPSession, x: number, y: number) {
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y, id: 0 }] });
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
async function centre(page: Page, selector: string) {
  const box = (await page.locator(selector).first().boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe("photo viewer: desktop", () => {
  test.skip(({ isMobile }) => isMobile, "mouse and keyboard");

  test("opens on click at that photo, moves through all sections with keys and arrows, zooms, and closes with Escape", async ({ page }) => {
    const { a, photo } = await openAuction(page);
    const gallery = page.getByRole("tabpanel", { name: /^Exterior/ });
    await expect(gallery.getByRole("button", { name: "Click to enlarge photo 1 of 3" })).toBeVisible();
    await expect(photo.locator(".cursor-zoom-in")).toHaveCSS("cursor", "zoom-in");

    // The gallery itself is unchanged: arrows and thumbnails.
    await gallery.getByRole("button", { name: "Next photo" }).click();
    await expect(gallery.getByText("2 / 3")).toBeVisible();
    await photo.click();
    const dialog = viewer(page, a.title);
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/#photo-2$/);
    await expect(dialog.locator("header")).toContainText("Exterior 2 / 3");
    await expect(dialog.getByRole("img", { name: `${a.title}, Exterior, photo 2 of 3` })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();

    // Keys, then into the next sections in order.
    await page.keyboard.press("ArrowRight");
    await expect(dialog.locator("header")).toContainText("Exterior 3 / 3");
    await page.keyboard.press("ArrowRight");
    await expect(dialog.locator("header")).toContainText("Interior 1 / 1");
    await expect(page).toHaveURL(/#photo-4$/);
    await dialog.getByRole("button", { name: "Next photo" }).click();
    await expect(dialog.locator("header")).toContainText("Engine and underside 1 / 1");
    await dialog.getByRole("button", { name: "Next photo" }).click();
    await expect(dialog.locator("header")).toContainText("Before repair 1 / 2");
    await dialog.getByRole("button", { name: "Previous photo" }).click();
    await page.keyboard.press("ArrowLeft");
    await expect(dialog.locator("header")).toContainText("Interior 1 / 1");
    await expect(dialog.locator('[aria-live="polite"]')).toHaveText("Interior, photo 1 of 1");
    // Thumbnails along the bottom follow, and jump to a photo.
    await expect(dialog.getByRole("button", { name: "Show interior photo 1 of 1" })).toHaveAttribute("aria-current", "true");
    await dialog.getByRole("button", { name: "Show exterior photo 1 of 3" }).click();
    await expect(dialog.locator("header")).toContainText("Exterior 1 / 3");

    // Click zooms to real size and back; the wheel zooms too; buttons do the same.
    const stage = await centre(page, "[data-viewer-stage]");
    await page.mouse.click(stage.x, stage.y);
    await expect.poll(() => scale(page)).toBeGreaterThan(1);
    await expect(page.locator("[data-viewer-stage]")).toHaveCSS("cursor", "zoom-out");
    await page.mouse.click(stage.x + 50, stage.y + 20);
    await expect.poll(() => scale(page)).toBe(1);
    await page.mouse.move(stage.x, stage.y);
    await page.mouse.wheel(0, -400);
    await expect.poll(() => scale(page)).toBeGreaterThan(1);
    await page.mouse.wheel(0, 2000);
    await expect.poll(() => scale(page)).toBe(1);
    await dialog.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(() => scale(page)).toBeGreaterThan(1);
    await dialog.getByRole("button", { name: "Zoom out" }).click();
    await expect.poll(() => scale(page)).toBe(1);

    await expectAccessible(page, "Photo viewer");
    // Focus stays inside the viewer.
    for (let i = 0; i < 25; i++) await page.keyboard.press("Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[data-photo-viewer]")))).toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(page).not.toHaveURL(/#photo-/);
    // Focus is back on the photo that opened it.
    await expect(photo).toBeFocused();
  });

  test("the enlarge button opens it from the keyboard; Close and the back button close it without leaving the page", async ({ page }) => {
    const { a } = await openAuction(page);
    await page.evaluate(() => ((window as unknown as { __stay: boolean }).__stay = true));
    const enlarge = page.getByRole("button", { name: "Click to enlarge photo 1 of 3" });
    await enlarge.focus();
    await page.keyboard.press("Enter");
    const dialog = viewer(page, a.title);
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/#photo-1$/);
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).not.toHaveURL(/#photo-/);

    await enlarge.click();
    await expect(dialog).toBeVisible();
    await page.goBack();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/auctions/${a.id}$`));
    await expect(page.getByRole("heading", { level: 1, name: a.title })).toBeVisible();
    // Same page, not a reload.
    expect(await page.evaluate(() => (window as unknown as { __stay?: boolean }).__stay)).toBe(true);
    await expectAccessible(page, "Auction page with the enlarge button");
  });
});

test.describe("photo viewer: phone", () => {
  test.skip(({ isMobile }) => !isMobile, "touch");

  test("tap opens; swipe, pinch and double-tap; zoomed swipes pan; swipe down closes", async ({ page }) => {
    const { a, photo } = await openAuction(page);
    const cdp = await page.context().newCDPSession(page);
    await photo.scrollIntoViewIfNeeded();
    const p = await centre(page, "[data-gallery-photo]");
    await tapAt(cdp, p.x, p.y);
    const dialog = viewer(page, a.title);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("header")).toContainText("Exterior 1 / 3");
    const close = (await dialog.getByRole("button", { name: "Close" }).boundingBox())!;
    expect(close.width).toBeGreaterThanOrEqual(44);
    expect(close.height).toBeGreaterThanOrEqual(44);
    expect(close.x + close.width).toBeGreaterThan(page.viewportSize()!.width - 60);
    expect(close.y).toBeLessThan(60);
    await expect(page.locator("[data-viewer-stage] img")).toHaveAttribute("data-loaded", "");

    // Swipe left: next photo. It starts close to the Next button on purpose: a phone
    // steers a touch near a button onto it, and that must still count as a swipe.
    const st = await centre(page, "[data-viewer-stage]");
    const swipeLeft = [[{ x: st.x + 120, y: st.y }, { x: st.x - 120, y: st.y }]];
    await touchPath(cdp, swipeLeft);
    await expect(dialog.locator("header")).toContainText("Exterior 2 / 3");
    // A swipe that starts right on the Next button is a swipe too: one photo on, not two.
    const next = await centre(page, '[data-viewer-stage] button[aria-label="Next photo"]');
    await touchPath(cdp, [[next, { x: next.x - 240, y: next.y }]]);
    await expect(dialog.locator("header")).toContainText("Exterior 3 / 3");
    await page.waitForTimeout(300);
    await expect(dialog.locator("header")).toContainText("Exterior 3 / 3");
    await dialog.getByRole("button", { name: "Previous photo" }).tap();
    await expect(dialog.locator("header")).toContainText("Exterior 2 / 3");

    // Pinch out: zooms in. Swiping while zoomed pans and keeps the photo.
    await touchPath(cdp, [
      [{ x: st.x - 20, y: st.y }, { x: st.x - 140, y: st.y }],
      [{ x: st.x + 20, y: st.y }, { x: st.x + 140, y: st.y }],
    ]);
    await expect.poll(() => scale(page)).toBeGreaterThan(1.5);
    await touchPath(cdp, swipeLeft);
    await expect(dialog.locator("header")).toContainText("Exterior 2 / 3");
    await expect.poll(() => scale(page)).toBeGreaterThan(1.5);

    // Double-tap: back to fit; again: zoom in; again: fit.
    const doubleTap = async () => {
      await tapAt(cdp, st.x, st.y);
      await tapAt(cdp, st.x, st.y);
    };
    await doubleTap();
    await expect.poll(() => scale(page)).toBe(1);
    await page.waitForTimeout(400);
    await doubleTap();
    await expect.poll(() => scale(page)).toBeGreaterThan(1);
    await page.waitForTimeout(400);
    await doubleTap();
    await expect.poll(() => scale(page)).toBe(1);

    // The buttons do the same as the gestures.
    await dialog.getByRole("button", { name: "Next photo" }).tap();
    await expect(dialog.locator("header")).toContainText("Exterior 3 / 3");
    await dialog.getByRole("button", { name: "Previous photo" }).tap();
    await expect(dialog.locator("header")).toContainText("Exterior 2 / 3");
    await dialog.getByRole("button", { name: "Zoom in" }).tap();
    await expect.poll(() => scale(page)).toBeGreaterThan(1);
    await dialog.getByRole("button", { name: "Zoom out" }).tap();
    await expect.poll(() => scale(page)).toBe(1);

    // Swipe down (not zoomed): closes.
    await touchPath(cdp, [[{ x: st.x, y: st.y - 100 }, { x: st.x, y: st.y + 150 }]]);
    await expect(dialog).toHaveCount(0);
    await expect(page).not.toHaveURL(/#photo-/);
  });

  test("the back button closes the viewer and the close button works", async ({ page }) => {
    const { a, photo } = await openAuction(page);
    const dialog = viewer(page, a.title);
    await photo.tap();
    await expect(dialog).toBeVisible();
    await page.goBack();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: a.title })).toBeVisible();
    await page.getByRole("button", { name: "Enlarge photo 1 of 3" }).tap();
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).tap();
    await expect(dialog).toHaveCount(0);
  });

  for (const width of [390, 320]) {
    test(`nothing overflows at ${width} px, with or without the viewer`, async ({ page }) => {
      await page.setViewportSize({ width, height: 740 });
      const { a, photo } = await openAuction(page);
      await expectNoHorizontalScroll(page, `Auction page at ${width}px`);
      await photo.tap();
      const dialog = viewer(page, a.title);
      await expect(dialog).toBeVisible();
      for (const b of await dialog.getByRole("button").all()) {
        if (!(await b.isVisible())) continue;
        const box = (await b.boundingBox())!;
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width).toBeLessThanOrEqual(width + 0.5);
      }
      await expectNoHorizontalScroll(page, `Photo viewer at ${width}px`);
    });
  }
});
