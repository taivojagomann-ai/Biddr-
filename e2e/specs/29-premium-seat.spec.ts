// Area 29: buying a premium seat (DECISIONS.md points 9 and 11). The seller pays once
// (Stripe, simulated: lib/stripe-sim.ts; the Payment Element can't run in the tests, so the
// test "pays in the browser" like spec 17), the car is featured with the "Featured" label
// until the auction ends, with an invoice and a receipt. At most N paid seats at once (admin
// setting), with "notify me". Refunds: automatic when withdrawn before going live or when an
// admin removes the seat; after going live only by hand.
import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, signIn, expectAccessible } from "../support/fixtures";
import { createAuction, createUser, getAuction, iso, notificationsFor, service, DAY, HOUR, type TestUser } from "../support/factory";
import { markPaidInBrowser } from "../support/premium";

test.describe.configure({ mode: "serial" });
test.skip(({ isMobile }) => isMobile, "payments and settings: runs once (the dialog is checked on desktop)");

async function setSettings(price: number, limit: number) {
  await service().from("site_settings").upsert([
    { key: "premium_seat_price_eur", value: price },
    { key: "premium_seat_limit", value: limit },
  ]);
}

async function activePaid(): Promise<number> {
  const { count } = await service()
    .from("auctions")
    .select("id", { count: "exact", head: true })
    .eq("premium_seat_source", "paid")
    .gt("premium_seat_until", new Date().toISOString())
    .in("status", ["upcoming", "live"]);
  return count ?? 0;
}

/** Starts the payment as the signed-in seller, "pays in the browser", confirms. Returns the PaymentIntent. */
async function buySeat(page: Page, auctionId: string): Promise<string> {
  const intent = await page.request.post("/api/premium-seat/intent", { data: { auctionId } });
  expect(intent.status()).toBe(200);
  const { clientSecret, amountEur } = (await intent.json()) as { clientSecret: string; amountEur: number };
  expect(amountEur).toBe(29);
  const pi = clientSecret.replace(/_secret_.*$/, "");
  // Not paid yet: the confirm route refuses.
  expect((await page.request.post("/api/premium-seat/confirm", { data: { paymentIntentId: pi } })).status()).toBe(409);
  markPaidInBrowser(pi);
  const done = await page.request.post("/api/premium-seat/confirm", { data: { paymentIntentId: pi } });
  expect(done.status()).toBe(200);
  expect(await done.json()).toEqual({ status: "paid" });
  return pi;
}

async function purchaseOf(auctionId: string) {
  const { data } = await service().from("premium_seat_purchases").select("*").eq("auction_id", auctionId).order("created_at", { ascending: false }).limit(1).single();
  return data as Record<string, unknown> & { id: string; status: string };
}

async function documentsOf(purchaseId: string) {
  const [{ data: invoices }, { data: receipts }] = await Promise.all([
    service().from("invoices").select("kind, total_cents, details, buyer_id").eq("buyer_payment_id", purchaseId),
    service().from("receipts").select("type, amount, details, buyer_id").eq("buyer_payment_id", purchaseId),
  ]);
  return { invoices: invoices ?? [], receipts: receipts ?? [] };
}

async function asAdmin(context: BrowserContext, admin: TestUser) {
  await signIn(context, admin);
}

