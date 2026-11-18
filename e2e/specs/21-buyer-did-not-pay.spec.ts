// Area 21: when the winner doesn't pay the buyer's premium (DECISIONS.md point 12).
// The 24-hour reminder; after 72 hours "Buyer didn't pay": the hold amount kept and
// invoiced, the winner blocked from bidding (holds, bids, the bid dialog, profile);
// the seller offers the car to the next bidder (accept and pay, or decline, or let it
// expire) or relists it; "Pay the seller by" and "Sale completed"; Admin → Users.
import type { Page } from "@playwright/test";
import { test, expect, signIn, expectAccessible } from "../support/fixtures";
import { createAuction, createUser, getAuction, notificationsFor, service, type TestUser } from "../support/factory";
import { markPaidInBrowser, payment, settle, soldAuction, type Sold } from "../support/premium";
import { userDb } from "../support/supabase";

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

/** A sale whose winner's bank wants confirmation (so it waits for them), with a second bidder. */
async function waitingSale(request: Parameters<typeof settle>[0]): Promise<Sold & { runner: TestUser }> {
  const s = await soldAuction(12_000, "authreq", { runnerUp: 10_000 });
  await settle(request);
  expect((await payment(s.paymentId)).status).toBe("action_required");
  return s as Sold & { runner: TestUser };
}

/** Moves the deadline into the past and runs the job: the winner didn't pay. */
async function expire(request: Parameters<typeof settle>[0], paymentId: string) {
  await service().from("buyer_payments").update({ due_at: hoursFromNow(-0.1) }).eq("id", paymentId);
  await settle(request);
}

async function offerFor(auctionId: string) {
  const { data } = await service().from("second_chance_offers").select("*").eq("auction_id", auctionId).order("created_at", { ascending: false });
  return (data ?? [])[0] as { id: string; status: string; amount: number; premium_amount: number; bidder_id: string; expires_at: string } | undefined;
}

async function confirmIn(page: Page, button: string, confirm: string) {
  await page.getByRole("button", { name: button }).click();
  await page.getByRole("dialog").getByRole("button", { name: confirm, exact: true }).click();
}

test.describe("deadlines", () => {
  test.skip(({ isMobile }) => isMobile, "no screen involved: runs once");

  test("one reminder 24 hours before the deadline", async ({ request }) => {
    const s = await waitingSale(request);
    await service().from("buyer_payments").update({ due_at: hoursFromNow(23) }).eq("id", s.paymentId);
    await settle(request);
    await settle(request);
    const reminders = await notificationsFor(s.winner, "premium_reminder");
    expect(reminders).toHaveLength(1);
    expect(reminders[0]!.auction_id).toBe(s.auctionId);
  });

  test("after 72 hours: Buyer didn't pay, the hold part is kept and invoiced, the winner blocked, seller and admins told", async ({ request, seed }) => {
    const s = await waitingSale(request);
    await expire(request, s.paymentId);
    const p = await payment(s.paymentId);
    expect(p).toMatchObject({ status: "unpaid", captured_from_hold: 500, due_at: null });
    expect(p.unpaid_at).toBeTruthy();

    const { data: profile } = await service().from("profiles").select("bidding_blocked_at, bidding_block_reason").eq("id", s.winner.id).single();
    expect(profile!.bidding_blocked_at).toBeTruthy();
    expect(profile!.bidding_block_reason).toBe(`The buyer's premium for ${s.title} wasn't paid in time.`);
    expect(await notificationsFor(s.winner, "premium_unpaid")).toHaveLength(1);
    expect((await notificationsFor(s.seller, "buyer_did_not_pay"))[0]!.data).toMatchObject({ role: "seller" });
    expect((await notificationsFor(seed.admin, "buyer_did_not_pay")).some((n) => n.auction_id === s.auctionId)).toBe(true);

    // The €500 kept from the hold gets an invoice; nothing more is owed.
    const { data: invoices } = await service().from("invoices").select("kind, total_cents, details").eq("buyer_payment_id", s.paymentId);
    expect(invoices).toHaveLength(1);
    expect(invoices![0]).toMatchObject({ kind: "invoice", total_cents: 50_000 });
    expect((invoices![0]!.details as { line: { description: string } }).line.description).toContain("part kept from the card hold");

    // Running again changes nothing.
    await settle(request);
    expect((await payment(s.paymentId)).status).toBe("unpaid");
    expect(await notificationsFor(s.winner, "premium_unpaid")).toHaveLength(1);
  });
});

