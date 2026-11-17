// Area 5: bidding. The bid dialog's steps, every database rule in place_bid,
// anti-sniping, concurrency, the buyer's premium and live updates.
import Stripe from "stripe";
import type { Page } from "@playwright/test";
import { test, expect, signIn, expectAccessible, realtimeReady } from "../support/fixtures";
import { APP_URL, STRIPE_MOCK_PORT, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET } from "../support/env";
import { authorizeHold, bid, createAuction, createUser, getAuction, iso, DAY, HOUR, readyBidder, service, notificationsFor } from "../support/factory";
import { userDb } from "../support/supabase";
import { withStripeMockLock } from "../support/stripe";

/** Opens the bid dialog from the bid box (desktop) or the sticky bar (phones). */
async function openBidDialog(page: Page) {
  await page.getByRole("button", { name: /^(Bid €[\d,]+|Place bid)$/ }).locator("visible=true").first().click();
}

const errorCode = (e: { message?: string } | null) => e?.message ?? null;

test.describe("bid dialog", () => {
  test("signed out: asks you to sign in", async ({ page }) => {
    const a = await createAuction({ seller: await createUser({ role: "seller" }) });
    await page.goto(`/auctions/${a.id}`);
    await openBidDialog(page);
    const dialog = page.getByRole("dialog", { name: "Sign in to bid" });
    await expect(dialog.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/login?next=/auctions/${a.id}`);
  });

  test("incomplete profile: asks you to finish it first", async ({ page, context }) => {
    const a = await createAuction({ seller: await createUser({ role: "seller" }) });
    await signIn(context, await createUser({ complete: false }));
    await page.goto(`/auctions/${a.id}`);
    await openBidDialog(page);
    await expect(page.getByRole("dialog", { name: "Finish your profile to bid" })).toBeVisible();
  });

  test("terms (both boxes required, version stored), then the card check, then confirm", async ({ page, context }) => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({ seller, startingBid: 15_000 });
    const user = await createUser({ terms: false });
    await signIn(context, user);

    // stripe-mock returns the same PaymentIntent id every time: one card-check test at a time,
    // and clear old holds that use it.
    await withStripeMockLock(async () => {
      const mock = new Stripe(STRIPE_SECRET_KEY, { host: "localhost", port: STRIPE_MOCK_PORT, protocol: "http" });
      const probe = await mock.paymentIntents.create({ amount: 50_000, currency: "eur" });
      await service().from("bid_holds").delete().eq("stripe_payment_intent_id", probe.id);

      await page.goto(`/auctions/${a.id}`);
      await openBidDialog(page);
      const terms = page.getByRole("dialog", { name: "Before your first bid" });
      await terms.getByRole("button", { name: "Agree and continue" }).click();
      await expect(terms.getByRole("alert")).toBeVisible();
      await terms.getByRole("checkbox", { name: "I have read and agree to the bidding terms" }).check();
      await terms.getByRole("button", { name: "Agree and continue" }).click();
      await expect(terms.getByText("Confirm that you are 18 or older.")).toBeVisible();
      await terms.getByRole("checkbox", { name: "I am 18 or older" }).check();
      await expectAccessible(page, "Terms step", "[role=dialog]");
      await terms.getByRole("button", { name: "Agree and continue" }).click();

      // Card check: the real card form is in MANUAL_TESTS.md; here the hold is authorised by a signed webhook.
      await expect(page.getByRole("dialog", { name: "Confirm your card" })).toBeVisible();
      const { data: me } = await service().from("profiles").select("bidding_terms_version, bidding_terms_accepted_at").eq("id", user.id).single();
      expect(me?.bidding_terms_version).toBeTruthy();
      expect(me?.bidding_terms_accepted_at).toBeTruthy();
      const { data: hold } = await service().from("bid_holds").select("stripe_payment_intent_id, status").eq("auction_id", a.id).eq("user_id", user.id).single();
      expect(hold?.status).toBe("pending");

      const payload = JSON.stringify({
        id: `evt_e2e_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
        object: "event",
        type: "payment_intent.amount_capturable_updated",
        data: {
          object: {
            id: hold!.stripe_payment_intent_id,
            object: "payment_intent",
            status: "requires_capture",
            amount_capturable: 50_000,
            currency: "eur",
            metadata: { kind: "bid_hold", auction_id: a.id, user_id: user.id },
          },
        },
      });
      const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: STRIPE_WEBHOOK_SECRET });
      const res = await page.request.post(`${APP_URL}/api/stripe/webhook`, { data: payload, headers: { "stripe-signature": signature, "content-type": "application/json" } });
      expect(res.status()).toBe(200);
      const bad = await page.request.post(`${APP_URL}/api/stripe/webhook`, { data: payload, headers: { "stripe-signature": "t=1,v1=bad" } });
      expect(bad.status()).toBe(400);

      // Steps already done are skipped: straight to confirm.
      await page.reload();
      await openBidDialog(page);
      const confirm = page.getByRole("dialog", { name: "Confirm your bid" });
      await expect(confirm).toBeVisible();
      await confirm.getByRole("button", { name: "Place bid of €15,000" }).click();
      await expect(page.getByRole("dialog", { name: "You have the high bid" })).toBeVisible();
      expect((await getAuction<{ current_bid: number }>(a.id)).current_bid).toBe(15_000);
    });
  });

  test("the confirm step shows the buyer's premium and total", async ({ page, context }) => {
    const a = await createAuction({ seller: await createUser({ role: "seller" }), startingBid: 70_000 });
    const user = await readyBidder(a.id);
    await signIn(context, user);
    await page.goto(`/auctions/${a.id}`);
    await openBidDialog(page);
    const confirm = page.getByRole("dialog", { name: "Confirm your bid" });
    await expect(confirm).toContainText("€3,500");
    await expect(confirm).toContainText("€73,500");
  });
});

