// Area 20: invoices for the buyer's premium. One invoice per paid premium, numbered
// BID-<year>-00001 without gaps, VAT included at the rate of the car's country, a
// snapshot that can't be changed, the PDF for the winner (and nobody else), a credit
// note after a refund, issuing missed invoices later, and the admin's list and CSV.
import { PDFDocument } from "pdf-lib";
import { test, expect, signIn, expectAccessible } from "../support/fixtures";
import { createUser, service } from "../support/factory";
import { payment, settle, soldAuction } from "../support/premium";
import { userDb } from "../support/supabase";

interface Invoice {
  id: string;
  number: string;
  kind: "invoice" | "credit_note";
  buyer_id: string;
  credited_invoice_id: string | null;
  total_cents: number;
  net_cents: number;
  vat_cents: number;
  vat_rate: number;
  vat_country: string;
  issued_at: string;
  details: {
    issuer: { name: string; registryCode: string; vatNumber: string; addressLines: string[]; email: string };
    buyer: { name: string; email: string | null };
    line: { description: string; winningBid: number; carCountry: string };
    payments: { label: string; amountCents: number; reference: string | null }[];
    credits?: { number: string };
  };
}

async function invoicesFor(paymentId: string): Promise<Invoice[]> {
  const { data, error } = await service().from("invoices").select("*").eq("buyer_payment_id", paymentId).order("issued_at");
  expect(error).toBeNull();
  return (data ?? []) as Invoice[];
}

const seq = (number: string) => Number(number.split("-")[2]);

test.describe("issuing", () => {
  test.skip(({ isMobile }) => isMobile, "no screen involved: runs once");

  test("a premium paid from the hold: one invoice, VAT included at Estonia's rate, Biddr's details; settling again changes nothing", async ({ request }) => {
    const s = await soldAuction(5_000, "ok"); // premium €350, all from the hold
    await settle(request);
    expect((await payment(s.paymentId)).status).toBe("paid");
    const [inv, ...more] = await invoicesFor(s.paymentId);
    expect(more).toHaveLength(0);
    expect(inv!.number).toMatch(new RegExp(`^BID-${new Date().getUTCFullYear()}-\\d{5}$`));
    expect(inv).toMatchObject({ kind: "invoice", buyer_id: s.winner.id, total_cents: 35_000, vat_country: "EE" });
    expect(Number(inv!.vat_rate)).toBe(24);
    // €350 including 24% VAT: €282.26 + €67.74.
    expect([inv!.net_cents, inv!.vat_cents]).toEqual([28_226, 6_774]);
    expect(inv!.details.issuer).toEqual({
      name: "Biddr OÜ",
      registryCode: "1111111",
      vatNumber: "2222222",
      addressLines: ["Testimise puiestee 5", "Tallinn", "Estonia"],
      email: "invoice@biddr.org",
    });
    expect(inv!.details.buyer).toEqual({ name: "Wynn Winner", email: s.winner.email });
    expect(inv!.details.line).toMatchObject({ description: `Buyer's premium: ${s.title}`, winningBid: 5_000, carCountry: "EE" });
    expect(inv!.details.payments).toEqual([{ label: "Taken from the card hold", amountCents: 35_000, reference: s.holdPi }]);

    await settle(request);
    expect(await invoicesFor(s.paymentId)).toHaveLength(1);
  });

  test("hold plus a card charge: one invoice for the whole premium, listing both payments; a car in Germany uses Germany's rate", async ({ request }) => {
    const s = await soldAuction(30_000, "ok", { country: "DE" }); // premium €1,500: €500 + €1,000
    await settle(request);
    const p = await payment(s.paymentId);
    const [inv] = await invoicesFor(s.paymentId);
    expect(inv).toMatchObject({ total_cents: 150_000, vat_country: "DE" });
    expect(Number(inv!.vat_rate)).toBe(19);
    expect([inv!.net_cents, inv!.vat_cents]).toEqual([126_050, 23_950]);
    expect(inv!.details.payments).toEqual([
      { label: "Taken from the card hold", amountCents: 50_000, reference: s.holdPi },
      { label: "Charged to the card", amountCents: 100_000, reference: p.remainder_payment_intent_id },
    ]);
  });

  test("numbers run without gaps, and an issued invoice can't be changed or deleted", async ({ request }) => {
    const a = await soldAuction(6_000, "ok");
    const b = await soldAuction(7_000, "ok");
    await settle(request);
    const [ia] = await invoicesFor(a.paymentId);
    const [ib] = await invoicesFor(b.paymentId);
    expect(seq(ia!.number)).not.toBe(seq(ib!.number));
    // Every number up to the counter is used exactly once.
    const year = Number(ia!.number.split("-")[1]);
    const { data: counter } = await service().from("invoice_counters").select("last_number").eq("year", year).single();
    const { count } = await service().from("invoices").select("id", { count: "exact", head: true }).like("number", `BID-${year}-%`);
    expect(count).toBe(counter!.last_number);

    const update = await service().from("invoices").update({ total_cents: 1 }).eq("id", ia!.id);
    expect(update.error?.message).toContain("Invoices can't be changed or deleted");
    const del = await service().from("invoices").delete().eq("id", ia!.id);
    expect(del.error?.message).toContain("Invoices can't be changed or deleted");
  });

  test("a paid premium without an invoice (e.g. a failed attempt) gets one at the next settlement run", async ({ request }) => {
    const s = await soldAuction(5_000, "ok");
    // Paid outside the normal path, so no invoice yet.
    await service().from("buyer_payments").update({ status: "paid", captured_from_hold: 350, paid_at: new Date().toISOString() }).eq("id", s.paymentId);
    expect(await invoicesFor(s.paymentId)).toHaveLength(0);
    await settle(request);
    expect(await invoicesFor(s.paymentId)).toHaveLength(1);
  });
});

