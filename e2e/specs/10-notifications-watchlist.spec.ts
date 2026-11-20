// Area 10: notifications (every type, never about your own action, never for
// demo listings, never twice) and the watchlist.
import { test, expect, signIn, expectAccessible, realtimeReady } from "../support/fixtures";
import { bid, createAuction, createUser, iso, DAY, HOUR, notificationsFor, readyBidder, runJob, service, setAuction } from "../support/factory";
import { userDb } from "../support/supabase";

async function watch(userEmail: string, auctionId: string) {
  const db = await userDb(userEmail);
  const { data: { user } } = await db.auth.getUser();
  const { error } = await db.from("watchlist").insert({ user_id: user!.id, auction_id: auctionId });
  expect(error).toBeNull();
}

test.describe("notifications", () => {
  test("every database-driven type is sent once, to the right person", async ({ seed }) => {
    const seller = await createUser({ role: "seller" });
    const watcher = await createUser();

    // listing_submitted: every admin hears about a new draft.
    const draft = await createAuction({ seller, status: "draft", startsAt: iso(DAY), endsAt: iso(3 * DAY) });
    expect(await notificationsFor(seed.admin, "listing_submitted").then((l) => l.filter((n) => n.auction_id === draft.id))).toHaveLength(1);

    // listing_approved, then auction_live for the seller and watch_live for watchers.
    await setAuction(draft.id, { status: "upcoming" });
    await watch(watcher.email, draft.id);
    await setAuction(draft.id, { status: "live", starts_at: iso(-HOUR), ends_at: iso(30 * 60_000) });
    expect(await notificationsFor(seller, "listing_approved")).toHaveLength(1);
    expect(await notificationsFor(seller, "auction_live")).toHaveLength(1);
    expect(await notificationsFor(watcher, "watch_live")).toHaveLength(1);
    expect(await notificationsFor(seller, "watch_live")).toHaveLength(0);

    // watch_ending_soon: once, however often the job runs.
    await runJob("notify_watch_ending_soon");
    await runJob("notify_watch_ending_soon");
    expect(await notificationsFor(watcher, "watch_ending_soon")).toHaveLength(1);

    // outbid goes to the previous leader only; auction_ended to the seller; auction_won to the winner.
    const [first, second] = [await readyBidder(draft.id), await readyBidder(draft.id)];
    await bid(first, draft.id, 10_000);
    await bid(second, draft.id, 11_000);
    expect(await notificationsFor(first, "outbid")).toHaveLength(1);
    expect(await notificationsFor(second, "outbid")).toHaveLength(0);
    await setAuction(draft.id, { status: "sold" });
    expect(await notificationsFor(seller, "auction_ended")).toHaveLength(1);
    expect(await notificationsFor(second, "auction_won")).toHaveLength(1);
    expect(await notificationsFor(first, "auction_won")).toHaveLength(0);

    // listing_rejected.
    const rejected = await createAuction({ seller, status: "draft" });
    await setAuction(rejected.id, { status: "rejected" });
    expect(await notificationsFor(seller, "listing_rejected")).toHaveLength(1);
  });

  test("never about your own action, and never for demo listings", async () => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({ seller });
    const sellerDb = await userDb(seller.email);
    const { data: own } = await sellerDb.from("comments").insert({ auction_id: a.id, content: "Seller's own note on the car." }).select("id").single();
    await sellerDb.from("comments").insert({ auction_id: a.id, parent_id: own!.id, content: "And a follow-up." });
    expect(await notificationsFor(seller)).toHaveLength(0);

    const demo = await createAuction({ seller, isDemo: true });
    const visitor = await createUser();
    await (await userDb(visitor.email)).from("comments").insert({ auction_id: demo.id, content: "Question on a demo car." });
    await watch(visitor.email, demo.id);
    await setAuction(demo.id, { status: "sold" });
    expect((await notificationsFor(seller)).filter((n) => n.auction_id === demo.id)).toHaveLength(0);
    expect(await notificationsFor(visitor)).toHaveLength(0);
  });

  test("the bell counts unread live, the page lists them with links, and Mark all as read clears them", async ({ page, context }) => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({ seller });
    await signIn(context, seller);
    const live = realtimeReady(page, `notifications:${seller.id}`, { count: 2 });
    await page.goto("/");
    const bell = page.getByRole("button", { name: /^Notifications, / });
    await expect(bell).toHaveAccessibleName("Notifications, none unread");
    await live;
    const asker = await createUser();
    await (await userDb(asker.email)).from("comments").insert({ auction_id: a.id, content: "Is the price negotiable?" });
    await expect(bell).toHaveAccessibleName("Notifications, 1 unread", { timeout: 15_000 });

    await page.goto("/account/notifications");
    await expect(page.getByRole("heading", { level: 1, name: "Notifications" })).toBeVisible();
    const item = page.getByRole("link", { name: new RegExp(`^New question on ${a.title}`) }).first();
    await expect(item).toHaveAttribute("href", new RegExp(`/auctions/${a.id}#comment-`));
    await expectAccessible(page, "Notifications");
    await page.getByRole("button", { name: "Mark all as read" }).first().click();
    await expect(page.getByRole("button", { name: "Notifications, none unread" })).toBeVisible();
    const { count } = await service().from("notifications").select("id", { count: "exact", head: true }).eq("user_id", seller.id).is("read_at", null);
    expect(count).toBe(0);
  });

  test("clicking a notification marks it read before leaving the page, even where leaving cancels requests (Safari)", async ({ page, context }) => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({ seller });
    const asker = await createUser();
    await (await userDb(asker.email)).from("comments").insert({ auction_id: a.id, content: "Is the service history complete?" });
    await signIn(context, seller);
    await page.goto("/account/notifications");

    // Safari cancels a page's requests once a full page load starts; Chrome lets them
    // finish. Act like Safari: hold the "mark read" request, and drop it if a full
    // page load started meanwhile.
    let fullPageLoad = false;
    page.on("request", (r) => {
      if (r.isNavigationRequest() && r.frame() === page.mainFrame()) fullPageLoad = true;
    });
    await page.route("**/rest/v1/notifications**", async (route) => {
      if (route.request().method() !== "PATCH") return route.continue();
      await new Promise((r) => setTimeout(r, 1_000));
      return fullPageLoad ? route.abort() : route.continue();
    });

    await page.getByRole("link", { name: new RegExp(`^New question on ${a.title}`) }).first().click();
    await expect(page).toHaveURL(new RegExp(`/auctions/${a.id}#comment-`));
    expect(fullPageLoad).toBe(false);
    await expect
      .poll(async () => (await service().from("notifications").select("read_at").eq("user_id", seller.id).eq("auction_id", a.id)).data?.every((n) => n.read_at))
      .toBe(true);
  });

  test("more than 9 unread: the badge shows 9+ and the button's name says the same", async ({ page, context }) => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({ seller });
    const rows = Array.from({ length: 12 }, () => ({ user_id: seller.id, type: "question", auction_id: a.id }));
    expect((await service().from("notifications").insert(rows)).error).toBeNull();
    await signIn(context, seller);
    await page.goto("/");
    const bell = page.getByRole("button", { name: "Notifications, 9+ unread" });
    await expect(bell).toBeVisible();
    await expect(bell).toContainText("9+");
    await expectAccessible(page, "Bell with 9+ unread", "header");
  });

  test("you can only read and update your own notifications", async () => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({ seller });
    await (await userDb((await createUser()).email)).from("comments").insert({ auction_id: a.id, content: "Any rust underneath?" });
    const other = await userDb((await createUser()).email);
    const { data } = await other.from("notifications").select("id").eq("user_id", seller.id);
    expect(data ?? []).toHaveLength(0);
    const { data: forged } = await other.from("notifications").insert({ user_id: seller.id, type: "outbid", auction_id: a.id }).select();
    expect(forged ?? []).toHaveLength(0);
    expect(await notificationsFor(seller, "outbid")).toHaveLength(0);
  });
});