test.describe("a blocked winner", () => {
  test("can't place holds or bids; the bid dialog, My purchases and the profile say why", async ({ page, context, request }) => {
    const s = await waitingSale(request);
    await expire(request, s.paymentId);
    const seller = await createUser({ role: "seller" });
    const other = await createAuction({ seller });

    // The database refuses: bidder_status says so, and a bid is refused even with a hold.
    const db = await userDb(s.winner.email);
    const { data: status } = await db.rpc("bidder_status");
    expect(status).toMatchObject({ blocked: true, blocked_reason: `The buyer's premium for ${s.title} wasn't paid in time.` });
    await service().from("bid_holds").insert({ auction_id: other.id, user_id: s.winner.id, stripe_payment_intent_id: `pi_e2e_hold_ok_blk${Date.now()}`, amount: 500, status: "authorized" });
    const bidResult = await db.rpc("place_bid", { p_auction_id: other.id, p_amount: 50_000 });
    expect(bidResult.error?.message).toBe("BIDDING_BLOCKED");

    await signIn(context, s.winner);
    // No new card holds.
    const hold = await page.request.post("/api/stripe/hold", { data: { auctionId: other.id } });
    expect(hold.status()).toBe(403);
    expect(await hold.json()).toMatchObject({ code: "BIDDING_BLOCKED" });

    // The bid dialog explains, with a Close button.
    await page.goto(`/auctions/${other.id}`);
    await page.getByRole("button", { name: /^(Bid €[\d,]+|Place bid)$/ }).locator("visible=true").first().click();
    const dialog = page.getByRole("dialog", { name: "Your bidding is blocked" });
    await expect(dialog).toContainText(`The buyer's premium for ${s.title} wasn't paid in time.`);
    await dialog.getByRole("button", { name: "Back to the car" }).click();
    await expect(dialog).toHaveCount(0);

    // My purchases: the block, and what happened to the sale.
    await page.goto("/account/purchases");
    await expect(page.getByRole("region", { name: "Your bidding is blocked" })).toBeVisible();
    const item = page.getByRole("article", { name: s.title });
    await expect(item).toContainText("Not paid in time: the sale was cancelled.");
    await expect(item).toContainText("the €500 taken from your card hold isn't refunded");
    await expect(item.getByRole("button", { name: /Complete payment/ })).toHaveCount(0);
    await expect(item.getByRole("link", { name: /^View invoice BID-/ })).toBeVisible();
    await expectAccessible(page, "My purchases, blocked");

    await page.goto("/account/setup");
    await expect(page.getByRole("region", { name: "Your bidding is blocked" })).toBeVisible();
  });
});

