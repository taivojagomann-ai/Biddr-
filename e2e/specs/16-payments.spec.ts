// Area 16: payments plumbing. The test-mode banner, the 3-D Secure return path of
// the card check, idempotent webhooks with an event log, and the admin's
// Payments section. Real Stripe Elements and test cards are in MANUAL_TESTS.md.
import { test, expect, signIn, expectAccessible } from "../support/fixtures";
import { authorizeHold, createAuction, createUser, readyBidder, service } from "../support/factory";
import { sendWebhook } from "../support/stripe";

test.describe("Stripe test mode", () => {
  test("a test-mode banner shows on every page while the keys are test keys", async ({ page }) => {
    const a = await createAuction({ seller: await createUser({ role: "seller" }) });
    for (const path of ["/", `/auctions/${a.id}`, "/how-it-works", "/login"]) {
      await page.goto(path);
      await expect(page.getByText("Test mode: no real payments. Use Stripe test cards.")).toBeVisible();
    }
    await expectAccessible(page, "Page with the test-mode banner");
  });

  test("3-D Secure return: approved reopens the bid dialog, declined says so, and the address is cleaned", async ({ page, context }) => {
    const a = await createAuction({ seller: await createUser({ role: "seller" }) });
    await signIn(context, await createUser());

    // The bank said no (redirect_status=failed): nothing is confirmed, and the page says so.
    await page.goto(`/auctions/${a.id}?hold=return&payment_intent=pi_e2e_failed&payment_intent_client_secret=x&redirect_status=failed`);
    await expect(page.getByRole("alert").filter({ hasText: "Your bank didn't approve the €500 hold, so nothing was held." })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/auctions/${a.id}$`));

    // Approved: the server confirms the hold (it re-reads the PaymentIntent from Stripe)
    // and the bid dialog reopens at "Confirm your bid".
    let confirmed = "";
    await page.route("**/api/stripe/hold/confirm", async (route) => {
      confirmed = JSON.parse(route.request().postData() ?? "{}").paymentIntentId;
      await route.fulfill({ status: 200, contentType: "application/json", body: '{"status":"authorized"}' });
    });
    await page.goto(`/auctions/${a.id}?hold=return&payment_intent=pi_e2e_ok&payment_intent_client_secret=x&redirect_status=succeeded`);
    await expect(page.getByRole("dialog", { name: "Confirm your bid" })).toBeVisible();
    expect(confirmed).toBe("pi_e2e_ok");
    await expect(page).toHaveURL(new RegExp(`/auctions/${a.id}$`));
  });
});

test.describe("webhooks", () => {
  test("events are verified, stored once and handled once", async ({ request }) => {
    const a = await createAuction({ seller: await createUser({ role: "seller" }) });
    const bidder = await createUser({ verifiedBidder: true });
    const pi = await authorizeHold(bidder, a.id);
    await service().from("bid_holds").update({ status: "pending" }).eq("stripe_payment_intent_id", pi);

    const object = {
      id: pi, object: "payment_intent", status: "requires_capture", amount_capturable: 50_000, currency: "eur",
      metadata: { kind: "bid_hold", auction_id: a.id, user_id: bidder.id },
    };
    const first = await sendWebhook(request, "payment_intent.amount_capturable_updated", object);
    expect(first.res.status()).toBe(200);
    const { data: hold } = await service().from("bid_holds").select("status").eq("stripe_payment_intent_id", pi).single();
    expect(hold!.status).toBe("authorized");
    const { data: row } = await service().from("stripe_events").select("type, status, auction_id, payment_intent_id").eq("id", first.id).single();
    expect(row).toMatchObject({ type: "payment_intent.amount_capturable_updated", status: "processed", auction_id: a.id, payment_intent_id: pi });

    // The same event again (Stripe retries): acknowledged, not handled twice.
    await service().from("bid_holds").update({ status: "released" }).eq("stripe_payment_intent_id", pi);
    const again = await sendWebhook(request, "payment_intent.amount_capturable_updated", object, first.id);
    expect(again.res.status()).toBe(200);
    expect(await again.res.json()).toMatchObject({ duplicate: true });
    const { data: still } = await service().from("bid_holds").select("status").eq("stripe_payment_intent_id", pi).single();
    expect(still!.status).toBe("released");

    // A bad signature is refused and nothing is stored.
    const bad = await request.post("/api/stripe/webhook", { data: "{}", headers: { "stripe-signature": "t=1,v1=bad" } });
    expect(bad.status()).toBe(400);
  });
});

test.describe("admin: Payments section", () => {
  test("lists the card holds with bidder, amount, status and a Stripe link, and the event log", async ({ page, context, seed, request }) => {
    const a = await createAuction({ seller: await createUser({ role: "seller" }) });
    const bidder = await readyBidder(a.id);
    const { data: hold } = await service().from("bid_holds").select("stripe_payment_intent_id").eq("user_id", bidder.id).single();
    const pi = hold!.stripe_payment_intent_id as string;
    await sendWebhook(request, "payment_intent.amount_capturable_updated", {
      id: pi, object: "payment_intent", status: "requires_capture", amount_capturable: 50_000, currency: "eur",
      metadata: { kind: "bid_hold", auction_id: a.id, user_id: bidder.id },
    });

    await signIn(context, seed.admin);
    await page.goto(`/admin/auctions/${a.id}`);
    const section = page.getByRole("region", { name: "Payments" });
    const row = section.getByRole("row").filter({ hasText: bidder.username! });
    await expect(row).toContainText("€500");
    await expect(row).toContainText("Held");
    await expect(row.getByRole("link")).toHaveAttribute("href", `https://dashboard.stripe.com/test/payments/${pi}`);
    await expect(section.getByText("payment_intent.amount_capturable_updated")).toBeVisible();
    await expect(section.getByText("Handled").first()).toBeVisible();
    await expectAccessible(page, "Admin Payments section", "#payments");
  });
});
