// Area 26: receipts for the buyer's premium (DECISIONS.md point 12). A receipt only
// once the premium is paid in full (from the hold alone, or hold + card), one per
// payment however often Stripe repeats its webhooks; refund receipts (full, and partial
// ones made in Stripe's dashboard) that refer to the receipt and the invoice; the PDF
// only for the winner and admins; links on My purchases and Admin → Payments; the bell
// and the email with the PDF.
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import type { APIRequestContext } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { test, expect, signIn } from "../support/fixtures";
import { APP_URL, CRON_SECRET, SUPABASE_URL } from "../support/env";
import { userDb } from "../support/supabase";
import { createUser, notificationsFor, service } from "../support/factory";
import { attachment, emailsTo } from "../support/mail";
import { markPaidInBrowser, payment, settle, soldAuction } from "../support/premium";
import { sendWebhook } from "../support/stripe";

test.skip(({ isMobile }) => isMobile, "payments and documents: runs once (no phone layout involved)");
test.describe.configure({ timeout: 120_000 });

type Receipt = {
  id: string;
  number: string;
  type: "payment" | "refund";
  amount: number;
  net_cents: number;
  vat_cents: number;
  vat_rate: number;
  vat_country: string;
  invoice_id: string | null;
  refunds_receipt_id: string | null;
  stripe_refund_ids: string[];
  charges: { kind: string; amountCents: number; brand: string | null; last4: string | null; paymentIntent: string | null }[];
  details: { payer: { name: string; email: string | null }; reference: { invoiceNumber: string | null; auctionTitle: string; vin: string | null }; refunds?: { receiptNumber: string; invoiceNumber: string | null } };
  pdf_path: string | null;
};

async function receiptsFor(paymentId: string): Promise<Receipt[]> {
  const { data } = await service().from("receipts").select("*").eq("buyer_payment_id", paymentId).order("issued_at");
  return (data ?? []) as Receipt[];
}
async function invoiceFor(paymentId: string) {
  const { data } = await service().from("invoices").select("id, number, net_cents, vat_cents, vat_rate, vat_country").eq("buyer_payment_id", paymentId).eq("kind", "invoice").single();
  return data!;
}

/** Downloads a receipt as the signed-in member of `req`: follows the redirect to the signed link. */
async function openReceipt(req: APIRequestContext, id: string) {
  const res = await req.get(`${APP_URL}/api/receipts/${id}`, { maxRedirects: 0 });
  if (res.status() !== 302) return { status: res.status(), pdf: null };
  const file = await req.get(res.headers().location!);
  expect(file.headers()["content-type"]).toContain("application/pdf");
  return { status: 302, pdf: await PDFDocument.load(await file.body()) };
}