test.describe("the seller's choices", () => {
  test.describe.configure({ timeout: 150_000 });

  test("offer to the next bidder: they accept and pay; contacts, Pay the seller by, Sale completed", async ({ page, context, request, browser }) => {
    const s = await waitingSale(request);
    await expire(request, s.paymentId);

    await signIn(context, s.seller);
    await page.goto("/account/listings");
    const panel = page.getByRole("region", { name: "The buyer didn't pay" });
    await expect(panel).toBeVisible();
    await expectAccessible(page, "My listings, buyer didn't pay");
    await confirmIn(page, `Offer to the next bidder (€10,000): ${s.title}`, "Send the offer");
    await expect(page.getByText(/Offered to the next bidder for €10,000/)).toBeVisible();
    const offer = await offerFor(s.auctionId);
    expect(offer).toMatchObject({ status: "pending", amount: 10_000, premium_amount: 500, bidder_id: s.runner.id });
    const hours = (Date.parse(offer!.expires_at) - Date.now()) / 3_600_000;
    expect(hours).toBeGreaterThan(47.9);
    expect(hours).toBeLessThanOrEqual(48);
    expect((await notificationsFor(s.runner, "second_chance_offer"))[0]!.data).toMatchObject({ amount: 10_000 });

    // The next bidder accepts on My purchases, then pays the premium.
    const runnerCtx = await browser.newContext();
    await signIn(runnerCtx, s.runner);
    const rp = await runnerCtx.newPage();
    await rp.goto("/account/purchases");
    const offers = rp.getByRole("region", { name: "Second-chance offers" });
    await expect(offers.getByRole("article", { name: s.title })).toContainText("€10,000");
    await expectAccessible(rp, "My purchases, second-chance offer");
    await confirmIn(rp, `Accept and pay: ${s.title}`, "Accept");
    const item = rp.getByRole("article", { name: s.title });
    await expect(item.getByRole("button", { name: /Complete payment/ })).toBeVisible();
    expect((await offerFor(s.auctionId))!.status).toBe("accepted");
    // The seller sees it's accepted and waiting for payment.
    await page.reload();
    await expect(page.getByText(/The next bidder accepted your offer\. Waiting for them to pay/)).toBeVisible();

    const intent = await rp.request.post("/api/stripe/premium/intent", { data: { auctionId: s.auctionId } });
    expect(intent.status()).toBe(200);
    const { clientSecret, amountEur } = (await intent.json()) as { clientSecret: string; amountEur: number };
    expect(amountEur).toBe(500);
    const pi = clientSecret.replace(/_secret_.*$/, "");
    markPaidInBrowser(pi);
    expect((await rp.request.post("/api/stripe/premium/confirm", { data: { paymentIntentId: pi } })).status()).toBe(200);
    expect((await offerFor(s.auctionId))!.status).toBe("paid");

    await rp.reload();
    await expect(item).toContainText("Paid");
    await expect(item).toContainText("Pay the seller for the car by");
    await expect(item.getByRole("region", { name: "Seller's contact details" })).toContainText("Sella Seller");
    await expect(item.getByRole("link", { name: /^View invoice BID-/ })).toBeVisible();

    // The seller: the new buyer's details, then Sale completed.
    await page.reload();
    await expect(page.getByRole("region", { name: "Buyer's contact details" })).toContainText("Rhea Runner");
    await confirmIn(page, `Sale completed: ${s.title}`, "Yes, sale completed");
    await expect(page.getByText(/Sale completed on/)).toBeVisible();
    await rp.reload();
    await expect(item).toContainText("Sale completed (confirmed by the seller)");
    await runnerCtx.close();
  });

  test("the next bidder declines: the seller is told and can relist; relisting makes a new draft once", async ({ page, context, request, browser, seed }) => {
    const s = await waitingSale(request);
    await expire(request, s.paymentId);
    await signIn(context, s.seller);
    await page.goto("/account/listings");
    await confirmIn(page, `Offer to the next bidder (€10,000): ${s.title}`, "Send the offer");
    await expect(page.getByText(/Offered to the next bidder/)).toBeVisible();

    const runnerCtx = await browser.newContext();
    await signIn(runnerCtx, s.runner);
    const rp = await runnerCtx.newPage();
    await rp.goto("/account/purchases");
    await confirmIn(rp, `Decline: ${s.title}`, "Decline offer");
    await expect(rp.getByRole("region", { name: "Second-chance offers" })).toHaveCount(0);
    await runnerCtx.close();
    expect((await offerFor(s.auctionId))!.status).toBe("declined");
    expect((await notificationsFor(s.seller, "second_chance_closed"))[0]!.data).toMatchObject({ outcome: "declined" });

    // No other bidder left: only relisting.
    await page.reload();
    const panel = page.getByRole("region", { name: "The buyer didn't pay" });
    await expect(panel).toContainText("There's no other bidder to offer the car to.");
    await confirmIn(page, `Relist this car: ${s.title}`, "Relist");
    await expect(page.getByRole("link", { name: `See the new listing for ${s.title}` })).toBeVisible();

    const { data: drafts } = await service().from("auctions").select("id, status, title, vin, seller_id, current_bid, bid_count").eq("relisted_from", s.auctionId);
    expect(drafts).toHaveLength(1);
    const original = await getAuction<{ vin: string }>(s.auctionId);
    expect(drafts![0]).toMatchObject({ status: "draft", title: s.title, vin: original.vin, seller_id: s.seller.id, current_bid: null, bid_count: 0 });
    const { data: priv } = await service().from("auction_private").select("auction_id").eq("auction_id", drafts![0]!.id);
    expect(priv).toHaveLength(1);
    // Admins review it like any new listing.
    await expect.poll(async () => (await notificationsFor(seed.admin, "listing_submitted")).some((n) => n.auction_id === drafts![0]!.id)).toBe(true);
  });

  test("an offer not answered in 48 hours expires; an accepted offer not paid is cancelled without blocking the next bidder", async ({ request }) => {
    const s = await waitingSale(request);
    await expire(request, s.paymentId);
    const admin = service();
    // Offer, then let it lapse.
    await admin.from("second_chance_offers").insert({
      auction_id: s.auctionId, original_payment_id: s.paymentId, bidder_id: s.runner.id, seller_id: s.seller.id,
      amount: 10_000, premium_amount: 500, expires_at: hoursFromNow(-0.1),
    });
    await settle(request);
    expect((await offerFor(s.auctionId))!.status).toBe("expired");
    expect((await notificationsFor(s.seller, "second_chance_closed"))[0]!.data).toMatchObject({ outcome: "expired" });

    // A second-chance payment past its deadline: cancelled, and the bidder isn't blocked.
    const s2 = await waitingSale(request);
    await expire(request, s2.paymentId);
    const { data: offer } = await admin.from("second_chance_offers").insert({
      auction_id: s2.auctionId, original_payment_id: s2.paymentId, bidder_id: s2.runner.id, seller_id: s2.seller.id,
      amount: 10_000, premium_amount: 500, status: "accepted", expires_at: hoursFromNow(-0.1),
    }).select("id").single();
    const { data: p2 } = await admin.from("buyer_payments").insert({
      auction_id: s2.auctionId, winner_id: s2.runner.id, seller_id: s2.seller.id, winning_bid: 10_000, premium_amount: 500,
      captured_from_hold: 0, status: "action_required", due_at: hoursFromNow(-0.1), second_chance_offer_id: offer!.id,
    }).select("id").single();
    await settle(request);
    expect((await payment(p2!.id)).status).toBe("cancelled");
    expect((await offerFor(s2.auctionId))!.status).toBe("expired");
    const { data: runnerProfile } = await admin.from("profiles").select("bidding_blocked_at").eq("id", s2.runner.id).single();
    expect(runnerProfile!.bidding_blocked_at).toBeNull();
  });
});