test.describe("the winner's invoice", () => {
  test("My purchases: View invoice opens the PDF in a new tab, where it can be saved; other members and signed-out visitors can't open it", async ({ page, context, request }) => {
    const s = await soldAuction(12_000, "ok"); // premium €600
    await settle(request);
    const [inv] = await invoicesFor(s.paymentId);

    await signIn(context, s.winner);
    await page.goto("/account/purchases");
    const item = page.getByRole("article", { name: s.title });
    const link = item.getByRole("link", { name: `View invoice ${inv!.number} (PDF) for ${s.title} (opens in a new tab)` });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(item.getByRole("link", { name: /View the receipt/ })).toHaveCount(0);
    await expectAccessible(page, "My purchases with an invoice");

    // Opens in a new tab (the test browser has no PDF viewer, so the tab itself isn't checked).
    await expect(link).toHaveAttribute("href", `/api/invoices/${inv!.id}`);
    const [tab] = await Promise.all([page.waitForEvent("popup"), link.click()]);
    await tab.close();
    // Shown inline by the browser's PDF viewer; its Save button uses the invoice's file name.
    const res = await page.request.get(`/api/invoices/${inv!.id}`);
    expect(res.headers()["content-type"]).toBe("application/pdf");
    expect(res.headers()["content-disposition"]).toBe(`inline; filename="Biddr-invoice-${inv!.number}.pdf"`);
    const pdf = await PDFDocument.load(await res.body());
    expect(pdf.getTitle()).toBe(`Invoice ${inv!.number}`);
    expect(pdf.getAuthor()).toBe("Biddr OÜ");
    expect(pdf.getPageCount()).toBe(1);

    // Someone else: not found. Signed out: asked to sign in.
    const other = await createUser();
    const otherCtx = await page.context().browser()!.newContext();
    await signIn(otherCtx, other);
    expect((await otherCtx.request.get(`/api/invoices/${inv!.id}`)).status()).toBe(404);
    await otherCtx.close();
    const anon = await page.context().browser()!.newContext();
    expect((await anon.request.get(`/api/invoices/${inv!.id}`)).status()).toBe(401);
    await anon.close();
    // RLS: the other member can't read the row either.
    const { data: rows } = await (await userDb(other.email)).from("invoices").select("id").eq("id", inv!.id);
    expect(rows).toEqual([]);
  });
});