test("hold only: paid, then one receipt with the hold capture, the card and the invoice's VAT; the winner is told and can open it, others can't", async ({ page, context, request, browser }) => {
  const s = await soldAuction(6_000, "ok"); // premium €350 (the minimum): all from the €500 hold
  expect(await receiptsFor(s.paymentId)).toEqual([]);
  await settle(request);
  expect((await payment(s.paymentId)).status).toBe("paid");

  const [r] = await receiptsFor(s.paymentId);
  expect(r).toBeTruthy();
  expect(r!.number).toMatch(/^R-\d{4}-\d{4,}$/);
  expect(r).toMatchObject({ type: "payment", amount: 35_000, refunds_receipt_id: null });
  expect(r!.charges).toEqual([expect.objectContaining({ kind: "hold_capture", amountCents: 35_000, brand: "visa", last4: "4242", paymentIntent: s.holdPi })]);
  const inv = await invoiceFor(s.paymentId);
  expect(r).toMatchObject({ invoice_id: inv.id, net_cents: inv.net_cents, vat_cents: inv.vat_cents, vat_country: inv.vat_country });
  expect(Number(r!.vat_rate)).toBe(Number(inv.vat_rate));
  expect(r!.details.reference).toMatchObject({ invoiceNumber: inv.number, auctionTitle: s.title });
  expect(r!.details.reference.vin).toMatch(/^[A-Z0-9]{17}$/);
  expect(r!.details.payer).toMatchObject({ name: "Wynn Winner", email: s.winner.email });
  expect(r!.pdf_path).toBe(`${s.winner.id}/${r!.number}.pdf`);
  await expect.poll(async () => (await notificationsFor(s.winner, "receipt_ready")).length).toBe(1);

  // My purchases: Paid on <date>, View invoice and View receipt.
  await signIn(context, s.winner);
  await page.goto("/account/purchases");
  const item = page.getByRole("article", { name: s.title });
  await expect(item).toContainText(/Paid on \d{1,2} \w+ \d{4}/);
  await expect(item.getByRole("link", { name: `View invoice ${inv.number} (PDF) for ${s.title} (opens in a new tab)` })).toBeVisible();
  const link = item.getByRole("link", { name: `View receipt ${r!.number} (PDF) for ${s.title} (opens in a new tab)` });
  await expect(link).toHaveAttribute("href", `/api/receipts/${r!.id}`);
  await expect(link).toHaveAttribute("target", "_blank");

  // The winner opens it (a short-lived signed link to the private file).
  const mine = await openReceipt(page.request, r!.id);
  expect(mine.status).toBe(302);
  expect(mine.pdf!.getTitle()).toBe(`Receipt ${r!.number}`);

  // Nobody else: another member gets 404, a signed-out visitor 401, and the file isn't public.
  const other = await browser.newContext();
  await signIn(other, await createUser());
  expect((await openReceipt(other.request, r!.id)).status).toBe(404);
  await other.close();
  expect((await request.get(`${APP_URL}/api/receipts/${r!.id}`, { maxRedirects: 0 })).status()).toBe(401);
  expect((await request.get(`${SUPABASE_URL}/storage/v1/object/public/receipts/${r!.pdf_path}`)).ok()).toBe(false);
});

test("hold + card: no receipt until the whole premium is paid; then one, listing both charges; Stripe's repeated webhooks and the settlement job don't add another", async ({ page, context, request }) => {
  const s = await soldAuction(12_000, "authreq"); // premium €600: €500 from the hold, €100 needs the winner
  await settle(request);
  expect((await payment(s.paymentId)).status).toBe("action_required");
  expect(await receiptsFor(s.paymentId)).toEqual([]);

  // The winner pays the rest on the site.
  await signIn(context, s.winner);
  const intent = await page.request.post("/api/stripe/premium/intent", { data: { auctionId: s.auctionId } });
  const { clientSecret } = (await intent.json()) as { clientSecret: string };
  const pi = clientSecret.replace(/_secret_.*$/, "");
  expect(await receiptsFor(s.paymentId)).toEqual([]);
  markPaidInBrowser(pi);
  expect((await page.request.post("/api/stripe/premium/confirm", { data: { paymentIntentId: pi } })).status()).toBe(200);
  expect((await payment(s.paymentId)).status).toBe("paid");

  const receipts = await receiptsFor(s.paymentId);
  expect(receipts).toHaveLength(1);
  expect(receipts[0]).toMatchObject({ type: "payment", amount: 60_000 });
  expect(receipts[0]!.charges).toEqual([
    expect.objectContaining({ kind: "hold_capture", amountCents: 50_000, paymentIntent: s.holdPi, last4: "4242" }),
    expect.objectContaining({ kind: "card_charge", amountCents: 10_000, paymentIntent: pi, last4: "4242" }),
  ]);

  // Stripe sends payment_intent.succeeded, then again (a retry), and the same event twice.
  const object = { id: pi, object: "payment_intent", status: "succeeded", amount: 10_000, amount_received: 10_000, metadata: { kind: "buyer_premium", auction_id: s.auctionId, user_id: s.winner.id, buyer_payment_id: s.paymentId } };
  const first = await sendWebhook(request, "payment_intent.succeeded", object);
  expect(first.res.status()).toBe(200);
  expect((await sendWebhook(request, "payment_intent.succeeded", object)).res.status()).toBe(200);
  expect((await sendWebhook(request, "payment_intent.succeeded", object, first.id)).res.status()).toBe(200);
  await settle(request);
  expect(await receiptsFor(s.paymentId)).toHaveLength(1);
  expect(await notificationsFor(s.winner, "receipt_ready")).toHaveLength(1);
});

