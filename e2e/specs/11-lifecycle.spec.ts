// Area 11: the auction lifecycle (the scheduled advance_auction_states job, run
// directly) and card holds released through /api/stripe/release against stripe-mock.
import { test, expect } from "../support/fixtures";
import { APP_URL, CRON_SECRET } from "../support/env";
import { authorizeHold, bid, createAuction, createUser, getAuction, iso, DAY, HOUR, readyBidder, runJob, service, setAuction } from "../support/factory";

type Status = { status: string; leading_bidder_id: string | null };

test.describe("auction lifecycle", () => {
  test("advance_auction_states opens due auctions and closes ended ones as sold, reserve not met or ended", async ({ page }) => {
    const seller = await createUser({ role: "seller" });
    const due = await createAuction({ seller, status: "upcoming", startsAt: iso(DAY), endsAt: iso(3 * DAY) });
    const notYet = await createAuction({ seller, status: "upcoming", startsAt: iso(DAY), endsAt: iso(3 * DAY) });
    const sold = await createAuction({ seller, startingBid: 10_000, reserve: 9_000 });
    const short = await createAuction({ seller, startingBid: 10_000, reserve: 15_000 });
    const empty = await createAuction({ seller });
    const running = await createAuction({ seller, endsAt: iso(2 * HOUR) });
    const winner = await readyBidder(sold.id);
    await bid(winner, sold.id, 10_000);
    await bid(await readyBidder(short.id), short.id, 10_000);

    await setAuction(due.id, { starts_at: iso(-60_000) });
    for (const a of [sold, short, empty]) await setAuction(a.id, { ends_at: iso(-1000) });
    await runJob("advance_auction_states");

    const status = async (id: string) => (await getAuction<Status>(id)).status;
    expect(await status(due.id)).toBe("live");
    expect(await status(notYet.id)).toBe("upcoming");
    expect(await status(sold.id)).toBe("sold");
    expect((await getAuction<Status>(sold.id)).leading_bidder_id).toBe(winner.id);
    expect(await status(short.id)).toBe("reserve_not_met");
    expect(await status(empty.id)).toBe("ended");
    expect(await status(running.id)).toBe("live");

    // Running it again changes nothing.
    await runJob("advance_auction_states");
    expect(await status(sold.id)).toBe("sold");

    // The closed pages show the result and no bid button.
    await page.goto(`/auctions/${sold.id}`);
    await expect(page.getByText(/Sold/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /^(Bid €|Place bid)/ })).toHaveCount(0);
    await page.goto(`/auctions/${short.id}`);
    await expect(page.getByText(/Reserve not met/i).first()).toBeVisible();
  });

  test("bids are refused once the end time has passed, even before the job runs", async () => {
    const a = await createAuction({ seller: await createUser({ role: "seller" }) });
    const b = await readyBidder(a.id);
    await setAuction(a.id, { ends_at: iso(-1000) });
    expect((await bid(b, a.id, 50_000)).error?.message).toBe("AUCTION_ENDED");
  });
});

test.describe("card holds", () => {
  async function release(request: import("@playwright/test").APIRequestContext) {
    const res = await request.get(`${APP_URL}/api/stripe/release`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(res.status()).toBe(200);
    return (await res.json()) as { released: number; failures: string[] };
  }
  const holdStatus = async (id: string) => (await service().from("bid_holds").select("status").eq("id", id).single()).data!.status as string;
  const holdId = async (userId: string, auctionId: string) =>
    (await service().from("bid_holds").select("id").eq("user_id", userId).eq("auction_id", auctionId).single()).data!.id as string;

  test("the release job needs the cron secret", async ({ request }) => {
    expect((await request.get(`${APP_URL}/api/stripe/release`)).status()).toBe(401);
    expect((await request.get(`${APP_URL}/api/stripe/release`, { headers: { authorization: "Bearer wrong" } })).status()).toBe(401);
  });

  test("after a sale the losers' holds are released and the winner's kept; live auctions are untouched", async ({ request }) => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({ seller, startingBid: 10_000 });
    const live = await createAuction({ seller });
    const withdrawn = await createAuction({ seller });
    const [winner, loser] = [await readyBidder(a.id), await readyBidder(a.id)];
    await bid(loser, a.id, 10_000);
    await bid(winner, a.id, 11_000);
    const liveBidder = await readyBidder(live.id);
    const quitter = await createUser({ verifiedBidder: true });
    await authorizeHold(quitter, withdrawn.id);
    await setAuction(a.id, { ends_at: iso(-1000) });
    await runJob("advance_auction_states");
    await setAuction(withdrawn.id, { status: "withdrawn" });

    const [winnerHold, loserHold, liveHold, withdrawnHold] = [
      await holdId(winner.id, a.id),
      await holdId(loser.id, a.id),
      await holdId(liveBidder.id, live.id),
      await holdId(quitter.id, withdrawn.id),
    ];
    // Other tests leave closed auctions with holds too; the job works through them 100 at a time.
    for (let i = 0; i < 30 && ((await holdStatus(loserHold)) !== "released" || (await holdStatus(withdrawnHold)) !== "released"); i++) {
      const r = await release(request);
      expect(r.failures).toEqual([]);
    }
    expect(await holdStatus(loserHold)).toBe("released");
    expect(await holdStatus(withdrawnHold)).toBe("released");
    expect(await holdStatus(winnerHold)).toBe("authorized");
    expect(await holdStatus(liveHold)).toBe("authorized");
  });

  test.fixme("holds are released automatically on a schedule", async () => {
    // vercel.json no longer schedules /api/stripe/release, so in production holds
    // are only released when someone calls it. Needs a decision: restore the cron
    // or release holds another way (for example from advance_auction_states).
  });
});
