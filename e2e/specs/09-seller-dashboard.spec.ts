// Area 9: the seller's dashboard (My listings): every status, withdrawing before
// bidding opens, requesting a withdrawal while live, and what isn't built yet.
import { test, expect, signIn, expectAccessible, expectNoHorizontalScroll } from "../support/fixtures";
import { createAuction, createUser, getAuction, getPrivate, iso, DAY, readyBidder, bid, service } from "../support/factory";
import { userDb } from "../support/supabase";

test.describe("My listings", () => {
  test("shows each listing with its status, high bid and only the seller's own cars", async ({ page, context }) => {
    const seller = await createUser({ role: "seller" });
    const other = await createUser({ role: "seller" });
    const draft = await createAuction({ seller, status: "draft" });
    const upcoming = await createAuction({ seller, status: "upcoming", startsAt: iso(DAY), endsAt: iso(3 * DAY) });
    const live = await createAuction({ seller, startingBid: 12_000 });
    await bid(await readyBidder(live.id), live.id, 12_000);
    const sold = await createAuction({ seller, status: "sold", startsAt: iso(-5 * DAY), endsAt: iso(-DAY) });
    const rejected = await createAuction({ seller, status: "rejected" });
    const notMine = await createAuction({ seller: other });

    await signIn(context, seller);
    await page.goto("/account/listings");
    const row = (a: { title: string; id: string }) => page.locator("li", { has: page.locator(`a[href="/auctions/${a.id}"]`) }).first();
    await expect(row(draft)).toContainText("Waiting for review");
    await expect(row(upcoming)).toContainText("Scheduled");
    await expect(row(live)).toContainText("Live");
    await expect(row(live)).toContainText("€12,000");
    await expect(row(sold)).toContainText("Sold");
    await expect(row(rejected)).toContainText("Not accepted");
    await expect(page.locator(`a[href="/auctions/${notMine.id}"]`)).toHaveCount(0);
    await expectAccessible(page, "My listings");
  });

  test("each row shows its timing: live time left (orange under an hour) with the exact end, scheduled start, ended date; extensions arrive live", async ({ page, context }) => {
    const seller = await createUser({ role: "seller" });
    const draft = await createAuction({ seller, status: "draft" });
    const upcoming = await createAuction({ seller, status: "upcoming", startsAt: iso(DAY), endsAt: iso(3 * DAY) });
    const live = await createAuction({ seller, startsAt: iso(-DAY), endsAt: iso(2 * DAY + 4 * 60 * 60_000 - 30_000) });
    const closing = await createAuction({ seller, startsAt: iso(-DAY), endsAt: iso(41.5 * 60_000) });
    const sold = await createAuction({ seller, status: "sold", startsAt: iso(-5 * DAY), endsAt: iso(-DAY) });
    const rejected = await createAuction({ seller, status: "rejected" });

    await signIn(context, seller);
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto("/account/listings");
    const row = (a: { id: string }) => page.locator("li", { has: page.locator(`a[href="/auctions/${a.id}"]`) }).first();
    const timing = (a: { id: string }) => row(a).locator("[data-timing]");

    await expect(timing(live)).toHaveAttribute("data-timing", "live");
    await expect(timing(live).locator("[data-time-left]")).toHaveText("2d 4h");
    await expect(timing(live)).toContainText("Time left: 2 days 4 hours");
    await expect(timing(live)).toContainText(/\d{2}:\d{2} [A-Z]/); // the exact end, with the zone
    await expect(timing(live).locator(".text-signal")).toHaveCount(0);

    await expect(timing(closing).locator("[data-time-left]")).toHaveText("42m");
    await expect(timing(closing)).toContainText("Time left: 42 minutes, less than an hour");
    await expect(timing(closing).locator(".text-signal")).toHaveCount(1);

    await expect(timing(upcoming)).toHaveAttribute("data-timing", "upcoming");
    await expect(timing(upcoming)).toContainText("Starts in");
    await expect(timing(upcoming).locator("[data-time-left]")).toHaveText("1d 0h");
    await expect(timing(upcoming)).toContainText("Ends ");

    await expect(timing(sold)).toHaveAttribute("data-timing", "ended");
    await expect(timing(sold)).toContainText(/^Ended \w{3}, /);
    await expect(timing(draft)).toHaveCount(0);
    await expect(timing(rejected)).toHaveCount(0);
    await expect(row(draft)).toContainText("Submitted");

    await expectNoHorizontalScroll(page, "My listings at 320px");
    await expectAccessible(page, "My listings with timing");

    // A late bid extends the auction (anti-sniping): the row follows without a reload.
    await service().from("auctions").update({ ends_at: iso(3 * 60 * 60_000 - 30_000) }).eq("id", closing.id);
    await expect(timing(closing).locator("[data-time-left]")).toHaveText("3h 0m", { timeout: 15_000 });
    await expect(timing(closing).locator(".text-signal")).toHaveCount(0);
  });

  test("a draft or scheduled listing can be withdrawn straight away; the reason is optional", async ({ page, context }) => {
    const seller = await createUser({ role: "seller" });
    const upcoming = await createAuction({ seller, status: "upcoming", startsAt: iso(DAY), endsAt: iso(3 * DAY) });
    await signIn(context, seller);
    await page.goto("/account/listings");
    await page.getByRole("button", { name: `Withdraw listing: ${upcoming.title}` }).click();
    const dialog = page.getByRole("dialog", { name: "Withdraw this listing?" });
    await dialog.getByLabel(/Reason/).fill("Sold privately");
    await dialog.getByRole("button", { name: "Withdraw listing" }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(async () => (await getAuction<{ status: string }>(upcoming.id)).status).toBe("withdrawn");
    expect((await getPrivate<{ withdraw_reason: string }>(upcoming.id)).withdraw_reason).toBe("Sold privately");
  });

  test("a live listing can only be asked to withdraw, and only once; another seller can't", async ({ page, context }) => {
    const seller = await createUser({ role: "seller" });
    const live = await createAuction({ seller, endsAt: iso(2 * DAY) });
    await signIn(context, seller);
    await page.goto("/account/listings");
    await expect(page.getByRole("button", { name: `Withdraw listing: ${live.title}` })).toHaveCount(0);
    await page.getByRole("button", { name: `Request withdrawal: ${live.title}` }).click();
    const dialog = page.getByRole("dialog", { name: "Request withdrawal?" });
    await dialog.getByLabel("Why do you want to withdraw it?").fill("Engine warning light came on.");
    await dialog.getByRole("button", { name: "Send request" }).click();
    await expect(page.getByText("Withdrawal requested. The Biddr team will reply soon.")).toBeVisible();
    await page.reload();
    await expect(page.getByText("Withdrawal requested").first()).toBeVisible();
    await expect(page.getByRole("button", { name: `Request withdrawal: ${live.title}` })).toHaveCount(0);
    expect((await getAuction<{ status: string }>(live.id)).status).toBe("live");

    // The database refuses requests and withdrawals for someone else's car.
    const intruder = await userDb((await createUser({ role: "seller" })).email);
    expect((await intruder.rpc("seller_request_withdrawal", { p_auction_id: live.id, p_reason: "Not my car at all, testing." })).error).not.toBeNull();
    const upcoming = await createAuction({ seller, status: "upcoming", startsAt: iso(DAY), endsAt: iso(3 * DAY) });
    expect((await intruder.rpc("seller_withdraw", { p_auction_id: upcoming.id, p_reason: null })).error).not.toBeNull();
    expect((await getAuction<{ status: string }>(upcoming.id)).status).toBe("upcoming");
  });
});
