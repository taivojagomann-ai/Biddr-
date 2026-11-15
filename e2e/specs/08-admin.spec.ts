// Area 8: the admin. Review queue, approve, reject, the dealer report review
// (accept, reject, the seller's choice and the daily deadline job), pricing,
// schedule, extend, withdraw, withdrawal requests, the activity log and demo data.
import type { Page } from "@playwright/test";
import { test, expect, signIn, expectAccessible } from "../support/fixtures";
import {
  createAuction,
  createUser,
  getAuction,
  getPrivate,
  iso,
  DAY,
  HOUR,
  notificationsFor,
  runJob,
  service,
  setPrivate,
  type TestUser,
} from "../support/factory";

const draftWindow = () => ({ status: "draft" as const, startsAt: iso(2 * DAY), endsAt: iso(5 * DAY) });

/** Opens a ConfirmButton's dialog and confirms it. */
async function confirmAction(page: Page, label: string, confirmLabel: string, fill?: (dialog: ReturnType<Page["getByRole"]>) => Promise<void>) {
  await page.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.getByRole("dialog").or(page.getByRole("alertdialog")).last();
  if (fill) await fill(dialog);
  await dialog.getByRole("button", { name: confirmLabel, exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

async function adminActions(auctionId: string) {
  const { data } = await service().from("admin_actions").select("action").eq("auction_id", auctionId);
  return (data ?? []).map((r) => r.action as string);
}

async function pendingReport(seller: TestUser) {
  const a = await createAuction({ seller, ...draftWindow(), condition: "restored_accident", damageSummary: "Rear quarter repaired." });
  await setPrivate(a.id, {
    dealer_inspection_provided: true,
    dealer_name: "BMW Niederlassung München",
    dealer_city: "Munich",
    dealer_country: "DE",
    dealer_inspection_date: new Date(Date.now() - 5 * DAY).toISOString().slice(0, 10),
    dealer_inspection_mileage_km: 48_000,
    dealer_report_paths: [`${seller.id}/e2e/report.pdf`],
    inspection_review_status: "pending",
  });
  return a;
}

test.describe("admin", () => {
  test("the review queue and tabs; drafts are listed under To review", async ({ page, context, seed }) => {
    const a = await createAuction({ seller: await createUser({ role: "seller" }), ...draftWindow() });
    await signIn(context, seed.admin);
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Admin" })).toBeVisible();
    for (const tab of ["To review", "Scheduled", "Live", "Finished", "Rejected or withdrawn"]) {
      await expect(page.getByRole("link", { name: new RegExp(`^${tab}`) }).first()).toBeVisible();
    }
    await expect(page.locator(`a[href="/admin/auctions/${a.id}"]`)).not.toHaveCount(0);
    await expectAccessible(page, "Admin");
    await page.goto(`/admin/auctions/${a.id}`);
    await expect(page.getByRole("heading", { level: 1, name: a.title })).toBeVisible();
    await expectAccessible(page, "Admin auction");
  });

  test("approve: the checklist must be complete, then the listing is scheduled, the seller told and the action logged", async ({ page, context, seed }) => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({ seller, status: "draft", startsAt: null, endsAt: null });
    await signIn(context, seed.admin);
    await page.goto(`/admin/auctions/${a.id}`);
    await expect(page.getByText("Missing: Start and end time saved")).toBeAttached();
    await expect(page.getByRole("button", { name: "Approve and schedule", exact: true })).toBeDisabled();

    // Schedule it with the preset, then approve.
    await page.getByRole("button", { name: "Start tomorrow 12:00, end in 7 days at 20:00" }).click();
    await page.getByRole("button", { name: "Save schedule" }).click();
    await expect(page.getByText("Done: Start and end time saved")).toBeAttached({ timeout: 15_000 });
    await confirmAction(page, "Approve and schedule", "Approve and schedule");
    await expect.poll(async () => (await getAuction<{ status: string }>(a.id)).status).toBe("upcoming");
    await expect.poll(async () => (await notificationsFor(seller, "listing_approved")).length).toBe(1);
    expect(await adminActions(a.id)).toEqual(expect.arrayContaining(["schedule.update", "status.approve"]));
    await page.reload();
    await expect(page.getByRole("region", { name: "Admin activity" }).or(page.locator("#activity"))).toContainText("status.approve");
    await expect(page.getByRole("region", { name: "Admin activity" }).or(page.locator("#activity"))).toContainText(seed.admin.username!);

    // Move back to review, approve again.
    await confirmAction(page, "Move back to review", "Move back to review");
    await expect.poll(async () => (await getAuction<{ status: string }>(a.id)).status).toBe("draft");
  });

  test("reject needs a reason of 10+ characters; the seller sees it as Not accepted", async ({ page, context, seed }) => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({ seller, ...draftWindow() });
    await signIn(context, seed.admin);
    await page.goto(`/admin/auctions/${a.id}`);
    await page.getByRole("button", { name: "Reject", exact: true }).click();
    const dialog = page.getByRole("dialog").or(page.getByRole("alertdialog")).last();
    await dialog.getByLabel("Reason (the seller sees this)").fill("Too short");
    await expect(dialog.getByRole("button", { name: "Reject listing" })).toBeDisabled();
    await dialog.getByLabel("Reason (the seller sees this)").fill("The photos don't show the underside. Add them and submit again.");
    await dialog.getByRole("button", { name: "Reject listing" }).click();
    await expect.poll(async () => (await getAuction<{ status: string }>(a.id)).status).toBe("rejected");
    await expect.poll(async () => (await notificationsFor(seller, "listing_rejected")).length).toBe(1);

    await signIn(context, seller);
    await page.goto("/account/listings");
    await expect(page.getByText(/The photos don't show the underside/).first()).toBeVisible();
  });

  test("dealer report: accepting needs all four checks and highlights, then the listing shows Dealer inspected", async ({ page, context, seed }) => {
    const a = await pendingReport(await createUser({ role: "seller" }));
    await signIn(context, seed.admin);
    await page.goto(`/admin/auctions/${a.id}`);
    const form = page.locator("form", { has: page.getByRole("heading", { name: "Accept the report" }) });
    await form.getByRole("button", { name: "Accept report" }).click();
    await expect(form.locator('[id^="check-"][id$="-error"]').first()).toBeVisible();
    for (const c of ["Dealer is an authorised dealer of this brand", "VIN on the report matches the listing", "Mileage is consistent", "Report date is within 90 days"]) {
      await form.getByLabel(c).check();
    }
    const highlights = form.getByRole("textbox", { name: /^Highlight \d/ });
    await highlights.nth(0).fill("Brake discs at 80%");
    for (const text of ["No fault codes", "Tyres 6 mm"]) {
      await form.getByRole("button", { name: "Add highlight" }).click();
      await highlights.last().fill(text);
    }
    await form.getByRole("button", { name: "Accept report" }).click();
    await expect.poll(async () => (await getPrivate<{ inspection_review_status: string }>(a.id)).inspection_review_status).toBe("accepted");
    const pub = await getAuction<{ inspection_type: string; inspection_partner_name: string }>(a.id);
    expect(pub.inspection_type).toBe("authorised_dealer");
    expect(pub.inspection_partner_name).toContain("BMW Niederlassung München");
    expect(await adminActions(a.id)).toContain("inspection.accept");
  });

  test("dealer report rejected: approval waits for the seller, who can list without an inspection", async ({ page, context, seed }) => {
    const seller = await createUser({ role: "seller" });
    const a = await pendingReport(seller);
    await signIn(context, seed.admin);
    await page.goto(`/admin/auctions/${a.id}`);
    const form = page.locator("form", { has: page.getByRole("heading", { name: "Reject the report" }) });
    await form.getByLabel("Reason").fill("Not an authorised dealer");
    await form.getByRole("button", { name: "Reject report" }).click();
    await expect.poll(async () => (await getPrivate<{ seller_decision_required: boolean }>(a.id)).seller_decision_required).toBe(true);
    const priv = await getPrivate<{ seller_decision_deadline: string }>(a.id);
    expect(Math.round((Date.parse(priv.seller_decision_deadline) - Date.now()) / DAY)).toBe(30);
    expect((await notificationsFor(seller)).map((n) => n.type)).toContain("inspection_rejected");
    await page.reload();
    await expect(page.getByText(/Waiting for the seller to choose/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve and schedule", exact: true })).toBeDisabled();

    // The seller decides on My listings.
    await signIn(context, seller);
    await page.goto("/account/listings");
    await expect(page.getByRole("heading", { name: "Waiting for your decision" })).toBeVisible();
    await expect(page.getByText("Your inspection report wasn't accepted: Not an authorised dealer", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: `List without an inspection: ${a.title}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "List without an inspection" }).click();
    await expect.poll(async () => (await getPrivate<{ seller_decision: string }>(a.id)).seller_decision).toBe("without_inspection");
    expect((await notificationsFor(seed.admin)).map((n) => n.type)).toContain("seller_decided");

    await signIn(context, seed.admin);
    await page.goto(`/admin/auctions/${a.id}`);
    await expect(page.getByRole("button", { name: "Approve and schedule", exact: true })).toBeEnabled();
  });

  test("the daily deadline job reminds once 7 days before, then withdraws after the deadline", async () => {
    const seller = await createUser({ role: "seller" });
    const a = await pendingReport(seller);
    await setPrivate(a.id, { inspection_review_status: "rejected", seller_decision_required: true, seller_decision_deadline: iso(3 * DAY) });
    await runJob("inspection_decision_job");
    await runJob("inspection_decision_job");
    expect(await notificationsFor(seller, "inspection_decision_reminder")).toHaveLength(1);
    expect((await getAuction<{ status: string }>(a.id)).status).toBe("draft");

    await setPrivate(a.id, { seller_decision_deadline: iso(-HOUR) });
    await runJob("inspection_decision_job");
    expect((await getAuction<{ status: string }>(a.id)).status).toBe("withdrawn");
    expect(await notificationsFor(seller, "inspection_decision_expired")).toHaveLength(1);
    expect((await getPrivate<{ seller_decision_required: boolean }>(a.id)).seller_decision_required).toBe(false);
  });

  test("pricing: reserve and no reserve are saved; the seller's request is shown", async ({ page, context, seed }) => {
    const a = await createAuction({ seller: await createUser({ role: "seller" }), ...draftWindow(), reserve: 30_000 });
    await signIn(context, seed.admin);
    await page.goto(`/admin/auctions/${a.id}`);
    await expect(page.getByText("The seller asked for €30,000.")).toBeVisible();
    await page.getByLabel("Reserve price (€)").fill("32000");
    await page.getByRole("button", { name: "Save pricing" }).click();
    await expect.poll(async () => (await getPrivate<{ reserve_price: number }>(a.id)).reserve_price).toBe(32_000);
    expect((await getAuction<{ has_reserve: boolean }>(a.id)).has_reserve).toBe(true);
    await page.getByLabel("No reserve").check();
    await page.getByRole("button", { name: "Save pricing" }).click();
    await expect.poll(async () => (await getAuction<{ has_reserve: boolean }>(a.id)).has_reserve).toBe(false);
    expect(await adminActions(a.id)).toContain("pricing.update");
  });

  test("live auctions: extend by an hour, and withdraw with bids", async ({ page, context, seed }) => {
    const a = await createAuction({ seller: await createUser({ role: "seller" }), endsAt: iso(5 * HOUR) });
    const before = Date.parse((await getAuction<{ ends_at: string }>(a.id)).ends_at);
    await signIn(context, seed.admin);
    await page.goto(`/admin/auctions/${a.id}`);
    await confirmAction(page, "+1 hour", "Extend");
    await expect.poll(async () => Date.parse((await getAuction<{ ends_at: string }>(a.id)).ends_at) - before).toBe(HOUR);
    await page.reload();
    await confirmAction(page, "Withdraw auction", "Withdraw and cancel bids");
    await expect.poll(async () => (await getAuction<{ status: string }>(a.id)).status).toBe("withdrawn");
    expect(await adminActions(a.id)).toEqual(expect.arrayContaining(["schedule.extend", "status.withdraw"]));
  });

  test("a scheduled auction can be withdrawn before bidding opens", async ({ page, context, seed }) => {
    const a = await createAuction({ seller: await createUser({ role: "seller" }), status: "upcoming", startsAt: iso(DAY), endsAt: iso(3 * DAY) });
    await signIn(context, seed.admin);
    await page.goto(`/admin/auctions/${a.id}`);
    await confirmAction(page, "Withdraw", "Withdraw auction");
    await expect.poll(async () => (await getAuction<{ status: string }>(a.id)).status).toBe("withdrawn");
  });

  test("withdrawal requests on live auctions: the seller asks, the admin approves or declines", async ({ page, context, seed }) => {
    const seller = await createUser({ role: "seller" });
    const approveMe = await createAuction({ seller, endsAt: iso(2 * DAY) });
    const declineMe = await createAuction({ seller, endsAt: iso(2 * DAY) });

    await signIn(context, seller);
    await page.goto("/account/listings");
    for (const a of [approveMe, declineMe]) {
      await page.getByRole("button", { name: `Request withdrawal: ${a.title}` }).click();
      const dialog = page.getByRole("dialog", { name: "Request withdrawal?" });
      await dialog.getByRole("button", { name: "Send request" }).click();
      await expect(dialog.getByRole("alert")).toBeVisible();
      await dialog.getByLabel("Why do you want to withdraw it?").fill("The car was damaged in a hailstorm yesterday.");
      await dialog.getByRole("button", { name: "Send request" }).click();
      await expect(page.getByText("Withdrawal requested. The Biddr team will reply soon.")).toBeVisible();
      await expect.poll(async () => (await getPrivate<{ withdraw_request_status: string }>(a.id)).withdraw_request_status).toBe("pending");
    }

    await signIn(context, seed.admin);
    await page.goto("/admin?tab=live&requests=1");
    await expect(page.locator(`a[href="/admin/auctions/${approveMe.id}"]`)).not.toHaveCount(0);
    await page.goto(`/admin/auctions/${approveMe.id}`);
    await confirmAction(page, "Approve and withdraw", "Approve and withdraw");
    await expect.poll(async () => (await getAuction<{ status: string }>(approveMe.id)).status).toBe("withdrawn");
    await page.goto(`/admin/auctions/${declineMe.id}`);
    await confirmAction(page, "Decline", "Decline request");
    await expect.poll(async () => (await getPrivate<{ withdraw_request_status: string }>(declineMe.id)).withdraw_request_status).toBe("declined");
    expect((await getAuction<{ status: string }>(declineMe.id)).status).toBe("live");
    expect(await adminActions(declineMe.id)).toContain("withdraw_request.decline");
  });

  test("demo data loads and is removed again, without touching real listings", async ({ page, context, seed }) => {
    test.setTimeout(240_000);
    const real = await createAuction({ seller: await createUser({ role: "seller" }) });
    await signIn(context, seed.admin);
    await page.goto("/admin");
    const panel = page.locator("section[aria-labelledby='demo-heading']");
    const label = (await panel.getByRole("button", { name: "Reset demo data" }).count()) ? "Reset demo data" : "Load demo data";
    await panel.getByRole("button", { name: label }).click();
    const dialog = page.getByRole("dialog").or(page.getByRole("alertdialog")).last();
    await dialog.getByRole("button", { name: /^(Load|Reset)/ }).last().click();
    await expect(dialog).toBeHidden({ timeout: 180_000 });
    const count = async () => (await service().from("auctions").select("id", { count: "exact", head: true }).eq("is_demo", true)).count ?? 0;
    expect(await count()).toBeGreaterThan(5);

    await panel.getByRole("button", { name: "Remove demo data" }).click();
    const remove = page.getByRole("dialog").or(page.getByRole("alertdialog")).last();
    await remove.getByRole("button", { name: /^Remove/ }).last().click();
    await expect(remove).toBeHidden({ timeout: 120_000 });
    expect(await count()).toBe(0);
    expect((await getAuction<{ status: string }>(real.id)).status).toBe("live");
  });
});