test.describe("bidding rules (database)", () => {
  test("minimum bid, increments and BID_TOO_LOW with the new minimum", async () => {
    const a = await createAuction({ seller: await createUser({ role: "seller" }), startingBid: 10_000, minIncrement: 500 });
    const [b1, b2] = [await readyBidder(a.id), await readyBidder(a.id)];
    const low = await bid(b1, a.id, 9_999);
    expect(errorCode(low.error)).toBe("BID_TOO_LOW");
    expect((low.error as { details?: string }).details).toBe("10000");
    expect((await bid(b1, a.id, 10_000)).error).toBeNull();
    const tooSmall = await bid(b2, a.id, 10_400);
    expect(errorCode(tooSmall.error)).toBe("BID_TOO_LOW");
    expect((tooSmall.error as { details?: string }).details).toBe("10500");
    const ok = await bid(b2, a.id, 10_500);
    expect(ok.error).toBeNull();
    expect((ok.data as { min_next: number }).min_next).toBe(11_000);
  });

  test("own auction, already leading, not live, ended and demo listings are refused", async () => {
    const seller = await createUser({ role: "seller", verifiedBidder: true });
    const a = await createAuction({ seller });
    await authorizeHold(seller, a.id);
    expect(errorCode((await bid(seller, a.id, 50_000)).error)).toBe("OWN_AUCTION");

    const leader = await readyBidder(a.id);
    expect((await bid(leader, a.id, 10_000)).error).toBeNull();
    expect(errorCode((await bid(leader, a.id, 11_000)).error)).toBe("ALREADY_LEADING");

    const upcoming = await createAuction({ seller, status: "upcoming" });
    expect(errorCode((await bid(await readyBidder(upcoming.id), upcoming.id, 20_000)).error)).toBe("AUCTION_NOT_LIVE");

    const ended = await createAuction({ seller, status: "live", startsAt: iso(-2 * DAY), endsAt: iso(-1000) });
    expect(errorCode((await bid(await readyBidder(ended.id), ended.id, 20_000)).error)).toBe("AUCTION_ENDED");

    const demo = await createAuction({ seller, isDemo: true });
    expect(errorCode((await bid(await readyBidder(demo.id), demo.id, 20_000)).error)).toBe("DEMO_AUCTION");

    const noHold = await createUser({ verifiedBidder: true });
    expect(errorCode((await bid(noHold, a.id, 30_000)).error)).toBe("HOLD_REQUIRED");
  });

  test("an incomplete profile or missing terms are refused by the database", async () => {
    const a = await createAuction({ seller: await createUser({ role: "seller" }) });
    const noTerms = await readyBidder(a.id, { terms: false });
    expect(errorCode((await bid(noTerms, a.id, 20_000)).error)).toBe("TERMS_NOT_ACCEPTED");
    const incomplete = await readyBidder(a.id, { complete: false });
    expect(errorCode((await bid(incomplete, a.id, 20_000)).error)).toMatch(/PROFILE_INCOMPLETE|TERMS_NOT_ACCEPTED/);
  });

  test("anti-sniping: a bid in the last 2 minutes adds 2 minutes, and the page says so", async ({ page }) => {
    const endsAt = iso(90_000);
    const a = await createAuction({ seller: await createUser({ role: "seller" }), endsAt });
    const b = await readyBidder(a.id);
    const live = realtimeReady(page, `auction:${a.id}`);
    await page.goto(`/auctions/${a.id}`);
    await live;
    const res = await bid(b, a.id, 10_000);
    expect(res.error).toBeNull();
    expect((res.data as { extended: boolean }).extended).toBe(true);
    const after = await getAuction<{ ends_at: string }>(a.id);
    expect(Date.parse(after.ends_at) - Date.parse(endsAt)).toBe(120_000);
    await expect(page.getByText("A late bid added 2 minutes to the clock.").locator("visible=true").first()).toBeVisible({ timeout: 15_000 });
  });

  test("two equal bids at the same moment: exactly one wins", async () => {
    const a = await createAuction({ seller: await createUser({ role: "seller" }), startingBid: 30_000 });
    const [x, y] = [await readyBidder(a.id), await readyBidder(a.id)];
    const [cx, cy] = [await userDb(x.email), await userDb(y.email)];
    const results = await Promise.all([
      cx.rpc("place_bid", { p_auction_id: a.id, p_amount: 30_000 }),
      cy.rpc("place_bid", { p_auction_id: a.id, p_amount: 30_000 }),
    ]);
    expect(results.filter((r) => !r.error)).toHaveLength(1);
    expect(results.filter((r) => r.error).map((r) => r.error!.message)).toEqual(["BID_TOO_LOW"]);
    const { count } = await service().from("bids").select("id", { count: "exact", head: true }).eq("auction_id", a.id);
    expect(count).toBe(1);
  });
});