test.describe("admin", () => {
  test.skip(({ isMobile }) => isMobile, "admin desktop");

  test("Payments lists Buyer didn't pay; Users lists the blocked winner and lifts the block with a reason", async ({ page, context, request, seed }) => {
    const s = await waitingSale(request);
    await expire(request, s.paymentId);
    await signIn(context, seed.admin);

    await page.goto("/admin/payments?status=unpaid");
    await expect(page.getByRole("link", { name: "Buyer didn't pay" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("listitem").filter({ has: page.getByRole("link", { name: s.title }) })).toBeVisible();

    await page.goto("/admin/users");
    const card = page.getByRole("article", { name: new RegExp(`^${s.winner.username}`) });
    await expect(card).toContainText(`The buyer's premium for ${s.title} wasn't paid in time.`);
    await expectAccessible(page, "Admin users");
    await card.getByRole("button", { name: `Lift block: ${s.winner.username}` }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("button", { name: "Lift block", exact: true })).toBeDisabled();
    await dialog.getByLabel("Reason (kept in the admin log)").fill("Paid by bank transfer, confirmed.");
    await dialog.getByRole("button", { name: "Lift block", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect
      .poll(async () => (await service().from("profiles").select("bidding_blocked_at").eq("id", s.winner.id).single()).data!.bidding_blocked_at)
      .toBeNull();
    // Unblocked members leave the list.
    await expect(card).toHaveCount(0);
    expect(await notificationsFor(s.winner, "bidding_unblocked")).toHaveLength(1);
    const { data: log } = await service().from("admin_actions").select("details").eq("action", "user.unblock").order("created_at", { ascending: false }).limit(5);
    expect((log ?? []).some((l) => (l.details as { user_id: string }).user_id === s.winner.id)).toBe(true);
    const { data: status } = await (await userDb(s.winner.email)).rpc("bidder_status");
    expect(status).toMatchObject({ blocked: false });
  });
});
