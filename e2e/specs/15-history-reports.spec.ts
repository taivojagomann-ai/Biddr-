// Area 15: vehicle history reports from carVertical (DECISIONS.md point 11).
// The seller's upload, the admin checklist (accept and reject), the public badge
// and summary, the share link only when allowed, the seller's response to a
// rejection, and the no-report notice with Copy VIN.
import { test, expect, signIn, expectAccessible } from "../support/fixtures";
import { createAuction, createUser, getAuction, getPrivate, notificationsFor, randomVin, service, setPrivate, iso, DAY, type TestUser } from "../support/factory";
import { continueButton, fillCarStep, fillDetailsStep, fillHistoryReport, fillHistoryStep, fillPhotosStep, fillPriceStep } from "../support/sell";
import { userDb } from "../support/supabase";

const LINK = "https://www.carvertical.com/report/e2e-example";

/** A draft whose seller added a carVertical report (as the sell form saves it). */
async function draftWithReport(seller: TestUser, o: { share?: boolean; link?: string | null } = {}) {
  const a = await createAuction({ seller, status: "draft", startsAt: iso(2 * DAY), endsAt: iso(5 * DAY) });
  await setPrivate(a.id, {
    history_report_provided: true,
    history_report_paths: [`${seller.id}/${a.id}/00000000-0000-4000-8000-000000000001.pdf`],
    history_report_link: o.link === undefined ? LINK : o.link,
    history_report_share_allowed: o.share ?? false,
    history_review_status: "pending",
  });
  return a;
}

async function acceptInAdmin(page: import("@playwright/test").Page, auctionId: string, lines: string[]) {
  await page.goto(`/admin/auctions/${auctionId}`);
  const form = page.locator("form", { has: page.getByRole("heading", { name: "Accept the history report" }) });
  for (const label of [
    "VIN on the report matches the listing",
    "Report mileage is not higher than the listing mileage and the records look consistent",
    "Damage records match the seller's description (accident repaired or clean)",
  ]) {
    await form.getByLabel(label).check();
  }
  const inputs = form.getByRole("textbox", { name: /^Summary line \d/ });
  for (let i = 0; i < lines.length; i++) {
    if (i >= (await inputs.count())) await form.getByRole("button", { name: "Add summary line" }).click();
    await inputs.nth(i).fill(lines[i]!);
  }
  await form.getByRole("button", { name: "Accept history report" }).click();
  await expect.poll(async () => (await getPrivate<{ history_review_status: string }>(auctionId)).history_review_status).toBe("accepted");
}

