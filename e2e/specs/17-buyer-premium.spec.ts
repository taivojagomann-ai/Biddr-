// Area 17: the winner pays the buyer's premium. Settlement (partial capture from
// the €500 hold, the remainder off-session, the full premium when the hold
// expired, authentication required, declined), the winner's My purchases page
// and "Complete payment", the contact exchange only after payment, and the
// admin's Payments page (retry, cancel, refund). Stripe is stripe-mock plus the
// test-only simulator in lib/stripe-sim.ts.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import type { APIRequestContext } from "@playwright/test";
import { test, expect, signIn, expectAccessible } from "../support/fixtures";
import { APP_URL, CRON_SECRET } from "../support/env";
import { bid, createAuction, createUser, getAuction, iso, notificationsFor, runJob, service, setAuction, type TestUser } from "../support/factory";
import { userDb } from "../support/supabase";

type Card = "ok" | "expired" | "authreq" | "declined";

interface Sold {
  auctionId: string;
  title: string;
  seller: TestUser;
  winner: TestUser;
  holdPi: string;
  paymentId: string;
}

/** A live auction the winner bids on with a €500 hold whose card behaves like `card`, then sold. */
async function soldAuction(winningBid: number, card: Card): Promise<Sold> {
  const seller = await createUser({ role: "seller", fullName: "Sella Seller", phone: "+37255512345" });
  const winner = await createUser({ verifiedBidder: true, fullName: "Wynn Winner", phone: "+358401234567" });
  const a = await createAuction({ seller, startingBid: winningBid });
  const holdPi = `pi_e2e_hold_${card}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  // Customer ids are unique per member, as in Stripe.
  const { error: customerError } = await service().from("profiles").update({ stripe_customer_id: `cus_e2e${winner.id.replace(/-/g, "")}` }).eq("id", winner.id);
  expect(customerError).toBeNull();
  await service().from("bid_holds").insert({ auction_id: a.id, user_id: winner.id, stripe_payment_intent_id: holdPi, amount: 500, status: "authorized" });
  expect((await bid(winner, a.id, winningBid)).error).toBeNull();
  await setAuction(a.id, { ends_at: iso(-1000) });
  await runJob("advance_auction_states");
  expect((await getAuction<{ status: string }>(a.id)).status).toBe("sold");
  const { data } = await service().from("buyer_payments").select("id").eq("auction_id", a.id).single();
  return { auctionId: a.id, title: a.title, seller, winner, holdPi, paymentId: data!.id as string };
}

async function settle(request: APIRequestContext) {
  const res = await request.get(`${APP_URL}/api/stripe/settle`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
  expect(res.status()).toBe(200);
}

async function payment(id: string) {
  const { data } = await service().from("buyer_payments").select("*").eq("id", id).single();
  return data as Record<string, unknown> & { status: string; captured_from_hold: number | null; remainder_payment_intent_id: string | null };
}

/** The winner "pays in the browser" (Stripe Elements can't run in the tests): the simulator reads this list. */
function markPaidInBrowser(pi: string) {
  const file = "e2e/.state/stripe-sim-paid.json";
  mkdirSync("e2e/.state", { recursive: true });
  const list = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as string[]) : [];
  writeFileSync(file, JSON.stringify([...list, pi]));
}

test.describe("settlement", () => {
  test("a premium under €500 is captured from the hold (partial capture) and paid", async ({ request }) => {
    const s = await soldAuction(5_000, "ok");
    expect(await payment(s.paymentId)).toMatchObject({ status: "pending", premium_amount: 350, winning_bid: 5_000, hold_payment_intent_id: s.holdPi });
    await settle(request);
    const p = await payment(s.paymentId);
    expect(p).toMatchObject({ status: "paid", captured_from_hold: 350, remainder_payment_intent_id: null });
    expect(p.receipt_url).toContain(s.holdPi);
    const { data: hold } = await service().from("bid_holds").select("status").eq("stripe_payment_intent_id", s.holdPi).single();
    expect(hold!.status).toBe("captured");
    expect(await notificationsFor(s.winner, "premium_paid")).toHaveLength(1);
    expect(await notificationsFor(s.seller, "premium_paid")).toHaveLength(1);
    // Running again changes nothing (idempotent).
    await settle(request);
    expect((await payment(s.paymentId)).status).toBe("paid");
    expect(await notificationsFor(s.winner, "premium_paid")).toHaveLength(1);
  });

  test("above €500: €500 from the hold, the rest charged to the saved card", async ({ request }) => {
    const s = await soldAuction(30_000, "ok"); // premium €1,500
    await settle(request);
    const p = await payment(s.paymentId);
    expect(p).toMatchObject({ status: "paid", premium_amount: 1_500, captured_from_hold: 500 });
    expect(p.remainder_payment_intent_id).toMatch(/^pi_e2e_new_100000_/);
  });

  test("an expired hold: the full premium is charged to the saved card", async ({ request }) => {
    const s = await soldAuction(30_000, "expired");
    await settle(request);
    const p = await payment(s.paymentId);
    expect(p).toMatchObject({ status: "paid", captured_from_hold: 0 });
    expect(p.remainder_payment_intent_id).toMatch(/^pi_e2e_new_150000_/);
    const { data: hold } = await service().from("bid_holds").select("status").eq("stripe_payment_intent_id", s.holdPi).single();
    expect(hold!.status).toBe("released");
  });

  test("demo listings never get a payment", async () => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({ seller, isDemo: true, status: "live" });
    await service().from("auctions").update({ current_bid: 20_000, bid_count: 1, leading_bidder_id: seller.id, reserve_met: true }).eq("id", a.id);
    await setAuction(a.id, { status: "sold" });
    const { count } = await service().from("buyer_payments").select("id", { count: "exact", head: true }).eq("auction_id", a.id);
    expect(count).toBe(0);
  });
});

test.describe("the winner", () => {
  test("authentication required: action needed within 72 hours, then Complete payment pays it; contacts only after payment", async ({ page, context, request }) => {
    const s = await soldAuction(30_000, "authreq");
    await settle(request);
    let p = await payment(s.paymentId);
    expect(p).toMatchObject({ status: "action_required", captured_from_hold: 500 });
    const hours = (Date.parse(p.due_at as string) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(71);
    expect(hours).toBeLessThanOrEqual(72);
    const due = await notificationsFor(s.winner, "premium_due");
    expect(due).toHaveLength(1);
    expect(due[0]!.data).toMatchObject({ reason: "action_required" });

    // My purchases: plain status, breakdown, due date, Complete payment; no contacts yet.
    await signIn(context, s.winner);
    await page.goto("/account/purchases");
    const item = page.getByRole("article", { name: s.title });
    await expect(item).toContainText("€30,000");
    await expect(item).toContainText("€1,500");
    await expect(item).toContainText("Your bank needs you to confirm the payment.");
    await expect(item).toContainText("Please pay by");
    await expect(item.getByText("Seller's contact details")).toHaveCount(0);
    await expect(page.getByText("+37255512345")).toHaveCount(0);
    await expectAccessible(page, "My purchases, payment needed");

    // The seller doesn't see the winner's details yet either.
    const sellerCtx = await page.context().browser()!.newContext();
    await signIn(sellerCtx, s.seller);
    const sellerPage = await sellerCtx.newPage();
    await sellerPage.goto("/account/listings");
    await expect(sellerPage.getByText("Waiting for the buyer to pay the buyer's premium.")).toBeVisible();
    await expect(sellerPage.getByText("Wynn Winner")).toHaveCount(0);

    // Complete payment: the server starts an on-session payment for what's left (€1,000).
    const intent = await page.request.post("/api/stripe/premium/intent", { data: { auctionId: s.auctionId } });
    expect(intent.status()).toBe(200);
    const { clientSecret, amountEur } = (await intent.json()) as { clientSecret: string; amountEur: number };
    expect(amountEur).toBe(1_000);
    const pi = clientSecret.replace(/_secret_.*$/, "");
    // Not paid yet: the confirm route refuses.
    expect((await page.request.post("/api/stripe/premium/confirm", { data: { paymentIntentId: pi } })).status()).toBe(409);
    markPaidInBrowser(pi);
    expect((await page.request.post("/api/stripe/premium/confirm", { data: { paymentIntentId: pi } })).status()).toBe(200);
    p = await payment(s.paymentId);
    expect(p.status).toBe("paid");

    // Now the contact details show for both, with the note.
    await page.reload();
    await expect(item).toContainText("Paid");
    const card = item.getByRole("region", { name: "Seller's contact details" });
    await expect(card).toContainText("Sella Seller");
    await expect(card).toContainText("+37255512345");
    await expect(card).toContainText(s.seller.email);
    await expect(card).toContainText("Arrange payment for the car and the handover directly with each other.");
    await expect(item.getByRole("link", { name: /View the receipt/ })).toHaveAttribute("href", /receipts/);
    await sellerPage.reload();
    const buyer = sellerPage.getByRole("region", { name: "Buyer's contact details" });
    await expect(buyer).toContainText("Wynn Winner");
    await expect(buyer).toContainText("+358401234567");
    await expect(buyer).toContainText(s.winner.email);
    await sellerCtx.close();
  });

  test("a declined card: failed, the winner and admins are told; nobody else can read or change the payment", async ({ request, seed }) => {
    const s = await soldAuction(30_000, "declined");
    await settle(request);
    const p = await payment(s.paymentId);
    expect(p).toMatchObject({ status: "failed", failure_reason: "Your card was declined." });
    expect((await notificationsFor(s.winner, "premium_due"))[0]!.data).toMatchObject({ reason: "failed" });
    expect((await notificationsFor(seed.admin, "premium_failed")).filter((n) => n.auction_id === s.auctionId)).toHaveLength(1);

    // RLS: a stranger reads nothing; the winner can read but not write.
    const stranger = await userDb((await createUser()).email);
    expect((await stranger.from("buyer_payments").select("id").eq("id", s.paymentId)).data ?? []).toHaveLength(0);
    const winnerDb = await userDb(s.winner.email);
    expect((await winnerDb.from("buyer_payments").select("id").eq("id", s.paymentId)).data ?? []).toHaveLength(1);
    await winnerDb.from("buyer_payments").update({ status: "paid" }).eq("id", s.paymentId);
    expect((await payment(s.paymentId)).status).toBe("failed");
  });
});

test.describe("admin: Payments page", () => {
  test("filters, Stripe links, Retry charge and Mark as cancelled", async ({ page, context, seed, request }) => {
    const s = await soldAuction(30_000, "declined");
    await settle(request);
    await signIn(context, seed.admin);
    await page.goto("/admin/payments?status=failed");
    await expect(page.getByRole("link", { name: "Failed" })).toHaveAttribute("aria-current", "page");
    const row = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: s.title }) });
    await expect(row).toContainText("Your card was declined.");
    await expect(row.getByRole("link", { name: /Card hold in Stripe/ })).toHaveAttribute("href", `https://dashboard.stripe.com/test/payments/${s.holdPi}`);
    await expectAccessible(page, "Admin payments");

    await row.getByRole("button", { name: `Retry charge: ${s.title}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Retry charge" }).click();
    await expect(page.getByText("The charge failed again. The winner has been told.")).toBeVisible();

    await page.reload();
    const again = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: s.title }) });
    await again.getByRole("button", { name: `Mark as cancelled: ${s.title}` }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Mark as cancelled" })).toBeDisabled();
    await dialog.getByLabel("Reason (kept in the admin log)").fill("Buyer and seller agreed to cancel the sale.");
    await dialog.getByRole("button", { name: "Mark as cancelled" }).click();
    await expect.poll(async () => (await payment(s.paymentId)).status).toBe("cancelled");
    const { data: log } = await service().from("admin_actions").select("action").eq("auction_id", s.auctionId);
    expect((log ?? []).map((l) => l.action)).toEqual(expect.arrayContaining(["payment.retry", "payment.cancel"]));
  });

  test("Refund premium after a confirmation", async ({ page, context, seed, request }) => {
    const s = await soldAuction(30_000, "ok");
    await settle(request);
    expect((await payment(s.paymentId)).status).toBe("paid");
    await signIn(context, seed.admin);
    await page.goto("/admin/payments?status=paid");
    const row = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: s.title }) });
    await row.getByRole("button", { name: `Refund premium: ${s.title}` }).click();
    const dialog = page.getByRole("dialog", { name: "Refund €1,500 to the winner?" });
    await dialog.getByRole("button", { name: "Refund premium" }).click();
    await expect.poll(async () => (await payment(s.paymentId)).status).toBe("refunded");
    await expect.poll(async () => ((await service().from("admin_actions").select("action").eq("auction_id", s.auctionId)).data ?? []).map((l) => l.action)).toContain("payment.refund");
  });
});