test.describe("watchlist", () => {
  test("watching keeps a count, the watchlist splits open and ended, and Remove works", async ({ page, context }) => {
    const seller = await createUser({ role: "seller" });
    const live = await createAuction({ seller });
    const ended = await createAuction({ seller, status: "sold", startsAt: iso(-5 * DAY), endsAt: iso(-DAY) });
    const user = await createUser();
    await watch(user.email, live.id);
    await watch(user.email, ended.id);
    const { data } = await service().from("auctions").select("watch_count").eq("id", live.id).single();
    expect(data!.watch_count).toBe(1);

    await signIn(context, user);
    await page.goto("/account/watchlist");
    await expect(page.getByRole("heading", { level: 1, name: "Watchlist" })).toBeVisible();
    await expect(page.locator(`a[href="/auctions/${live.id}"]`).first()).toBeVisible();
    await expect(page.locator(`a[href="/auctions/${ended.id}"]`)).toHaveCount(0);
    await expectAccessible(page, "Watchlist");
    await page.getByRole("navigation", { name: "Watchlist" }).getByRole("link", { name: /^Ended/ }).click();
    await expect(page.locator(`a[href="/auctions/${ended.id}"]`).first()).toBeVisible();
    await page.goto("/account/watchlist");
    await page.getByRole("button", { name: `Remove ${live.title} from your watchlist` }).click();
    await expect(page.locator(`a[href="/auctions/${live.id}"]`)).toHaveCount(0);
    await expect.poll(async () => (await service().from("auctions").select("watch_count").eq("id", live.id).single()).data!.watch_count).toBe(0);
  });

  test("you can't add to or read someone else's watchlist", async () => {
    const a = await createAuction({ seller: await createUser({ role: "seller" }) });
    const victim = await createUser();
    await watch(victim.email, a.id);
    const other = await userDb((await createUser()).email);
    expect((await other.from("watchlist").select("user_id").eq("user_id", victim.id)).data ?? []).toHaveLength(0);
    expect((await other.from("watchlist").insert({ user_id: victim.id, auction_id: a.id })).error).not.toBeNull();
  });
});