test.describe("buyer's premium", () => {
  for (const [amount, premium] of [
    [5_000, 350],
    [7_000, 350],
    [70_000, 3_500],
    [100_000, 3_500],
  ] as const) {
    test(`a €${amount.toLocaleString("en-IE")} bid shows a €${premium.toLocaleString("en-IE")} premium`, async ({ page, context }) => {
      const a = await createAuction({ seller: await createUser({ role: "seller" }), startingBid: amount });
      await signIn(context, await readyBidder(a.id));
      await page.goto(`/auctions/${a.id}`);
      await openBidDialog(page);
      const confirm = page.getByRole("dialog", { name: "Confirm your bid" });
      await expect(confirm.getByText(/Buyer's premium/).locator("xpath=..").locator("dd")).toHaveText(`€${premium.toLocaleString("en-IE")}`);
      await expect(confirm.getByText("Total if you win").locator("xpath=..").locator("dd")).toHaveText(`€${(amount + premium).toLocaleString("en-IE")}`);
      const { data } = await service().rpc("buyers_premium", { p_amount: amount });
      expect(data).toBe(premium);
    });
  }
});

test.describe("live bidding across browsers", () => {
  test("price, bid history, outbid notice and notification; bidding adds the car to the watchlist", async ({ browser }) => {
    const a = await createAuction({ seller: await createUser({ role: "seller" }), startingBid: 40_000, endsAt: iso(2 * DAY) });
    const [first, second] = [await readyBidder(a.id), await readyBidder(a.id)];
    const ctx1 = await browser.newContext();
    await signIn(ctx1, first);
    const p1 = await ctx1.newPage();
    const p1Live = realtimeReady(p1, `auction:${a.id}`);
    await p1.goto(`/auctions/${a.id}`);
    await openBidDialog(p1);
    await p1.getByRole("dialog", { name: "Confirm your bid" }).getByRole("button", { name: "Place bid of €40,000" }).click();
    await expect(p1.getByRole("dialog", { name: "You have the high bid" })).toBeVisible();
    await p1.keyboard.press("Escape");

    const ctx2 = await browser.newContext();
    await signIn(ctx2, second);
    const p2 = await ctx2.newPage();
    const p2Live = realtimeReady(p2, `auction:${a.id}`);
    await p2.goto(`/auctions/${a.id}`);
    await Promise.all([p1Live, p2Live]);
    expect((await bid(second, a.id, 41_000)).error).toBeNull();

    // The first bidder's page updates without reloading.
    await expect(p1.getByText(/You've been outbid/).locator("visible=true").first()).toBeVisible({ timeout: 15_000 });
    await expect(p1.getByText("€41,000").locator("visible=true").first()).toBeVisible();
    await expect(p2.getByText("€41,000").locator("visible=true").first()).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await notificationsFor(first, "outbid")).length).toBe(1);

    // Bidding put the car on both bidders' watchlists.
    for (const u of [first, second]) {
      const { data } = await service().from("watchlist").select("auction_id").eq("user_id", u.id).eq("auction_id", a.id);
      expect(data ?? []).toHaveLength(1);
    }
    await ctx1.close();
    await ctx2.close();
  });
});

void HOUR;
