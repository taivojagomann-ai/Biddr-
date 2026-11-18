// Area 22: messages between buyer and seller after a sale, and "Report a problem".
// The conversation opens when the premium is paid; text only, live, one notification
// per conversation until read; nobody else can read or write; limits (length, rate,
// read-only after the sale); a report with the right reasons; the admin's report
// page (conversation only while open, every view logged), support messages, blocks
// and the decision; conversations deleted after 3 years.
import type { Browser, Page } from "@playwright/test";
import { test, expect, signIn, expectAccessible, realtimeReady } from "../support/fixtures";
import { createUser, notificationsFor, runJob, service, type TestUser } from "../support/factory";
import { settle, soldAuction, type Sold } from "../support/premium";
import { userDb } from "../support/supabase";

/** A paid sale and its conversation. */
async function paidSale(request: Parameters<typeof settle>[0]): Promise<Sold & { conversationId: string }> {
  const s = await soldAuction(12_000, "ok");
  await settle(request);
  const { data } = await service().from("conversations").select("id, buyer_id, seller_id").eq("buyer_payment_id", s.paymentId).single();
  expect(data).toMatchObject({ buyer_id: s.winner.id, seller_id: s.seller.id });
  return { ...s, conversationId: data!.id as string };
}

async function as(browser: Browser, user: TestUser): Promise<Page> {
  const ctx = await browser.newContext();
  await signIn(ctx, user);
  return ctx.newPage();
}

async function send(page: Page, text: string) {
  await page.getByLabel("Message", { exact: true }).fill(text);
  await page.getByLabel("Message", { exact: true }).press("Control+Enter");
}

const log = (page: Page) => page.getByRole("log", { name: "Messages" });

