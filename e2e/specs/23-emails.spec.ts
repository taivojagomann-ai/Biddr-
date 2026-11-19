// Area 23: emails to the winner and the seller (DECISIONS.md point 15). They follow
// notifications of the emailed types, go out once each, carry the invoice PDF when the
// premium is paid, show dates in the recipient's time zone, and skip everything else.
// In the tests they go to the local mail catcher (Mailpit).
import type { APIRequestContext } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { test, expect } from "../support/fixtures";
import { APP_URL, CRON_SECRET } from "../support/env";
import { createAuction, createUser, service } from "../support/factory";
import { attachment, emailsTo, type MailpitMessage } from "../support/mail";
import { payment, settle, soldAuction } from "../support/premium";

test.skip(({ isMobile }) => isMobile, "no screen involved: runs once");
test.describe.configure({ timeout: 120_000 });

async function sendEmails(request: APIRequestContext) {
  const res = await request.get(`${APP_URL}/api/email/send`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
  expect(res.status()).toBe(200);
  return (await res.json()) as { configured: boolean; sent: number };
}

/** Sends pending emails until `to` has one whose subject matches. */
async function waitForEmail(request: APIRequestContext, to: string, subject: RegExp): Promise<MailpitMessage> {
  let found: MailpitMessage | undefined;
  await expect
    .poll(
      async () => {
        await sendEmails(request);
        found = (await emailsTo(to)).find((m) => subject.test(m.Subject));
        return Boolean(found);
      },
      { timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .toBe(true);
  return found!;
}

test("the job needs the cron secret", async ({ request }) => {
  expect((await request.get(`${APP_URL}/api/email/send`)).status()).toBe(401);
});

test("a paid sale: the winner gets 'You won' and 'premium paid' with the invoice PDF and the seller's details; the seller gets 'sold' and the buyer's details; once each", async ({ request }) => {
  const s = await soldAuction(12_000, "ok");
  await settle(request);
  expect((await payment(s.paymentId)).status).toBe("paid");

  const won = await waitForEmail(request, s.winner.email, new RegExp(`^You won ${s.title}$`));
  expect(won.Text).toContain(`You won ${s.title} for €12,000`);
  expect(won.Text).toContain("buyer's premium of €600");
  expect(won.HTML).toContain("Open My purchases");

  const paid = await waitForEmail(request, s.winner.email, new RegExp(`^Buyer's premium paid: ${s.title}$`));
  expect(paid.Text).toContain("The buyer's premium of €600");
  expect(paid.Text).toContain("Your invoice is attached.");
  expect(paid.Text).toContain("Seller: Sella Seller");
  expect(paid.Text).toContain("Phone: +37255512345");
  expect(paid.Text).toContain("Arrange payment for the car and the handover directly with each other.");
  expect(paid.Text).toMatch(/Please pay the seller for the car by \d{1,2} \w+ \d{4}/);
  expect(paid.Text).toMatch(/Message the seller: http.*\/account\/messages\//);
  const pdf = paid.Attachments.find((a) => a.ContentType === "application/pdf");
  expect(pdf?.FileName).toMatch(/^Biddr-invoice-BID-\d{4}-\d{5}\.pdf$/);
  const doc = await PDFDocument.load(await attachment(paid.ID, pdf!.PartID));
  expect(doc.getTitle()).toMatch(/^Invoice BID-\d{4}-\d{5}$/);

  const sold = await waitForEmail(request, s.seller.email, new RegExp(`^Your ${s.title} sold for €12,000$`));
  expect(sold.Text).toContain("Now the buyer pays Biddr's buyer's premium.");
  const buyer = await waitForEmail(request, s.seller.email, new RegExp(`^The buyer of ${s.title} paid`));
  expect(buyer.Text).toContain("Buyer: Wynn Winner");
  expect(buyer.Text).toContain("Phone: +358401234567");
  expect(buyer.Text).toContain("Mark the sale completed on My listings");
  // The company line in every email.
  expect(buyer.Text).toContain("Biddr OÜ · Registry code 1111111");

  // Marked as sent; running again sends nothing twice.
  const { data: rows } = await service().from("notifications").select("type, emailed_at").eq("auction_id", s.auctionId).in("type", ["auction_won", "premium_paid", "auction_ended"]);
  expect(rows!.length).toBeGreaterThanOrEqual(4);
  expect(rows!.every((r) => r.emailed_at)).toBe(true);
  const count = (await emailsTo(s.winner.email)).length;
  await sendEmails(request);
  expect((await emailsTo(s.winner.email)).length).toBe(count);
});

test("payment needed: the deadline in the recipient's time zone, with Complete payment", async ({ request }) => {
  const s = await soldAuction(12_000, "authreq");
  await settle(request);
  const due = await waitForEmail(request, s.winner.email, new RegExp(`^Please confirm the payment for ${s.title}$`));
  // The winner's country is Estonia: Eastern European time.
  expect(due.Text).toMatch(/by \w{3}, \d{1,2} \w{3} \d{4}, \d{2}:\d{2} EET/);
  expect(due.Text).toContain("your bidding is blocked");
  expect(due.HTML).toContain("Complete payment");
});

test("buyer didn't pay: the winner and the seller are told; the next bidder gets the second-chance offer", async ({ request }) => {
  const s = await soldAuction(12_000, "authreq", { runnerUp: 10_000 });
  await settle(request);
  await service().from("buyer_payments").update({ due_at: new Date(Date.now() - 60_000).toISOString() }).eq("id", s.paymentId);
  await settle(request);
  expect((await payment(s.paymentId)).status).toBe("unpaid");

  const cancelled = await waitForEmail(request, s.winner.email, new RegExp(`^Your purchase of ${s.title} was cancelled$`));
  expect(cancelled.Text).toContain("the €500 taken from your card hold isn't refunded");
  const seller = await waitForEmail(request, s.seller.email, new RegExp(`^The buyer of ${s.title} didn't pay$`));
  expect(seller.Text).toContain("offer the car to the next bidder");

  // The seller's offer (made on My listings; here directly, as the server does).
  const expires = new Date(Date.now() + 48 * 3_600_000).toISOString();
  await service().from("second_chance_offers").insert({
    auction_id: s.auctionId, original_payment_id: s.paymentId, bidder_id: s.runner!.id, seller_id: s.seller.id,
    amount: 10_000, premium_amount: 500, expires_at: expires,
  });
  await service().from("notifications").insert({ user_id: s.runner!.id, type: "second_chance_offer", auction_id: s.auctionId, data: { amount: 10_000, expires_at: expires } });
  const offer = await waitForEmail(request, s.runner!.email, new RegExp(`^Second chance: buy ${s.title} for €10,000$`));
  expect(offer.Text).toContain("The buyer's premium is €500");
  expect(offer.Text).toContain("Accepting is binding.");
  expect(offer.HTML).toContain("See the offer");
  // Admins aren't emailed.
  const { data: adminRows } = await service().from("notifications").select("emailed_at").eq("auction_id", s.auctionId).eq("type", "buyer_did_not_pay").contains("data", { role: "admin" });
  expect((adminRows ?? []).every((r) => !r.emailed_at)).toBe(true);
});

test("other notifications aren't emailed", async ({ request }) => {
  const seller = await createUser({ role: "seller" });
  const bidder = await createUser();
  const a = await createAuction({ seller });
  await service().from("notifications").insert([
    { user_id: bidder.id, type: "outbid", auction_id: a.id, data: { amount: 5_000 } },
    { user_id: seller.id, type: "auction_ended", auction_id: a.id, data: { status: "reserve_not_met", final_bid: 5_000 } },
  ]);
  await sendEmails(request);
  await sendEmails(request);
  expect(await emailsTo(bidder.email)).toHaveLength(0);
  expect(await emailsTo(seller.email)).toHaveLength(0);
  const { data } = await service().from("notifications").select("type, emailed_at, email_error").eq("auction_id", a.id);
  expect(data!.every((n) => !n.emailed_at)).toBe(true);
  expect(data!.find((n) => n.type === "auction_ended")!.email_error).toBe("not emailed");
});