test.describe("vehicle history reports", () => {
  test("sell form: the report is optional; with Yes, a file or a carVertical link is needed and the link must be carVertical's", async ({ page, context }) => {
    test.setTimeout(180_000);
    const seller = await createUser();
    await signIn(context, seller);
    await page.goto("/sell");
    const vin = randomVin();
    await fillCarStep(page, { vin });
    await continueButton(page).click();
    await fillHistoryStep(page);
    await continueButton(page).click();
    await fillDetailsStep(page);
    await continueButton(page).click();
    await fillPhotosStep(page);
    await continueButton(page).click();
    await fillPriceStep(page);

    const question = page.getByRole("group", { name: /Do you have a carVertical vehicle history report for this car\?/ });
    await expect(question).toBeVisible();
    await expect(page.getByText("Only Biddr's team sees the uploaded file. We check that it matches your car and your description.")).toBeVisible();
    await page.getByRole("radio", { name: "Yes, add it" }).check();
    const share = page.getByLabel("I'm allowed to share this report with buyers");
    await expect(share).not.toBeChecked();
    await expect(page.getByText("If you don't tick this, buyers will only see our summary, not the report itself.")).toBeVisible();
    await expectAccessible(page, "Sell, history report question");

    await continueButton(page).click();
    await expect(page.getByText("Upload the report or paste its carVertical link.")).toBeVisible();
    await page.getByLabel("carVertical share link").fill("http://www.carvertical.com/report/x");
    await continueButton(page).click();
    await expect(page.getByText(/Paste a carVertical link/)).toBeVisible();
    await page.getByLabel("carVertical share link").fill("https://carvertical.example.com/report/x");
    await continueButton(page).click();
    await expect(page.getByText(/Paste a carVertical link/)).toBeVisible();

    await page.getByLabel("carVertical share link").fill("");
    await fillHistoryReport(page, { file: true, link: LINK });
    await continueButton(page).click();
    await expect(page.getByRole("heading", { name: "Review" })).toBeVisible();
    await expect(page.getByText("Yes, carVertical report added")).toBeVisible();
    await expect(page.getByText("No, buyers see Biddr's summary only")).toBeVisible();
    await page.getByLabel("I confirm the information is accurate and I have the right to sell this car.").check();
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(page.getByRole("heading", { name: "Thanks, your car is submitted" })).toBeVisible({ timeout: 30_000 });

    const { data: auction } = await service().from("auctions").select("id, history_report_verified").eq("vin", vin).single();
    expect(auction!.history_report_verified).toBe(false);
    const priv = await getPrivate<{ history_report_provided: boolean; history_report_paths: string[]; history_report_link: string; history_report_share_allowed: boolean; history_review_status: string }>(auction!.id);
    expect(priv).toMatchObject({ history_report_provided: true, history_report_link: LINK, history_report_share_allowed: false, history_review_status: "pending" });
    expect(priv.history_report_paths).toHaveLength(1);
    expect(priv.history_report_paths[0]!.startsWith(`${seller.id}/`)).toBe(true);
  });

  test("admin accepts with the checklist and a summary; the public page shows the badge, tip and summary, but no link without permission", async ({ page, context, seed }) => {
    const seller = await createUser({ role: "seller" });
    const a = await draftWithReport(seller, { share: false });
    await signIn(context, seed.admin);
    await page.goto(`/admin/auctions/${a.id}`);
    const section = page.getByRole("region", { name: "History report" });
    await expect(section.getByRole("link", { name: /Open history report 1 \(PDF\)/ })).toHaveAttribute(
      "href",
      `/api/admin/inspection-file?auction=${a.id}&file=0&kind=history`,
    );
    await expect(section.getByRole("link", { name: /Open the carVertical link/ })).toHaveAttribute("href", LINK);
    await expect(section).toContainText("Not allowed: buyers see your summary only");

    // The checklist and 2+ lines are required.
    const form = page.locator("form", { has: page.getByRole("heading", { name: "Accept the history report" }) });
    await form.getByRole("button", { name: "Accept history report" }).click();
    await expect(form.locator('[id^="history-check-"][id$="-error"]').first()).toBeVisible();
    expect((await getPrivate<{ history_review_status: string }>(a.id)).history_review_status).toBe("pending");
    await expectAccessible(page, "Admin history report panel", "#history");

    await acceptInAdmin(page, a.id, ["Mileage records consistent", "No recorded damage", "2 previous owners"]);
    const pub = await getAuction<{ history_report_verified: boolean; history_summary: string[]; history_report_public_link: string | null }>(a.id);
    expect(pub).toMatchObject({ history_report_verified: true, history_report_public_link: null });
    expect(pub.history_summary).toEqual(["Mileage records consistent", "No recorded damage", "2 previous owners"]);
    const { data: log } = await service().from("admin_actions").select("action").eq("auction_id", a.id);
    expect((log ?? []).map((l) => l.action)).toContain("history_report.accept");

    // Public page (the seller's preview while it's a draft, then live).
    await service().from("auctions").update({ status: "live", starts_at: iso(-60_000) }).eq("id", a.id);
    await page.goto(`/auctions/${a.id}`);
    await expect(page.getByText("History report", { exact: true }).first()).toBeVisible();
    const tip = page.getByRole("button", { name: "What does History report mean?" });
    await tip.click();
    await expect(page.getByRole("dialog", { name: "What does History report mean?" })).toContainText(
      "The seller provided a carVertical vehicle history report. We checked that it matches this car and the seller's description.",
    );
    await page.keyboard.press("Escape");
    const history = page.getByRole("region", { name: "Vehicle history report" });
    await expect(history).toContainText("carVertical report provided by the seller and checked by Biddr.");
    await expect(history.getByRole("listitem")).toHaveText(["Mileage records consistent", "No recorded damage", "2 previous owners"]);
    await expect(history.getByRole("link", { name: /View the full report/ })).toHaveCount(0);
    await expect(page.locator(`a[href="${LINK}"]`)).toHaveCount(0);
    await expectAccessible(page, "Auction with history report");

    // Not on the home page cards.
    await page.goto(`/?q=${encodeURIComponent(a.title)}`);
    await expect(page.locator(`article.auction-card:has(a[href="/auctions/${a.id}"])`).getByText("History report")).toHaveCount(0);
  });

  test("with the seller's permission, accepting publishes the link: View the full report", async ({ page, context, seed }) => {
    const a = await draftWithReport(await createUser({ role: "seller" }), { share: true });
    await signIn(context, seed.admin);
    await acceptInAdmin(page, a.id, ["Mileage records consistent", "First registered in Germany"]);
    expect((await getAuction<{ history_report_public_link: string }>(a.id)).history_report_public_link).toBe(LINK);
    await service().from("auctions").update({ status: "live", starts_at: iso(-60_000) }).eq("id", a.id);
    await page.goto(`/auctions/${a.id}`);
    const link = page.getByRole("region", { name: "Vehicle history report" }).getByRole("link", { name: /View the full report/ });
    await expect(link).toHaveAttribute("href", LINK);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  test("admin rejects with a reason; the seller is told and can correct the description or upload another report", async ({ page, context, seed }) => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({ seller, status: "draft", condition: "restored_accident", damageSummary: "Small scratch on the rear bumper." });
    await setPrivate(a.id, { history_report_provided: true, history_report_link: LINK, history_review_status: "pending" });
    await signIn(context, seed.admin);
    await page.goto(`/admin/auctions/${a.id}`);
    const form = page.locator("form", { has: page.getByRole("heading", { name: "Reject the history report" }) });
    await form.getByRole("button", { name: "Reject history report" }).click();
    await expect(form.locator("#reject-history-reason-error")).toBeVisible();
    await form.getByLabel("Reason").fill("Report shows damage not mentioned in the listing");
    await form.getByRole("button", { name: "Reject history report" }).click();
    await expect.poll(async () => (await getPrivate<{ history_review_status: string }>(a.id)).history_review_status).toBe("rejected");
    await expect.poll(async () => (await notificationsFor(seller, "history_report_rejected")).length).toBe(1);
    expect((await getAuction<{ history_report_verified: boolean }>(a.id)).history_report_verified).toBe(false);

    // The seller corrects the description: the report goes back to review.
    await signIn(context, seller);
    await page.goto("/account/listings");
    const panel = page.getByRole("region", { name: "Vehicle history report not accepted" });
    await expect(panel).toContainText("Report shows damage not mentioned in the listing");
    await expectAccessible(page, "My listings, history report rejected");
    await panel.getByRole("button", { name: /^Correct the description/ }).click();
    const summary = panel.getByLabel("Damage and repair summary");
    await summary.fill("Too short");
    await panel.getByRole("button", { name: "Save and send for review" }).click();
    await expect(panel.getByText(/at least 40 characters/).first()).toBeVisible();
    const corrected = "Left front wing and door repaired at a body shop in 2022 after a low-speed impact; invoices available.";
    await summary.fill(corrected);
    await panel.getByRole("button", { name: "Save and send for review" }).click();
    await expect(page.getByText("Description updated. Biddr's team will check your history report again.")).toBeVisible();
    expect((await getAuction<{ damage_history_summary: string }>(a.id)).damage_history_summary).toBe(corrected);
    expect((await getPrivate<{ history_review_status: string }>(a.id)).history_review_status).toBe("pending");

    // Rejected again; this time the seller uploads another report (a new link).
    await setPrivate(a.id, { history_review_status: "rejected", history_review_note: "Wrong car" });
    // (After a reload, a report sent again shows as waiting; rejected again, the choices come back.)
    await page.goto("/account/listings");
    const again = page.getByRole("region", { name: "Vehicle history report not accepted" });
    await again.getByRole("button", { name: /^Upload another report/ }).click();
    await again.getByRole("button", { name: "Send the new report" }).click();
    await expect(again.getByText("Upload the report or paste its carVertical link.")).toBeVisible();
    await again.getByLabel(/carVertical share link/).fill("https://www.carvertical.com/report/e2e-second");
    await again.getByLabel("I'm allowed to share this report with buyers").check();
    await again.getByRole("button", { name: "Send the new report" }).click();
    await expect(page.getByText("New history report sent. Biddr's team will check it.")).toBeVisible();
    expect(await getPrivate(a.id)).toMatchObject({
      history_review_status: "pending",
      history_report_link: "https://www.carvertical.com/report/e2e-second",
      history_report_share_allowed: true,
    });
    await page.reload();
    await expect(page.getByText("Your vehicle history report is waiting for Biddr's team to check it again.")).toBeVisible();
  });

  test("no report: the notice, Copy VIN with a polite status, and Check on carVertical in a new tab", async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium", "Clipboard permissions are Chromium-only here");
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const a = await createAuction({ seller: await createUser({ role: "seller" }), year: 2019 });
    await page.goto(`/auctions/${a.id}`);
    const history = page.getByRole("region", { name: "Vehicle history report" });
    await expect(history).toContainText(
      "No vehicle history report was provided. You can check this car's history yourself on carVertical using its VIN.",
    );
    await expect(page.getByText("History report", { exact: true })).toHaveCount(0);
    await expect(history).not.toContainText("History databases often have little data");
    const check = history.getByRole("link", { name: /Check on carVertical/ });
    await expect(check).toHaveAttribute("href", "https://www.carvertical.com");
    await expect(check).toHaveAttribute("target", "_blank");
    await expect(check).toHaveAttribute("rel", "noopener noreferrer");

    // Scanned before scrolling: scrolled down, the sticky header overlaps the gallery thumbnails, which axe reports.
    await expectAccessible(page, "Auction without a history report");
    await history.getByRole("button", { name: "Copy VIN" }).click();
    await expect(history.getByRole("status")).toHaveText("VIN copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(a.vin);
    await expectAccessible(page, "The history section after copying", 'section[aria-labelledby="vehicle-history-heading"]');
  });

  test("cars from before 1990 get the note about older cars", async ({ page }) => {
    const a = await createAuction({ seller: await createUser({ role: "seller" }), year: 1985 });
    await page.goto(`/auctions/${a.id}`);
    await expect(page.getByRole("region", { name: "Vehicle history report" })).toContainText(
      "History databases often have little data for older cars; restoration records and photos matter more.",
    );
  });

  test("database: sellers can't mark their own report as checked, and the public link must be carVertical's", async () => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({ seller, status: "draft" });
    const db = await userDb(seller.email);
    const { error } = await db.from("auctions").update({ history_report_verified: true }).eq("id", a.id);
    expect(error).not.toBeNull();
    expect((await getAuction<{ history_report_verified: boolean }>(a.id)).history_report_verified).toBe(false);
    const bad = await service().from("auctions").update({ history_report_public_link: "https://evil.example/report" }).eq("id", a.id);
    expect(bad.error?.code).toBe("23514");
    const tooMany = await service().from("auctions").update({ history_summary: Array.from({ length: 9 }, (_, i) => `Line ${i}`) }).eq("id", a.id);
    expect(tooMany.error?.code).toBe("23514");
  });
});

