// Shared by the buyer's premium (17) and invoice (20) specs: a sold auction with a
// winner whose test card behaves as asked, and the settlement job.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import type { APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";
import { APP_URL, CRON_SECRET } from "./env";
import { bid, createAuction, createUser, getAuction, iso, notificationsFor, runJob, service, setAuction, type TestUser } from "./factory";

export type Card = "ok" | "expired" | "authreq" | "declined";

export interface Sold {
  auctionId: string;
  title: string;
  seller: TestUser;
  winner: TestUser;
  holdPi: string;
  paymentId: string;
  /** With `runnerUp`: the second-highest bidder. */
  runner?: TestUser;
}

/** A live auction the winner bids on with a €500 hold whose card behaves like `card`, then sold. */
export async function soldAuction(winningBid: number, card: Card, o: { country?: string; runnerUp?: number } = {}): Promise<Sold> {
  const seller = await createUser({ role: "seller", fullName: "Sella Seller", phone: "+37255512345" });
  const winner = await createUser({ verifiedBidder: true, fullName: "Wynn Winner", phone: "+358401234567" });
  const a = await createAuction({ seller, startingBid: o.runnerUp ?? winningBid, country: o.country });
  let runner: TestUser | undefined;
  if (o.runnerUp) {
    // A second bidder, outbid by the winner.
    runner = await createUser({ verifiedBidder: true, fullName: "Rhea Runner", phone: "+37155512345" });
    await service().from("profiles").update({ stripe_customer_id: `cus_e2e${runner.id.replace(/-/g, "")}` }).eq("id", runner.id);
    const runnerHold = `pi_e2e_hold_ok_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await service().from("bid_holds").insert({ auction_id: a.id, user_id: runner.id, stripe_payment_intent_id: runnerHold, amount: 500, status: "authorized" });
    expect((await bid(runner, a.id, o.runnerUp)).error).toBeNull();
  }
  const holdPi = `pi_e2e_hold_${card}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  // Customer ids are unique per member, as in Stripe.
  const { error: customerError } = await service().from("profiles").update({ stripe_customer_id: `cus_e2e${winner.id.replace(/-/g, "")}` }).eq("id", winner.id);
  expect(customerError).toBeNull();
  await service().from("bid_holds").insert({ auction_id: a.id, user_id: winner.id, stripe_payment_intent_id: holdPi, amount: 500, status: "authorized" });
  expect((await bid(winner, a.id, winningBid)).error).toBeNull();
  await setAuction(a.id, { ends_at: iso(-1000) });
  // The job can briefly lag a parallel test's run of it: try again until the car is sold.
  await expect
    .poll(async () => {
      await runJob("advance_auction_states");
      return (await getAuction<{ status: string }>(a.id)).status;
    })
    .toBe("sold");
  const { data } = await service().from("buyer_payments").select("id").eq("auction_id", a.id).single();
  return { auctionId: a.id, title: a.title, seller, winner, holdPi, paymentId: data!.id as string, runner };
}

export async function settle(request: APIRequestContext) {
  const res = await request.get(`${APP_URL}/api/stripe/settle`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
  expect(res.status()).toBe(200);
  // The sale also starts a settlement by itself (pg_net): if that attempt was still
  // running, this call skipped the row. Wait until no attempt is in flight.
  await expect
    .poll(
      async () => {
        const { count } = await service()
          .from("buyer_payments")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending")
          .gt("last_attempt_at", new Date(Date.now() - 2 * 60_000).toISOString());
        return count ?? 0;
      },
      { timeout: 30_000 },
    )
    .toBe(0);
}

export async function payment(id: string) {
  const { data } = await service().from("buyer_payments").select("*").eq("id", id).single();
  return data as Record<string, unknown> & { status: string; captured_from_hold: number | null; remainder_payment_intent_id: string | null };
}

/** The winner "pays in the browser" (Stripe Elements can't run in the tests): the simulator reads this list. */
export function markPaidInBrowser(pi: string) {
  const file = "e2e/.state/stripe-sim-paid.json";
  mkdirSync("e2e/.state", { recursive: true });
  const list = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as string[]) : [];
  writeFileSync(file, JSON.stringify([...list, pi]));
}
