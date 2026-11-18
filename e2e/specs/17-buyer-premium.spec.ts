// Area 17: the winner pays the buyer's premium. Settlement (partial capture from
// the €500 hold, the remainder off-session, the full premium when the hold
// expired, authentication required, declined), the winner's My purchases page
// and "Complete payment", the contact exchange only after payment, and the
// admin's Payments page (retry, cancel, refund). Stripe is stripe-mock plus the
// test-only simulator in lib/stripe-sim.ts.
import { test, expect, signIn, expectAccessible } from "../support/fixtures";
import { createAuction, createUser, notificationsFor, service, setAuction } from "../support/factory";
import { markPaidInBrowser, payment, settle, soldAuction } from "../support/premium";
import { userDb } from "../support/supabase";

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
    // The invoice for the whole premium replaces Stripe's receipt (spec 20 checks the PDF).
    await expect(item.getByRole("link", { name: /^Download invoice BID-\d{4}-\d{5} \(PDF\)/ })).toHaveAttribute("href", /^\/api\/invoices\//);
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