test.describe("admin", () => {
  test.skip(({ isMobile }) => isMobile, "admin desktop");

  test("a refund issues a credit note; the winner gets both; the invoice list shows them with VAT totals and a CSV", async ({ page, context, request, seed }) => {
    const s = await soldAuction(12_000, "ok");
    await settle(request);
    const [inv] = await invoicesFor(s.paymentId);

    await signIn(context, seed.admin);
    await page.goto("/admin/payments?status=paid");
    const row = page.getByRole("listitem").filter({ has: page.getByRole("link", { name: s.title }) });
    await expect(row.getByRole("link", { name: `Invoice ${inv!.number} (PDF) for ${s.title} (opens in a new tab)` })).toHaveAttribute("target", "_blank");
    await row.getByRole("button", { name: `Refund premium: ${s.title}` }).click();
    await page.getByRole("dialog", { name: "Refund €600 to the winner?" }).getByRole("button", { name: "Refund premium" }).click();
    await expect.poll(async () => (await payment(s.paymentId)).status).toBe("refunded");
    // The credit note is issued right after the status changes.
    await expect.poll(async () => (await invoicesFor(s.paymentId)).length).toBe(2);

    const docs = await invoicesFor(s.paymentId);
    const credit = docs.find((d) => d.kind === "credit_note")!;
    expect(credit).toMatchObject({ credited_invoice_id: inv!.id, total_cents: -60_000, net_cents: -48_387, vat_cents: -11_613, vat_country: "EE" });
    expect(credit.details.credits!.number).toBe(inv!.number);
    expect(seq(credit.number)).toBeGreaterThan(seq(inv!.number));
    // The action logs after issuing the documents: wait for it.
    await expect.poll(async () => (await service().from("admin_actions").select("id").eq("auction_id", s.auctionId).eq("action", "payment.refund")).data?.length ?? 0).toBe(1);
    const { data: log } = await service().from("admin_actions").select("details").eq("auction_id", s.auctionId).eq("action", "payment.refund").single();
    expect((log!.details as { credit_note: string }).credit_note).toBe(credit.number);

    // The admin's invoice list for this month: both documents, VAT totals, CSV.
    await page.goto("/admin/invoices");
    await expect(page.getByRole("heading", { level: 1, name: "Invoices" })).toBeVisible();
    await expect(page.getByRole("link", { name: `${inv!.number} (PDF, opens in a new tab)`, exact: true })).toHaveAttribute("target", "_blank");
    await expect(page.getByRole("link", { name: `${credit.number} (PDF, opens in a new tab)`, exact: true })).toBeVisible();
    await expect(page.getByText(`Credit note for ${inv!.number}`)).toBeVisible();
    await expect(page.getByRole("region", { name: "VAT totals" }).getByRole("cell", { name: "Estonia" })).toBeVisible();
    await expectAccessible(page, "Admin invoices");
    const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download CSV for the accountant" }).click()]);
    const text = Buffer.concat((await (await csv.createReadStream()).toArray()) as Buffer[]).toString("utf8");
    expect(text.split("\r\n")[0]).toBe("Number,Type,Date,Credits invoice,Buyer,Buyer email,Description,Net (EUR),VAT rate (%),VAT (EUR),Total (EUR),VAT country,Car country");
    expect(text).toContain(`${inv!.number},Invoice,`);
    expect(text).toContain(",483.87,24,116.13,600.00,EE,Estonia");
    expect(text).toContain(`${credit.number},Credit note,`);
    expect(text).toContain(",-483.87,24,-116.13,-600.00,EE,Estonia");

    // The winner sees the invoice and the credit note.
    await signIn(context, s.winner);
    await page.goto("/account/purchases");
    const item = page.getByRole("article", { name: s.title });
    await expect(item.getByRole("link", { name: `View invoice ${inv!.number} (PDF) for ${s.title}` })).toBeVisible();
    await expect(item.getByRole("link", { name: `View credit note ${credit.number} (PDF) for ${s.title}` })).toHaveAttribute("target", "_blank");
    const res = await page.request.get(`/api/invoices/${credit.id}`);
    expect(res.status()).toBe(200);
    expect((await PDFDocument.load(await res.body())).getTitle()).toBe(`Credit note ${credit.number}`);
  });

  test("the CSV is for admins only", async ({ request }) => {
    expect((await request.get("/api/admin/invoices")).status()).toBe(404);
  });
});