test.describe("conversation", () => {
  test.describe.configure({ timeout: 150_000 });

  test("opens when the premium is paid; buyer and seller write live; one notification until read; links stay text", async ({ page, context, request, browser }) => {
    // Not before the premium is paid.
    const waiting = await soldAuction(12_000, "authreq");
    await settle(request);
    const { count } = await service().from("conversations").select("id", { count: "exact", head: true }).eq("buyer_payment_id", waiting.paymentId);
    expect(count).toBe(0);

    const s = await paidSale(request);
    await signIn(context, s.winner);
    await page.goto("/account/purchases");
    await page.getByRole("article", { name: s.title }).getByRole("link", { name: `Message the seller about ${s.title}` }).click();
    await expect(page).toHaveURL(new RegExp(`/account/messages/${s.conversationId}$`));
    await expect(page.getByRole("note")).toContainText("Biddr never asks you to pay through messages.");
    await expectAccessible(page, "Conversation");

    // The seller has the conversation open in another browser.
    const seller = await as(browser, s.seller);
    const live = realtimeReady(seller, `messages:${s.conversationId}`);
    await seller.goto(`/account/messages/${s.conversationId}`);
    await live;

    await send(page, "Hello! When could I see the car?");
    await expect(log(page)).toContainText("Hello! When could I see the car?");
    await expect(log(seller)).toContainText("Hello! When could I see the car?");
    await expect(page.getByLabel("Message", { exact: true })).toHaveValue("");

    // The seller replies; the buyer sees it live. A link stays plain text.
    const buyerLive = realtimeReady(page, `messages:${s.conversationId}`);
    await page.reload();
    await buyerLive;
    await send(seller, "Saturday works. Photos: https://example.com/car");
    await expect(log(page)).toContainText("Saturday works. Photos: https://example.com/car");
    await expect(log(page).getByRole("link")).toHaveCount(0);

    // One "new message" notification per conversation until it's read.
    await seller.close();
    const { data: msgs } = await service().from("messages").select("sender_role").eq("conversation_id", s.conversationId);
    expect(msgs).toHaveLength(2);
    const db = await userDb(s.winner.email);
    await db.rpc("send_message", { p_conversation: s.conversationId, p_body: "Second message" });
    await db.rpc("send_message", { p_conversation: s.conversationId, p_body: "Third message" });
    const unread = (await notificationsFor(s.seller, "new_message")).filter((n) => !n.read_at);
    expect(unread).toHaveLength(1);
    expect(unread[0]!.data).toMatchObject({ conversation_id: s.conversationId });

    // Opening the conversation reads it.
    const seller2 = await as(browser, s.seller);
    await seller2.goto("/account/messages");
    await expect(seller2.getByRole("link", { name: new RegExp(s.title) })).toContainText("New");
    await expectAccessible(seller2, "Messages list");
    await seller2.getByRole("link", { name: new RegExp(s.title) }).click();
    await expect(log(seller2)).toContainText("Third message");
    await expect.poll(async () => (await notificationsFor(s.seller, "new_message")).filter((n) => !n.read_at).length).toBe(0);
  });

  test("only the two parties; limits: empty, too long, 30 per 10 minutes, read-only after the sale, never edited", async ({ request }) => {
    const s = await paidSale(request);
    const stranger = await createUser();
    const sdb = await userDb(stranger.email);
    expect((await sdb.from("conversations").select("id").eq("id", s.conversationId)).data).toEqual([]);
    expect((await sdb.from("messages").select("id").eq("conversation_id", s.conversationId)).data).toEqual([]);
    expect((await sdb.rpc("send_message", { p_conversation: s.conversationId, p_body: "hi" })).error?.message).toBe("CONVERSATION_NOT_FOUND");
    // No direct writes, even by a party.
    const bdb = await userDb(s.winner.email);
    expect((await bdb.from("messages").insert({ conversation_id: s.conversationId, sender_id: s.winner.id, sender_role: "support", body: "fake" })).error).not.toBeNull();

    expect((await bdb.rpc("send_message", { p_conversation: s.conversationId, p_body: "   " })).error?.message).toBe("MESSAGE_EMPTY");
    expect((await bdb.rpc("send_message", { p_conversation: s.conversationId, p_body: "x".repeat(2001) })).error?.message).toBe("MESSAGE_TOO_LONG");

    const { data: first } = await bdb.rpc("send_message", { p_conversation: s.conversationId, p_body: "Hello" });
    expect((await service().from("messages").update({ body: "edited" }).eq("id", (first as { id: string }).id)).error?.message).toContain("Messages can't be changed");

    // 30 messages in 10 minutes is the limit.
    await service().from("messages").insert(Array.from({ length: 29 }, (_, i) => ({ conversation_id: s.conversationId, sender_id: s.winner.id, sender_role: "buyer", body: `m${i}` })));
    expect((await bdb.rpc("send_message", { p_conversation: s.conversationId, p_body: "one too many" })).error?.message).toBe("MESSAGE_RATE_LIMIT");

    // Read-only 30 days after "Sale completed".
    await service().from("buyer_payments").update({ sale_completed_at: new Date(Date.now() - 31 * 86_400_000).toISOString() }).eq("id", s.paymentId);
    const sellerDb = await userDb(s.seller.email);
    expect((await sellerDb.rpc("send_message", { p_conversation: s.conversationId, p_body: "late" })).error?.message).toBe("CONVERSATION_READ_ONLY");
  });

  test("the read-only notice replaces the message box", async ({ page, context, request }) => {
    const s = await paidSale(request);
    await service().from("buyer_payments").update({ paid_at: new Date(Date.now() - 61 * 86_400_000).toISOString() }).eq("id", s.paymentId);
    await signIn(context, s.seller);
    await page.goto(`/account/messages/${s.conversationId}`);
    await expect(page.getByText("This conversation is read-only now.")).toBeVisible();
    await expect(page.getByLabel("Message", { exact: true })).toHaveCount(0);
  });

  test("conversations are deleted 3 years after the sale", async ({ request }) => {
    test.skip(test.info().project.name !== "desktop-berlin", "runs once");
    const s = await paidSale(request);
    await service().from("buyer_payments").update({ paid_at: new Date(Date.now() - 3 * 366 * 86_400_000).toISOString() }).eq("id", s.paymentId);
    await runJob("purge_old_conversations");
    const { count } = await service().from("conversations").select("id", { count: "exact", head: true }).eq("id", s.conversationId);
    expect(count).toBe(0);
  });
});

