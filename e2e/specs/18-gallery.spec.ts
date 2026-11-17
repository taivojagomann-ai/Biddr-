// Area 18: the auction photo gallery (swipeable track, arrows, counter, thumbnails)
// and the large photo viewer (keys, buttons, swipe, pinch, zoom, close, back button).
import type { CDPSession, Page } from "@playwright/test";
import { test, expect, expectAccessible, expectNoHorizontalScroll } from "../support/fixtures";
import { createAuction, createUser } from "../support/factory";

// Factory photos: Exterior 3, Interior 1, Engine and underside 1, Before repair 2.
async function openAuction(page: Page) {
  const seller = await createUser({ role: "seller" });
  const a = await createAuction({ seller, condition: "restored_accident", damageSummary: "Door repaired.", beforePhotos: 2 });
  await page.goto(`/auctions/${a.id}`);
  const gallery = page.getByRole("region", { name: "Exterior photos" });
  await expect(gallery).toHaveAttribute("aria-roledescription", "carousel");
  return { a, gallery };
}

const counter = (page: Page) => page.locator("[data-gallery-counter]");
const viewer = (page: Page, title: string) => page.getByRole("dialog", { name: `Photos of ${title}` });
const scale = async (page: Page) => Number(await page.locator("[data-viewer-stage] img").getAttribute("data-scale"));

/** Real touch input through Chrome DevTools: the browser scrolls, snaps and fires pointer events. */
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
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

test.describe("gallery", () => {
  test("arrows, thumbnails and keys move between photos; counter and thumbnails stay in sync; tabs start at the first photo", async ({ page }) => {
    const { a, gallery } = await openAuction(page);
    await expect(counter(page)).toHaveText("1 / 3");
    await expect(gallery.getByRole("img", { name: `${a.title}, Exterior, photo 1 of 3` })).toBeAttached();
    const thumbs = page.locator("[data-gallery-thumbs]");

    await gallery.getByRole("button", { name: "Next photo" }).click();
    await expect(counter(page)).toHaveText("2 / 3");
    await expect(thumbs.getByRole("button", { name: "Show photo 2" })).toHaveAttribute("aria-current", "true");
    // The counter is announced once the move ends.
    await expect(gallery.locator('[aria-live="polite"]')).toHaveText("Photo 2 of 3");

    await thumbs.getByRole("button", { name: "Show photo 3" }).click();
    await expect(counter(page)).toHaveText("3 / 3");
    await expect(thumbs.getByRole("button", { name: "Show photo 3" })).toHaveAttribute("aria-current", "true");
    await expect(thumbs.getByRole("button", { name: "Show photo 2" })).not.toHaveAttribute("aria-current", "true");

    await gallery.focus();
    await page.keyboard.press("ArrowLeft");
    await expect(counter(page)).toHaveText("2 / 3");
    await gallery.getByRole("button", { name: "Previous photo" }).click();
    await expect(counter(page)).toHaveText("1 / 3");

    // Arrows: at least 44×44.
    for (const name of ["Previous photo", "Next photo"]) {
      const box = (await gallery.getByRole("button", { name }).boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }

    // Another tab, then back: Exterior starts at its first photo again.
    await gallery.getByRole("button", { name: "Next photo" }).click();
    await expect(counter(page)).toHaveText("2 / 3");
    await page.getByRole("tab", { name: /^Before repair/ }).click();
    await expect(page.getByRole("region", { name: "Before repair photos" })).toBeVisible();
    await expect(counter(page)).toHaveText("1 / 2");
    await page.getByRole("tab", { name: /^Exterior/ }).click();
    await expect(counter(page)).toHaveText("1 / 3");
    await expectAccessible(page, "Gallery");
  });
});

test.describe("large photo viewer: desktop", () => {
  test.skip(({ isMobile }) => isMobile, "mouse and keyboard");

  test("opens on click at that photo, moves through all sections with keys and arrows, zooms, and closes with Escape", async ({ page }) => {
    const { a, gallery } = await openAuction(page);
    await expect(gallery.getByRole("button", { name: "Click to enlarge" })).toBeVisible();
    await expect(gallery.locator("[data-slide]").first()).toHaveCSS("cursor", "zoom-in");

    await gallery.getByRole("button", { name: "Next photo" }).click();
    await expect(counter(page)).toHaveText("2 / 3");
    await gallery.locator('[data-slide="1"]').click();
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
    // Thumbnails along the bottom follow.
    await expect(dialog.getByRole("button", { name: "Show interior photo 1 of 1" })).toHaveAttribute("aria-current", "true");
    await dialog.getByRole("button", { name: "Show exterior photo 1 of 3" }).click();
    await expect(dialog.locator("header")).toContainText("Exterior 1 / 3");

    // Click zooms to real size and back; the wheel zooms too; buttons do the same.
    const stage = await centre(page, "[data-viewer-stage]");
    await page.mouse.click(stage.x, stage.y);
    await expect.poll(() => scale(page)).toBeGreaterThan(1);
    await expect(page.locator("[data-viewer-stage]")).toHaveCSS("cursor", "zoom-out");
    await page.mouse.move(stage.x + 50, stage.y + 20);
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
    await expect(gallery.locator('[data-slide="1"]')).toBeFocused();
  });

  test("Enter opens it from the gallery; Close and the back button close it without leaving the page", async ({ page }) => {
    const { a, gallery } = await openAuction(page);
    await page.evaluate(() => ((window as unknown as { __stay: boolean }).__stay = true));
    await gallery.focus();
    await page.keyboard.press("Enter");
    const dialog = viewer(page, a.title);
    await expect(dialog).toBeVisible();
    await expect(page).toHaveURL(/#photo-1$/);
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page).not.toHaveURL(/#photo-/);

    await gallery.getByRole("button", { name: "Click to enlarge" }).click();
    await expect(dialog).toBeVisible();
    await page.goBack();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`/auctions/${a.id}$`));
    await expect(page.getByRole("heading", { level: 1, name: a.title })).toBeVisible();
    // Same page, not a reload.
    expect(await page.evaluate(() => (window as unknown as { __stay?: boolean }).__stay)).toBe(true);
  });
});