/** Checks the carVertical logo: the file as provided, scaled proportionally, at least 16 px high, with clear space. */
async function expectLogo(page: import("@playwright/test").Page) {
  const section = page.getByRole("region", { name: "Vehicle history report" });
  const logo = section.getByRole("img", { name: "carVertical", exact: true });
  await expect(logo).toHaveCount(1);
  await expect(logo).toBeVisible();
  expect(await logo.getAttribute("src")).toContain(encodeURIComponent("/partners/carvertical-logo.png"));
  const m = await logo.evaluate((img: HTMLImageElement) => {
    const r = img.getBoundingClientRect();
    return { w: r.width, h: r.height, nw: img.naturalWidth, nh: img.naturalHeight, filter: getComputedStyle(img).filter };
  });
  expect(m.h).toBeGreaterThanOrEqual(16);
  // Proportional: the same ratio as the 2000 × 280 source, within a pixel.
  expect(Math.abs(m.w / m.h - 2000 / 280)).toBeLessThan(0.1);
  expect(m.filter).toBe("none");
  // Clear space of at least half the logo's height: no text or control within it.
  const intruders = await section.evaluate((root, clear) => {
    const img = root.querySelector('img[alt="carVertical"]')!.getBoundingClientRect();
    const box = { l: img.left - clear, r: img.right + clear, t: img.top - clear, b: img.bottom + clear };
    return Array.from(root.querySelectorAll("h2, p, a, button, li, [role=status]"))
      .filter((el) => !el.classList.contains("sr-only") && !el.contains(root.querySelector('img[alt="carVertical"]')))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 1 && r.height > 1 && r.left < box.r && r.right > box.l && r.top < box.b && r.bottom > box.t)
      .map(({ el }) => `${el.tagName}: ${(el.textContent ?? "").trim().slice(0, 40)}`);
  }, m.h / 2 - 0.5);
  expect(intruders, "inside the logo's clear space").toEqual([]);
  return { section, logo };
}