test.describe("report a problem", () => {
  test.describe.configure({ timeout: 150_000 });

  test("the buyer reports; the seller's 'buyer hasn't paid' waits 7 days; admins are told; the status shows", async ({ page, context, request, browser, seed }) => {
    const s = await paidSale(request);
    // The seller can't yet report that the buyer hasn't paid for the car.
    const seller = await as(browser, s.seller);
    await seller.goto(`/account/messages/${s.conversationId}`);
    await seller.getByRole("button", { name: "Report a problem" }).click();
    await expect(seller.getByRole("radio", { name: /The buyer hasn't paid for the car/ })).toBeDisabled();
    await expectAccessible(seller, "Report form");
    await seller.close();

    await signIn(context, s.winner);
    await page.goto(`/account/messages/${s.conversationId}`);
    await page.getByRole("button", { name: "Report a problem" }).click();
    await expect(page.getByRole("radio", { name: "The car isn't as described" })).toBeVisible();
    await expect(page.getByRole("radio", { name: /The buyer hasn't paid/ })).toHaveCount(0);
    // Too short.
    await page.getByRole("radio", { name: "The car isn't as described" }).check();
    await page.getByLabel("Describe what happened").fill("Rust.");
    await page.getByRole("button", { name: "Send report" }).click();
    await expect(page.getByText("Describe the problem in at least 20 characters.")).toBeVisible();
    await page.getByLabel("Describe what happened").fill("The sills are rusted through, not mentioned in the listing.");
    await page.getByRole("button", { name: "Send report" }).click();
    await expect(page.getByText("Your report: The car isn't as described")).toBeVisible();
    await expect(page.getByText("Status: Open: Biddr will look at it soon")).toBeVisible();
    await expect(page.getByRole("button", { name: "Report a problem" })).toHaveCount(0);

    const { data: report } = await service().from("sale_reports").select("*").eq("buyer_payment_id", s.paymentId).single();
    expect(report).toMatchObject({ reporter_role: "buyer", reason: "not_as_described", status: "open", conversation_id: s.conversationId });
    await expect.poll(async () => (await notificationsFor(seed.admin, "report_opened")).some((n) => (n.data as { report_id?: string }).report_id === report!.id)).toBe(true);

    await page.goto("/account/purchases");
    await expect(page.getByRole("article", { name: s.title })).toContainText("Your report: Open");
    // The seller can't see the buyer's report.
    const sdb = await userDb(s.seller.email);
    expect((await sdb.from("sale_reports").select("id").eq("id", report!.id)).data).toEqual([]);
  });
});

test.describe("admin: reports", () => {
  test.skip(({ isMobile }) => isMobile, "admin desktop");
  test.describe.configure({ timeout: 180_000 });

  test("review, write as Biddr support, block both parties, resolve; the conversation hides once resolved", async ({ page, context, request, browser, seed }) => {
    const s = await paidSale(request);
    await (await userDb(s.seller.email)).rpc("send_message", { p_conversation: s.conversationId, p_body: "The car is exactly as listed." });
    // The buyer reports.
    const { data: report } = await service()
      .from("sale_reports")
      .insert({
        buyer_payment_id: s.paymentId, auction_id: s.auctionId, conversation_id: s.conversationId, reporter_id: s.winner.id,
        reporter_role: "buyer", reason: "seller_wont_hand_over", description: "The seller stopped answering after I paid.",
      })
      .select("id")
      .single();

    await signIn(context, seed.admin);
    await page.goto("/admin/reports");
    await page.getByRole("link", { name: `${s.title}: The seller won't hand over the car` }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("The seller won't hand over the car");
    await expect(page.getByText("The seller stopped answering after I paid.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Messages" })).toContainText("The car is exactly as listed.");
    await expectAccessible(page, "Admin report");
    const views = async () => ((await service().from("admin_actions").select("action, details").eq("auction_id", s.auctionId)).data ?? []).filter((a) => a.action === "conversation.view").length;
    expect(await views()).toBeGreaterThanOrEqual(1);

    await page.getByRole("button", { name: "Mark as in review" }).click();
    await expect.poll(async () => (await service().from("sale_reports").select("status").eq("id", report!.id).single()).data!.status).toBe("in_review");

    // Biddr support writes to both.
    await page.getByLabel("Message", { exact: true }).fill("We're looking into this. Please both reply here within 2 days.");
    await page.getByRole("button", { name: "Send as Biddr support" }).click();
    await expect(page.getByText("Sent. Both the buyer and the seller see it.")).toBeVisible();
    expect((await notificationsFor(s.winner, "new_message")).some((n) => n.data.from === "support")).toBe(true);
    const buyer = await as(browser, s.winner);
    await buyer.goto(`/account/messages/${s.conversationId}`);
    await expect(log(buyer)).toContainText("Biddr support");
    await expect(log(buyer)).toContainText("We're looking into this.");

    // Block both parties.
    await page.getByLabel("Reason (shown to them and kept in the admin log)").fill("Didn't keep to the deal, see report.");
    await page.getByRole("button", { name: /^Block the seller from selling/ }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Block from selling", exact: true }).click();
    await expect(page.getByText("The seller is blocked from selling.")).toBeVisible();
    const { data: sp } = await service().from("profiles").select("selling_blocked_at, selling_block_reason").eq("id", s.seller.id).single();
    expect(sp).toMatchObject({ selling_block_reason: "Didn't keep to the deal, see report." });
    expect((await notificationsFor(s.seller, "account_blocked"))[0]!.data).toMatchObject({ kind: "selling" });
    // The seller can't list a car any more.
    const sellerPage = await as(browser, s.seller);
    await sellerPage.goto("/sell");
    await expect(sellerPage.getByRole("region", { name: "You can't list cars right now" })).toContainText("Didn't keep to the deal");
    const insert = await (await userDb(s.seller.email)).from("auctions").insert({
      seller_id: s.seller.id, title: "x", make: "BMW", model: "M3", year: 2020, vin: "WBS00000000000001", mileage_km: 1,
      engine: "x", transmission: "x", drivetrain: "RWD", exterior_color: "x", location_city: "x", location_country: "EE",
      condition_type: "clean", starting_bid: 1000,
    });
    expect(insert.error?.message).toBe("SELLING_BLOCKED");

    // Resolve: the sale failed. The reporter is told; the decision is in the conversation.
    await page.getByRole("radio", { name: "The sale failed" }).check();
    await page.getByLabel(/^Decision/).fill("The seller refused to hand over the car. The premium will be refunded.");
    await page.getByRole("button", { name: "Resolve the report" }).click();
    await expect.poll(async () => (await service().from("sale_reports").select("status").eq("id", report!.id).single()).data!.status).toBe("resolved");
    const { data: resolved } = await service().from("sale_reports").select("status, outcome, resolution").eq("id", report!.id).single();
    expect(resolved).toMatchObject({ status: "resolved", outcome: "sale_failed" });
    await expect(page.getByRole("region", { name: "What was reported" })).toContainText("Decision (the sale failed):");
    expect((await service().from("buyer_payments").select("sale_failed_at").eq("id", s.paymentId).single()).data!.sale_failed_at).toBeTruthy();
    expect(await notificationsFor(s.winner, "report_resolved")).toHaveLength(1);
    await buyer.reload();
    await expect(log(buyer)).toContainText("Biddr's decision on the reported problem: The seller refused");
    await expect(buyer.getByText(/Status: Resolved/)).toBeVisible();

    // Resolved: admins no longer see the conversation.
    await page.reload();
    await expect(page.getByText("Hidden: the report is resolved")).toBeVisible();
    await expect(page.getByRole("list", { name: "Messages" })).toHaveCount(0);

    // Admin → Users lists the seller under "Blocked from selling" and lifts it.
    await page.goto("/admin/users");
    const card = page.getByRole("article", { name: `${s.seller.username} (selling)` });
    await card.getByRole("button", { name: `Lift block: ${s.seller.username} (selling)` }).click();
    await page.getByRole("dialog").getByLabel("Reason (kept in the admin log)").fill("Agreed with the buyer after all.");
    await page.getByRole("dialog").getByRole("button", { name: "Lift block", exact: true }).click();
    await expect
      .poll(async () => (await service().from("profiles").select("selling_blocked_at").eq("id", s.seller.id).single()).data!.selling_blocked_at)
      .toBeNull();
    expect(await notificationsFor(s.seller, "selling_unblocked")).toHaveLength(1);
  });
});