test.describe("premium seat", () => {
  test.beforeAll(async () => setSettings(29, 50));
  test.afterAll(async () => setSettings(29, 5));

  test("buy: price, what it gives and the refund rules before paying; then featured (labelled), with invoice, receipt and a notification", async ({ page, context }) => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({ seller, startsAt: iso(-DAY), endsAt: iso(2 * DAY) });
    await signIn(context, seller);
    await page.goto("/account/listings");
    const row = page.locator("li", { has: page.locator(`a[href="/auctions/${a.id}"]`) }).first();
    await row.getByRole("button", { name: `Feature this car: ${a.title}` }).click();
    const dialog = page.getByRole("dialog", { name: "Feature this car" });
    await expect(dialog).toContainText("€29, VAT included");
    await expect(dialog).toContainText('labelled "Featured", until the auction ends');
    await expect(dialog).toContainText("If you withdraw the auction before it goes live, or Biddr removes the seat, you get your money back automatically.");
    await expect(dialog).toContainText("Once the auction has gone live there's no automatic refund.");
    await expect(dialog).toContainText("Optional");
    await expect(dialog.getByRole("button", { name: "Continue to payment" })).toBeVisible();
    await expectAccessible(page, "Feature this car");
    await page.keyboard.press("Escape");

    const pi = await buySeat(page, a.id);
    const purchase = await purchaseOf(a.id);
    expect(purchase).toMatchObject({ status: "paid", amount_cents: 2900, payment_intent_id: pi });
    const auction = await getAuction<{ premium_seat_source: string; premium_seat_until: string; ends_at: string }>(a.id);
    expect(auction.premium_seat_source).toBe("paid");
    expect(Date.parse(auction.premium_seat_until)).toBe(Date.parse(auction.ends_at));
    // Invoice and receipt like the buyer's premium, for the seller.
    const docs = await documentsOf(purchase.id);
    expect(docs.invoices).toEqual([expect.objectContaining({ kind: "invoice", total_cents: 2900, buyer_id: seller.id, details: expect.objectContaining({ product: "premium_seat" }) })]);
    expect(docs.receipts).toEqual([expect.objectContaining({ type: "payment", amount: 2900, buyer_id: seller.id })]);
    expect(await notificationsFor(seller, "premium_seat_paid")).toHaveLength(1);
    // Confirming again changes nothing.
    expect(await (await page.request.post("/api/premium-seat/confirm", { data: { paymentIntentId: pi } })).json()).toEqual({ status: "paid" });

    await page.reload();
    await expect(row.locator('[data-feature-state="featured"]')).toContainText("Featured on the home page until");
    await expect(row.getByRole("link", { name: /^Invoice BID-\d{4}-\d{5} \(PDF\)$/ })).toBeVisible();
    await expect(row.getByRole("link", { name: /^Receipt R-\d{4}-\d{4} \(PDF\)$/ })).toBeVisible();
    // The seller can open their own invoice.
    const href = await row.getByRole("link", { name: /^Invoice / }).getAttribute("href");
    const pdf = await page.request.get(href!);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toBe("application/pdf");

    // On the home page: in the carousel (it ends in 2 days, so only thanks to the seat), labelled.
    await page.goto("/");
    const slide = page.getByRole("region", { name: "Featured cars" }).locator(`[data-slide="${a.id}"]`);
    await expect(slide).toHaveCount(1);
    await expect(slide.locator("[data-featured-label]")).toHaveText("Featured");
  });

  test("the limit: when every place is taken, buying is refused and the seller can be notified; raising the limit (admin, logged) notifies them", async ({ page, context, seed }) => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({ seller, startsAt: iso(-DAY), endsAt: iso(2 * DAY) });
    await setSettings(29, Math.max(1, await activePaid()));
    await signIn(context, seller);
    await page.goto("/account/listings");
    const row = page.locator("li", { has: page.locator(`a[href="/auctions/${a.id}"]`) }).first();
    await expect(row.locator('[data-feature-state="full"]')).toContainText("All featured places are taken right now.");
    const refused = await page.request.post("/api/premium-seat/intent", { data: { auctionId: a.id } });
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "All featured places are taken right now.", full: true });
    await row.getByRole("button", { name: `Notify me when a place frees up: ${a.title}` }).click();
    await expect(row.getByText("We'll notify you when a place frees up.")).toBeVisible();
    const { data: waiting } = await service().from("premium_seat_waitlist").select("seller_id, notified_at").eq("auction_id", a.id).single();
    expect(waiting).toEqual({ seller_id: seller.id, notified_at: null });

    // An admin raises the limit (Admin → Premium seats, logged): the waiting seller is told.
    await asAdmin(context, seed.admin);
    await page.goto("/admin/premium-seats");
    await expect(page.getByRole("heading", { level: 1, name: "Premium seats" })).toBeVisible();
    await page.getByLabel("Paid seats at the same time").fill(String((await activePaid()) + 5));
    await page.getByRole("button", { name: "Save settings" }).click();
    await expect(page.getByText(/^Saved\./)).toBeVisible();
    await expect.poll(async () => (await notificationsFor(seller, "premium_seat_available")).length).toBe(1);
    const { data: log } = await service().from("admin_actions").select("action").eq("action", "premium_seat.settings").order("created_at", { ascending: false }).limit(1);
    expect(log).toHaveLength(1);
    await expectAccessible(page, "Admin: premium seats");
  });

  test("refunds: withdrawn before going live → automatic; an admin removes a seat → automatic; live → only an admin's manual refund", async ({ page, context, seed }) => {
    await setSettings(29, 50);
    const seller = await createUser({ role: "seller" });
    const scheduled = await createAuction({ seller, status: "upcoming", startsAt: iso(DAY), endsAt: iso(3 * DAY) });
    const removed = await createAuction({ seller, startsAt: iso(-DAY), endsAt: iso(2 * DAY) });
    const live = await createAuction({ seller, startsAt: iso(-DAY), endsAt: iso(2 * DAY) });
    await signIn(context, seller);
    for (const a of [scheduled, removed, live]) await buySeat(page, a.id);

    // The seller withdraws the scheduled auction: refunded automatically.
    await page.goto("/account/listings");
    await page.getByRole("button", { name: `Withdraw listing: ${scheduled.title}` }).click();
    await page.getByRole("dialog", { name: "Withdraw this listing?" }).getByRole("button", { name: "Withdraw listing" }).click();
    await expect.poll(async () => (await purchaseOf(scheduled.id)).status).toBe("refunded");
    expect(await getAuction<{ premium_seat_until: string | null }>(scheduled.id)).toMatchObject({ premium_seat_until: null });
    const docs = await documentsOf((await purchaseOf(scheduled.id)).id);
    expect(docs.invoices.map((i) => i.kind).sort()).toEqual(["credit_note", "invoice"]);
    expect(docs.receipts.map((r) => r.type).sort()).toEqual(["payment", "refund"]);
    expect(await notificationsFor(seller, "premium_seat_refunded")).toHaveLength(1);

    // A live auction withdrawn by an admin: no automatic refund.
    await asAdmin(context, seed.admin);
    await page.goto(`/admin/auctions/${live.id}`);
    await page.getByRole("button", { name: "Withdraw auction", exact: true }).click();
    await page.getByRole("dialog").or(page.getByRole("alertdialog")).last().getByRole("button", { name: /^Withdraw/ }).click();
    await expect.poll(async () => (await getAuction<{ status: string }>(live.id)).status).toBe("withdrawn");
    expect((await purchaseOf(live.id)).status).toBe("paid");

    // Admin → Premium seats: Remove refunds a paid seat automatically; Refund refunds by hand. Both logged.
    await page.goto("/admin/premium-seats");
    const removeRow = page.locator(`[data-seat-purchase="${(await purchaseOf(removed.id)).id}"]`);
    await removeRow.getByLabel("Reason (kept in the admin log)").fill("Photos don't match the car");
    await removeRow.getByRole("button", { name: `Remove seat for ${removed.title}` }).click();
    await expect(removeRow.getByText("Premium seat removed and the seller's payment refunded.")).toBeVisible();
    expect((await purchaseOf(removed.id)).status).toBe("refunded");
    expect(await getAuction<{ premium_seat_until: string | null }>(removed.id)).toMatchObject({ premium_seat_until: null });

    const liveRow = page.locator(`[data-seat-purchase="${(await purchaseOf(live.id)).id}"]`);
    await liveRow.getByLabel("Reason (kept in the admin log)").fill("Goodwill after the withdrawal");
    await liveRow.getByRole("button", { name: `Refund the premium seat for ${live.title}` }).click();
    await expect(liveRow.getByText(/^Refunded, and the seat removed\./)).toBeVisible();
    expect((await purchaseOf(live.id)).status).toBe("refunded");
    const { data: log } = await service().from("admin_actions").select("action").in("auction_id", [removed.id, live.id]);
    expect(log!.map((l) => l.action)).toEqual(expect.arrayContaining(["premium_seat.remove", "premium_seat.refund"]));
  });

  test("the sell confirmation page offers it as optional, after scheduling; a draft can't buy one", async ({ page, context }) => {
    const seller = await createUser({ role: "seller" });
    const draft = await createAuction({ seller, status: "draft" });
    await signIn(context, seller);
    await page.goto(`/sell/submitted?id=${draft.id}`);
    const offer = page.locator("[data-feature-offer]");
    await expect(offer).toContainText("Optional: feature this car");
    await expect(offer).toContainText("€29 (VAT included)");
    await expect(offer).toContainText('labelled "Featured"');
    const refused = await page.request.post("/api/premium-seat/intent", { data: { auctionId: draft.id } });
    expect(refused.status()).toBe(409);
    expect(await refused.json()).toMatchObject({ error: "Only a scheduled or live auction can be featured." });
    const upcoming = await createAuction({ seller, status: "upcoming", startsAt: iso(HOUR), endsAt: iso(DAY) });
    await page.goto("/account/listings");
    await expect(page.getByRole("button", { name: `Feature this car: ${upcoming.title}` })).toBeVisible();
    await expect(page.getByRole("button", { name: `Feature this car: ${draft.title}` })).toHaveCount(0);
  });
});