test.describe("carVertical logo", () => {
  test("with an accepted report: next to the section heading, above the checked-by-Biddr line", async ({ page }) => {
    const a = await createAuction({
      seller: await createUser({ role: "seller" }),
      extra: { history_report_verified: true, history_summary: ["Mileage records consistent", "No recorded damage"] },
    });
    await page.goto(`/auctions/${a.id}`);
    const { section, logo } = await expectLogo(page);
    const heading = section.getByRole("heading", { name: "Vehicle history report" });
    const line = section.getByText("carVertical report provided by the seller and checked by Biddr.");
    const [lb, hb, tb] = [await logo.boundingBox(), await heading.boundingBox(), await line.boundingBox()];
    // Same row as the heading (or wrapped just below it on narrow screens), and above the text line.
    expect(lb!.y + lb!.height).toBeLessThanOrEqual(tb!.y);
    expect(lb!.y).toBeLessThan(hb!.y + hb!.height + 30);
    await expectAccessible(page, "History section with logo", 'section[aria-labelledby="vehicle-history-heading"]');
  });

  test("without a report: next to the Check on carVertical link, which keeps its text", async ({ page }) => {
    const a = await createAuction({ seller: await createUser({ role: "seller" }) });
    await page.goto(`/auctions/${a.id}`);
    const { section, logo } = await expectLogo(page);
    const link = section.getByRole("link", { name: /Check on carVertical/ });
    // The logo isn't part of the link: the link's name stays "Check on carVertical".
    await expect(link.getByRole("img")).toHaveCount(0);
    const [lb, kb] = [await logo.boundingBox(), await link.boundingBox()];
    expect(Math.abs(lb!.y + lb!.height / 2 - (kb!.y + kb!.height / 2)) < 20 || lb!.y > kb!.y).toBe(true);
  });

  test("nowhere else: not on home page cards, in the badge, header or footer", async ({ page }) => {
    const model = `Q${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const a = await createAuction({
      seller: await createUser({ role: "seller" }),
      model,
      extra: { history_report_verified: true, history_summary: ["Mileage records consistent", "No recorded damage"] },
    });
    await page.goto(`/?q=${model}`);
    await expect(page.locator(`a[href="/auctions/${a.id}"]`).first()).toBeVisible();
    await expect(page.getByRole("img", { name: "carVertical" })).toHaveCount(0);
    await page.goto(`/auctions/${a.id}`);
    await expect(page.getByRole("img", { name: "carVertical" })).toHaveCount(1);
    for (const where of ["banner", "contentinfo"] as const) {
      await expect(page.getByRole(where).getByRole("img", { name: "carVertical" })).toHaveCount(0);
    }
  });
});