test("a full refund gets a refund receipt that refers to the receipt and the invoice; Stripe's charge.refunded afterwards adds nothing; admins see both", async ({ page, context, request, seed }) => {
  const s = await soldAuction(12_000, "ok"); // €500 from the hold + €100 charged off-session
  await settle(request);
  const [original] = await receiptsFor(s.paymentId);
  expect(original!.charges.map((c) => c.kind)).toEqual(["hold_capture", "card_charge"]);
  const inv = await invoiceFor(s.paymentId);

  await signIn(context, seed.admin);
  await page.goto("/admin/payments?status=paid");
  const row = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: s.title }) });
  await expect(row.getByRole("link", { name: `Receipt ${original!.number} (PDF) for ${s.title} (opens in a new tab)` })).toBeVisible();
  await row.getByRole("button", { name: `Refund premium: ${s.title}` }).click();
  await page.getByRole("dialog", { name: "Refund €600 to the winner?" }).getByRole("button", { name: "Refund premium" }).click();
  await expect.poll(async () => (await receiptsFor(s.paymentId)).length).toBe(2);

  const refund = (await receiptsFor(s.paymentId)).find((r) => r.type === "refund")!;
  expect(refund).toMatchObject({ amount: 60_000, refunds_receipt_id: original!.id, invoice_id: inv.id, net_cents: inv.net_cents, vat_cents: inv.vat_cents });
  expect(refund.details.refunds).toEqual({ receiptNumber: original!.number, invoiceNumber: inv.number });
  expect(refund.stripe_refund_ids).toHaveLength(2);
  expect(refund.charges.map((c) => c.amountCents)).toEqual([50_000, 10_000]);
  // The action logs after issuing the documents: wait for it.
    await expect.poll(async () => (await service().from("admin_actions").select("id").eq("auction_id", s.auctionId).eq("action", "payment.refund")).data?.length ?? 0).toBe(1);
    const { data: log } = await service().from("admin_actions").select("details").eq("auction_id", s.auctionId).eq("action", "payment.refund").single();
  expect(log!.details).toMatchObject({ refund_receipt: refund.number });

  // Stripe reports the refunds on each charge: already receipted, nothing new.
  writeRefunds(`ch_${s.holdPi}`, [{ id: refund.stripe_refund_ids[0]!, amount: 50_000 }]);
  expect((await sendWebhook(request, "charge.refunded", { id: `ch_${s.holdPi}`, object: "charge", payment_intent: s.holdPi, amount_refunded: 50_000 })).res.status()).toBe(200);
  expect(await receiptsFor(s.paymentId)).toHaveLength(2);

  // The admin opens it; the payments list shows the refund receipt too.
  expect((await openReceipt(page.request, refund.id)).pdf!.getTitle()).toBe(`Refund receipt ${refund.number}`);
  await page.goto("/admin/payments?status=refunded");
  await expect(page.getByRole("link", { name: `Refund receipt ${refund.number} (PDF) for ${s.title} (opens in a new tab)` })).toBeVisible();
});