test.describe("large photo viewer: phone", () => {
  test.skip(({ isMobile }) => !isMobile, "touch");

  test("swipe in the gallery; tap opens; swipe, pinch and double-tap; zoomed swipes pan; swipe down closes", async ({ page }) => {
    const { a, gallery } = await openAuction(page);
    const cdp = await page.context().newCDPSession(page);
    await gallery.scrollIntoViewIfNeeded();

    // Native horizontal swipe in the gallery.
    const track = await centre(page, "[data-gallery-track]");
    await touchPath(cdp, [[{ x: track.box.x + track.box.width * 0.85, y: track.y }, { x: track.box.x + track.box.width * 0.15, y: track.y }]]);
    await expect(counter(page)).toHaveText("2 / 3");
    await expect(page.locator("[data-gallery-thumbs]").getByRole("button", { name: "Show photo 2" })).toHaveAttribute("aria-current", "true");
    // Touch arrows stay at least 44×44.
    const arrow = (await gallery.getByRole("button", { name: "Next photo" }).boundingBox())!;
    expect(Math.min(arrow.width, arrow.height)).toBeGreaterThanOrEqual(44);

    // A tap opens the viewer at that photo.
    const slide = await centre(page, "[data-gallery-track]");
    await tapAt(cdp, slide.x, slide.y);
    const dialog = viewer(page, a.title);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("header")).toContainText("Exterior 2 / 3");
    const close = (await dialog.getByRole("button", { name: "Close" }).boundingBox())!;
    expect(close.width).toBeGreaterThanOrEqual(44);
    expect(close.height).toBeGreaterThanOrEqual(44);
    expect(close.x + close.width).toBeGreaterThan(page.viewportSize()!.width - 60);
    expect(close.y).toBeLessThan(60);

    // Swipe left: next photo.
    const st = await centre(page, "[data-viewer-stage]");
    const swipeLeft = [[{ x: st.x + 120, y: st.y }, { x: st.x - 120, y: st.y }]];
    await touchPath(cdp, swipeLeft);
    await expect(dialog.locator("header")).toContainText("Exterior 3 / 3");

    // Pinch out: zooms in. Swiping while zoomed pans and keeps the photo.
    await touchPath(cdp, [
      [{ x: st.x - 20, y: st.y }, { x: st.x - 140, y: st.y }],
      [{ x: st.x + 20, y: st.y }, { x: st.x + 140, y: st.y }],
    ]);
    await expect.poll(() => scale(page)).toBeGreaterThan(1.5);
    await touchPath(cdp, swipeLeft);
    await expect(dialog.locator("header")).toContainText("Exterior 3 / 3");
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
    await dialog.getByRole("button", { name: "Previous photo" }).click();
    await expect(dialog.locator("header")).toContainText("Exterior 2 / 3");
    await dialog.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(() => scale(page)).toBeGreaterThan(1);
    await dialog.getByRole("button", { name: "Zoom out" }).click();
    await expect.poll(() => scale(page)).toBe(1);

    // Swipe down (not zoomed): closes.
    await touchPath(cdp, [[{ x: st.x, y: st.y - 100 }, { x: st.x, y: st.y + 150 }]]);
    await expect(dialog).toHaveCount(0);
    await expect(page).not.toHaveURL(/#photo-/);
  });

  test("the back button closes the viewer and the close button works", async ({ page }) => {
    const { a, gallery } = await openAuction(page);
    const dialog = viewer(page, a.title);
    await gallery.locator('[data-slide="0"]').tap();
    await expect(dialog).toBeVisible();
    await page.goBack();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("heading", { level: 1, name: a.title })).toBeVisible();
    await gallery.locator('[data-slide="0"]').tap();
    await dialog.getByRole("button", { name: "Close" }).tap();
    await expect(dialog).toHaveCount(0);
  });

  for (const width of [390, 320]) {
    test(`nothing overflows at ${width} px, with or without the viewer`, async ({ page }) => {
      await page.setViewportSize({ width, height: 740 });
      const { a, gallery } = await openAuction(page);
      await expectNoHorizontalScroll(page, `Auction page at ${width}px`);
      await gallery.locator('[data-slide="0"]').tap();
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