test("a partial refund made in Stripe's dashboard: a refund receipt for that amount, once; the premium stays paid; one paid email with both documents, and a refund email", async ({ request }) => {
  const s = await soldAuction(12_000, "ok");
  await settle(request);
  const [original] = await receiptsFor(s.paymentId);
  const refundId = `re_e2e_partial_${Date.now().toString(36)}`;
  writeRefunds(`ch_${s.holdPi}`, [{ id: refundId, amount: 15_000 }]);
  const event = { id: `ch_${s.holdPi}`, object: "charge", payment_intent: s.holdPi, amount_refunded: 15_000 };
  const first = await sendWebhook(request, "charge.refunded", event);
  expect(first.res.status()).toBe(200);
  expect((await sendWebhook(request, "charge.refunded", event)).res.status()).toBe(200);

  const refunds = (await receiptsFor(s.paymentId)).filter((r) => r.type === "refund");
  expect(refunds).toHaveLength(1);
  expect(refunds[0]).toMatchObject({ amount: 15_000, stripe_refund_ids: [refundId], refunds_receipt_id: original!.id });
  expect(refunds[0]!.net_cents + refunds[0]!.vat_cents).toBe(15_000);
  expect((await payment(s.paymentId)).status).toBe("paid");
  await expect.poll(async () => (await notificationsFor(s.winner, "receipt_ready")).map((n) => (n.data as { receipt_type?: string }).receipt_type).sort()).toEqual(["payment", "refund"]);

  // Emails (to the local mail catcher): one "premium paid" email with the invoice and the
  // receipt (no separate receipt email), and one for the refund with the refund receipt.
  const refund = (await receiptsFor(s.paymentId)).find((r) => r.type === "refund")!;
  const subjects = [`Buyer's premium paid: ${s.title}`, `Refund receipt ${refund.number}: ${s.title}`];
  await expect
    .poll(
      async () => {
        await request.get(`${APP_URL}/api/email/send`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
        const got = (await emailsTo(s.winner.email)).map((m) => m.Subject);
        return subjects.every((x) => got.includes(x));
      },
      { timeout: 60_000 },
    )
    .toBe(true);
  const mails = await emailsTo(s.winner.email);
  expect(mails.filter((m) => /^Receipt R-/.test(m.Subject))).toHaveLength(0);
  const paid = mails.find((m) => m.Subject === subjects[0])!;
  expect(paid.Attachments.map((a) => a.FileName).sort()).toEqual([expect.stringMatching(/^Biddr-invoice-BID-/), `Biddr-receipt-${original!.number}.pdf`]);
  const receiptFile = paid.Attachments.find((a) => a.FileName === `Biddr-receipt-${original!.number}.pdf`)!;
  expect((await PDFDocument.load(await attachment(paid.ID, receiptFile.PartID))).getTitle()).toBe(`Receipt ${original!.number}`);
  // A partial refund: the refund receipt only (no credit note).
  const refundMail = mails.find((m) => m.Subject === subjects[1])!;
  expect(refundMail.Text).toContain("Your refund receipt is attached.");
  expect(refundMail.Attachments.map((a) => a.FileName)).toEqual([`Biddr-refund-receipt-${refund.number}.pdf`]);
});

test("receipts can't be changed or deleted, and members can't write them", async ({ request }) => {
  const s = await soldAuction(6_000, "ok");
  await settle(request);
  const [r] = await receiptsFor(s.paymentId);
  const { error: changeError } = await service().from("receipts").update({ amount: 1 }).eq("id", r!.id);
  expect(changeError?.message).toContain("Receipts can't be changed or deleted");
  const { error: deleteError } = await service().from("receipts").delete().eq("id", r!.id);
  expect(deleteError?.message).toContain("Receipts can't be changed or deleted");
  const winnerDb = await userDb(s.winner.email);
  const { error: insertError } = await winnerDb.from("receipts").insert({ number: "R-1999-0001", type: "payment", buyer_payment_id: s.paymentId, auction_id: s.auctionId, buyer_id: s.winner.id, amount: 1, net_cents: 1, vat_cents: 0, vat_rate: 0, vat_country: "EE" });
  expect(insertError).not.toBeNull();
  const { error: rpcError } = await winnerDb.rpc("issue_receipt", {});
  expect(rpcError).not.toBeNull();
});

/** Refunds the simulated Stripe reports for a charge (as if made in Stripe's dashboard). */
function writeRefunds(chargeId: string, refunds: { id: string; amount: number }[]) {
  const file = "e2e/.state/stripe-sim-refunds.json";
  mkdirSync("e2e/.state", { recursive: true });
  const all = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
  all[chargeId] = refunds;
  writeFileSync(file, JSON.stringify(all));
}
