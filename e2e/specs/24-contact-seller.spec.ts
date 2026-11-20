// Area 24: "Contact seller" before bidding (DECISIONS.md point 14). Who may start a
// conversation (the bidding checks, no card hold), contact details hidden until the
// buyer's premium is paid (admins see the original), viewing requests (propose,
// confirm, decline), phone numbers only after a confirmed viewing, rate limits,
// reports and the admin's actions, read-only when the auction ends, and the same
// thread carrying on after the sale.
import type { Browser, Page } from "@playwright/test";
import { test, expect, signIn, expectAccessible, expectNoHorizontalScroll, realtimeReady } from "../support/fixtures";
import { bid, createAuction, createUser, getAuction, iso, notificationsFor, runJob, service, setAuction, DAY, HOUR, type TestUser } from "../support/factory";
import { settle } from "../support/premium";
import { userDb } from "../support/supabase";

const TOKEN = "[contact details hidden]";

async function as(browser: Browser, user: TestUser): Promise<Page> {
  const ctx = await browser.newContext();
  await signIn(ctx, user);
  return ctx.newPage();
}

/** start_conversation as `user`; returns the conversation id or the error code. */
async function start(user: TestUser, auctionId: string, body = "Is the car still on its original paint?", topic = "question") {
  const { data, error } = await (await userDb(user.email)).rpc("start_conversation", { p_auction: auctionId, p_topic: topic, p_body: body });
  return { id: data as string | null, error: error?.message ?? null };
}

async function rpc(user: TestUser, fn: string, args: Record<string, unknown>) {
  const { data, error } = await (await userDb(user.email)).rpc(fn, args);
  return { data, error: error?.message ?? null };
}

/** A day 3 days ahead as YYYY-MM-DD: in the future in every test time zone. */
function dayAhead(days = 3): string {
  return new Date(Date.now() + days * DAY).toISOString().slice(0, 10);
}

test.describe("who can contact the seller", () => {
  test("signed out: the button leads to sign-in; an incomplete profile is sent to finish it; terms are accepted first", async ({ page, context }) => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({ seller });

    await page.goto(`/auctions/${a.id}`);
    const button = page.getByRole("region", { name: "Seller" }).getByRole("link", { name: "Contact seller" });
    await expect(button).toBeVisible();
    await button.click();
    await expect(page).toHaveURL(/\/login\?next=/);
    expect(decodeURIComponent(page.url())).toContain(`/auctions/${a.id}/contact`);

    const incomplete = await createUser({ complete: false });
    await signIn(context, incomplete);
    await page.goto(`/auctions/${a.id}/contact`);
    await expect(page.getByRole("heading", { name: "Finish your profile first" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Finish your profile" })).toHaveAttribute("href", new RegExp(`/account/setup\\?next=.*contact`));
    expect((await start(incomplete, a.id)).error).toBe("PROFILE_INCOMPLETE");

    const noTerms = await createUser({ terms: false });
    await signIn(context, noTerms);
    await page.goto(`/auctions/${a.id}/contact`);
    await expect(page.getByRole("heading", { name: "Accept the bidding terms first" })).toBeVisible();
    expect((await start(noTerms, a.id)).error).toBe("TERMS_NOT_ACCEPTED");
    await page.getByLabel("I have read and agree to the bidding terms").check();
    await page.getByLabel("I am 18 or older").check();
    await page.getByRole("button", { name: "Agree and continue" }).click();
    await expect(page.getByRole("group", { name: "What is it about?" })).toBeVisible();
  });

  test("not the seller, not after the auction, not on demo listings; no card hold needed", async ({ page, context }) => {
    const seller = await createUser({ role: "seller" });
    const live = await createAuction({ seller });
    const ended = await createAuction({ seller, status: "ended" });
    const buyer = await createUser();

    expect((await start(seller, live.id)).error).toBe("OWN_AUCTION");
    expect((await start(buyer, ended.id)).error).toBe("AUCTION_NOT_OPEN");
    const demo = await createAuction({ seller });
    await setAuction(demo.id, { is_demo: true });
    expect((await start(buyer, demo.id)).error).toBe("DEMO_AUCTION");

    await signIn(context, seller);
    await page.goto(`/auctions/${live.id}`);
    await expect(page.getByRole("link", { name: "Contact seller" })).toHaveCount(0);
    await page.goto(`/auctions/${live.id}/contact`);
    await expect(page.getByRole("heading", { name: "This is your car" })).toBeVisible();

    // No card hold: the buyer has none and still gets through. An upcoming auction works too.
    const upcoming = await createAuction({ seller, status: "upcoming" });
    const r = await start(buyer, upcoming.id, "Can I see it before it goes live?", "viewing");
    expect(r.error).toBeNull();
    const { data: conv } = await service().from("conversations").select("topic, status, buyer_payment_id").eq("id", r.id!).single();
    expect(conv).toEqual({ topic: "viewing", status: "open", buyer_payment_id: null });
    // One conversation per buyer and car: starting again adds to it.
    const again = await start(buyer, upcoming.id, "Another question.");
    expect(again.id).toBe(r.id);
    // Nobody else reads it.
    const stranger = await createUser();
    const { data: seen } = await (await userDb(stranger.email)).from("messages").select("id").eq("conversation_id", r.id!);
    expect(seen).toEqual([]);
  });
});

test.describe("the conversation", () => {
  test.describe.configure({ timeout: 150_000 });

  test("contact form, contact details hidden, viewing proposed and confirmed live, both notified, phone shared only after confirmation", async ({ page, context, browser, isMobile }) => {
    const seller = await createUser({ role: "seller", phone: "+37255500001" });
    const buyer = await createUser({ phone: "+37255500002" });
    const a = await createAuction({ seller });
    await signIn(context, buyer);

    await page.goto(`/auctions/${a.id}`);
    // Phones: also next to the bid button.
    if (isMobile) await expect(page.locator("[data-sticky-bottom=bid]").getByRole("link", { name: "Contact seller" })).toBeVisible();
    await page.getByRole("region", { name: "Seller" }).getByRole("link", { name: "Contact seller" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Contact the seller" })).toBeVisible();
    await expect(page.getByRole("note")).toContainText("Biddr never asks you to pay for a car through a link.");
    await expectAccessible(page, "Contact the seller");

    // The topic is required.
    await page.getByLabel("Message").fill("Hi! Call me on +372 5555 1234 or write to buyer.test@example.com.");
    await page.getByRole("button", { name: "Send to the seller" }).click();
    await expect(page.getByText("Choose what your message is about.")).toBeVisible();
    await page.getByRole("radio", { name: /Request a viewing or test drive/ }).check();
    await page.getByLabel("Time 1: day").fill(dayAhead());
    await page.getByLabel("Time 1: time").fill("10:00");
    await page.getByRole("button", { name: "Add another time" }).click();
    await page.getByLabel("Time 2: day").fill(dayAhead(4));
    await page.getByLabel("Time 2: time").fill("16:30");
    await page.getByRole("button", { name: "Send to the seller" }).click();

    await expect(page).toHaveURL(/\/account\/messages\/[0-9a-f-]{36}$/);
    const conversationId = page.url().split("/").pop()!;
    const log = page.getByRole("log", { name: "Messages" });
    await expect(log).toContainText(`Hi! Call me on ${TOKEN} or write to ${TOKEN}.`);
    await expect(log).not.toContainText("5555");
    await expect(page.getByText("Contact details were hidden until the sale is paid.")).toBeVisible();
    await expect(log.getByRole("article", { name: "You proposed times for a viewing" })).toBeVisible();
    await expect(page.getByRole("note")).toContainText("Viewings, test drives and inspections are arranged between you and the seller, at the buyer's cost.");
    await expectAccessible(page, "Conversation before the sale");
    // Phone numbers can't be shared before a viewing is confirmed.
    await expect(page.getByRole("button", { name: "Share my phone number for this viewing" })).toHaveCount(0);
    expect((await rpc(buyer, "share_phone", { p_conversation: conversationId })).error).toBe("VIEWING_NOT_CONFIRMED");

    // The seller confirms one of the times; the buyer's page updates live.
    const live = realtimeReady(page, `messages:${conversationId}`);
    await page.reload();
    await live;
    const sellerPage = await as(browser, seller);
    await sellerPage.goto("/account/messages");
    await expect(sellerPage.getByRole("link", { name: new RegExp(a.title) })).toContainText("Viewing or test drive");
    await sellerPage.goto(`/account/messages/${conversationId}`);
    const card = sellerPage.getByRole("article", { name: "The buyer proposed times for a viewing" });
    await expect(card.getByText(/10:00 (CET|CEST|EET|EEST)/)).toBeVisible();
    await card.getByRole("radio", { name: /10:00/ }).check();
    await card.getByRole("button", { name: "Confirm this time" }).click();
    await expect(sellerPage.getByRole("article", { name: "Viewing confirmed" })).toBeVisible();
    await expect(log.getByRole("article", { name: "Viewing confirmed" })).toContainText(/10:00 (CET|CEST|EET|EEST)/, { timeout: 15_000 });

    // Both get a notification.
    await expect.poll(async () => (await notificationsFor(buyer, "viewing_update")).some((n) => (n.data as { status?: string }).status === "confirmed")).toBe(true);
    await expect.poll(async () => (await notificationsFor(seller, "viewing_update")).some((n) => (n.data as { status?: string }).status === "confirmed")).toBe(true);

    // The buyer shares their phone, after confirming in a dialog; it can't be taken back.
    await page.reload();
    await page.getByRole("button", { name: "Share my phone number for this viewing" }).click();
    const dialog = page.getByRole("dialog", { name: "Share your phone number?" });
    await expect(dialog).toContainText("Once shared, it can't be hidden again.");
    await dialog.getByRole("button", { name: "Share my phone number" }).click();
    await expect(page.getByText("You shared your phone number +37255500002 for this viewing.")).toBeVisible();
    await sellerPage.reload();
    await expect(sellerPage.getByRole("link", { name: "+37255500002" })).toHaveAttribute("href", "tel:+37255500002");
    await expect(sellerPage.getByText("The buyer's phone:")).toBeVisible();
    // The seller hasn't shared theirs.
    await expect(page.getByText("The seller hasn't shared a phone number.")).toBeVisible();
    const { error: deleteError, count } = await (await userDb(buyer.email)).from("shared_phones").delete({ count: "exact" }).eq("conversation_id", conversationId);
    expect(deleteError !== null || count === 0).toBe(true);

    // Works at 320 px, with the message box reachable.
    await page.setViewportSize({ width: 320, height: 640 });
    await page.reload();
    await expectNoHorizontalScroll(page, "Conversation at 320 px");
    await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
    await sellerPage.context().close();
  });

  test("viewing rules: only the other party confirms, only a proposed time; decline; new times replace waiting ones", async () => {
    const seller = await createUser({ role: "seller" });
    const buyer = await createUser();
    const a = await createAuction({ seller });
    const { id } = await start(buyer, a.id, "Viewing please", "viewing");
    const slots = [iso(2 * DAY), iso(3 * DAY)];
    const proposed = await rpc(buyer, "propose_viewing", { p_conversation: id, p_slots: slots });
    expect(proposed.error).toBeNull();
    const req = proposed.data as { id: string };
    expect((await rpc(buyer, "respond_viewing", { p_request: req.id, p_action: "confirm", p_slot: slots[0] })).error).toBe("VIEWING_NOT_PENDING");
    expect((await rpc(seller, "respond_viewing", { p_request: req.id, p_action: "confirm", p_slot: iso(5 * DAY) })).error).toBe("VIEWING_SLOT_TIME");
    expect((await rpc(buyer, "propose_viewing", { p_conversation: id, p_slots: [iso(-HOUR)] })).error).toBe("VIEWING_SLOT_TIME");
    expect((await rpc(buyer, "propose_viewing", { p_conversation: id, p_slots: [iso(DAY), iso(2 * DAY), iso(3 * DAY), iso(4 * DAY)] })).error).toBe("VIEWING_SLOTS");

    // The seller proposes other times: the buyer's request is replaced.
    const counter = await rpc(seller, "propose_viewing", { p_conversation: id, p_slots: [iso(4 * DAY)] });
    expect(counter.error).toBeNull();
    const { data: old } = await service().from("viewing_requests").select("status").eq("id", req.id).single();
    expect(old!.status).toBe("cancelled");
    // The buyer declines the seller's time.
    const declined = await rpc(buyer, "respond_viewing", { p_request: (counter.data as { id: string }).id, p_action: "decline" });
    expect((declined.data as { status: string }).status).toBe("declined");
    expect((await rpc(seller, "share_phone", { p_conversation: id })).error).toBe("VIEWING_NOT_CONFIRMED");
    await expect.poll(async () => (await notificationsFor(seller, "viewing_update")).some((n) => (n.data as { status?: string }).status === "declined")).toBe(true);
  });

  test("rate limits: 20 messages an hour, 10 new conversations a day", async () => {
    test.setTimeout(240_000);
    const seller = await createUser({ role: "seller" });
    const buyer = await createUser();
    const auctions = await Promise.all(Array.from({ length: 11 }, () => createAuction({ seller })));
    const { id } = await start(buyer, auctions[0]!.id);
    for (let i = 2; i <= 20; i++) expect((await rpc(buyer, "send_message", { p_conversation: id, p_body: `Message ${i}` })).error).toBeNull();
    expect((await rpc(buyer, "send_message", { p_conversation: id, p_body: "One too many" })).error).toBe("MESSAGE_RATE_LIMIT");

    const other = await createUser();
    for (const a of auctions.slice(0, 10)) expect((await start(other, a.id, "Hello")).error).toBeNull();
    expect((await start(other, auctions[10]!.id, "Hello")).error).toBe("CONVERSATION_RATE_LIMIT");
  });
});

test.describe("reports and admins", () => {
  test.skip(({ isMobile }) => isMobile, "admin desktop");
  test.describe.configure({ timeout: 150_000 });

  test("the original text is kept for admins only; Report; the admin sees it, closes the conversation and blocks the sender; all logged", async ({ page, context, seed }) => {
    const seller = await createUser({ role: "seller" });
    const buyer = await createUser();
    const a = await createAuction({ seller });
    const { id } = await start(buyer, a.id, "Pay the deposit at https://pay-me.example.com or call 5551 2345.");
    const { data: msg } = await service().from("messages").select("id, body, masked").eq("conversation_id", id!).single();
    expect(msg).toMatchObject({ masked: true, body: `Pay the deposit at ${TOKEN} or call ${TOKEN}.` });
    const { data: original } = await service().from("messages_private").select("original_body").eq("message_id", msg!.id).single();
    expect(original!.original_body).toContain("https://pay-me.example.com");
    // Members can't read the originals, not even the sender.
    const { data: own } = await (await userDb(buyer.email)).from("messages_private").select("original_body");
    expect(own ?? []).toEqual([]);

    // The seller reports it (a reason is required).
    await signIn(context, seller);
    await page.goto(`/account/messages/${id}`);
    await page.getByRole("button", { name: "Report", exact: true }).click();
    await page.getByRole("button", { name: "Send report" }).click();
    await expect(page.getByText("Describe the problem in at least 10 characters.")).toBeVisible();
    await page.getByLabel(/What's wrong\?/).fill("The buyer wants me to use a payment link. Looks like a scam.");
    await page.getByRole("button", { name: "Send report" }).click();
    await expect(page.getByText(/You reported this conversation on/)).toBeVisible();
    await expect.poll(async () => (await notificationsFor(seed.admin, "conversation_reported")).some((n) => (n.data as { conversation_id?: string }).conversation_id === id)).toBe(true);

    // The admin sees the original, unmasked text; the view is logged.
    await signIn(context, seed.admin);
    await page.goto("/admin/messages");
    const item = page.locator(`#conversation-${id}`);
    await expect(item).toContainText("The buyer wants me to use a payment link.");
    await expect(item).toContainText("Pay the deposit at https://pay-me.example.com or call 5551 2345.");
    await expect(item).toContainText(`The other party saw: Pay the deposit at ${TOKEN}`);
    await expectAccessible(page, "Admin: reported conversations");
    const actions = async () => ((await service().from("admin_actions").select("action, details").eq("auction_id", a.id)).data ?? []).map((r) => r.action);
    await expect.poll(actions).toContain("conversation.view");

    // Block the buyer from messaging, then close the conversation.
    await item.getByRole("button", { name: /^Block buyer from messaging: / }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Reason (kept in the admin log)").fill("Sent a payment link before the sale.");
    await dialog.getByRole("button", { name: "Block from messaging" }).click();
    await expect(item.getByRole("button", { name: /^Block buyer from messaging: / })).toHaveCount(0);
    await item.getByRole("button", { name: "Close conversation" }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Reason (kept in the admin log)").fill("Scam attempt, see report.");
    await dialog.getByRole("button", { name: "Close conversation" }).click();
    await expect(page.locator(`#conversation-${id}`)).toHaveCount(0);
    await expect.poll(actions).toEqual(expect.arrayContaining(["user.block_messaging", "conversation.close"]));

    expect((await rpc(seller, "send_message", { p_conversation: id, p_body: "Hello?" })).error).toBe("CONVERSATION_CLOSED_BY_BIDDR");
    const other = await createAuction({ seller: await createUser({ role: "seller" }) });
    expect((await start(buyer, other.id)).error).toBe("MESSAGING_BLOCKED");
    expect((await notificationsFor(buyer, "account_blocked")).some((n) => (n.data as { kind?: string }).kind === "messaging")).toBe(true);

    // The seller sees the conversation is closed.
    await signIn(context, seller);
    await page.goto(`/account/messages/${id}`);
    await expect(page.getByText("Biddr closed this conversation.").last()).toBeVisible();
    await expect(page.getByLabel("Message", { exact: true })).toHaveCount(0);

    // Admin → Users lifts the block.
    await signIn(context, seed.admin);
    await page.goto("/admin/users");
    await page.getByRole("button", { name: new RegExp(`Lift block: ${buyer.username} \\(messaging\\)`) }).click();
    dialog = page.getByRole("dialog");
    await dialog.getByLabel("Reason (kept in the admin log)").fill("Talked to the member, it was a misunderstanding.");
    await dialog.getByRole("button", { name: "Lift block" }).click();
    await expect.poll(async () => (await start(buyer, other.id)).error).toBeNull();
  });
});

test.describe("when the auction ends", () => {
  test.describe.configure({ timeout: 150_000 });

  test("other buyers' conversations become read-only; the winner's carries on after the premium is paid, unmasked from then on, with the divider", async ({ page, context, request }) => {
    const seller = await createUser({ role: "seller", fullName: "Sella Seller", phone: "+37255512345" });
    const winner = await createUser({ verifiedBidder: true, fullName: "Wynn Winner", phone: "+358401234567" });
    const loser = await createUser();
    const a = await createAuction({ seller, startingBid: 10_000 });

    const w = await start(winner, a.id, "Can I call you? +372 5123 4567", "viewing");
    const l = await start(loser, a.id, "Any rust?");
    expect(w.error).toBeNull();
    expect(l.error).toBeNull();

    // The winner bids with a card hold, then the auction ends sold.
    await service().from("profiles").update({ stripe_customer_id: `cus_e2e${winner.id.replace(/-/g, "")}` }).eq("id", winner.id);
    const holdPi = `pi_e2e_hold_ok_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    await service().from("bid_holds").insert({ auction_id: a.id, user_id: winner.id, stripe_payment_intent_id: holdPi, amount: 500, status: "authorized" });
    expect((await bid(winner, a.id, 12_000)).error).toBeNull();
    await setAuction(a.id, { ends_at: iso(-1000) });
    await expect
      .poll(async () => {
        await runJob("advance_auction_states");
        return (await getAuction<{ status: string }>(a.id)).status;
      })
      .toBe("sold");

    // The other buyer: read-only.
    expect((await rpc(loser, "send_message", { p_conversation: l.id, p_body: "Hello?" })).error).toBe("AUCTION_ENDED");
    await signIn(context, loser);
    await page.goto(`/account/messages/${l.id}`);
    await expect(page.getByText("This auction has ended.")).toBeVisible();
    await expect(page.getByLabel("Message", { exact: true })).toHaveCount(0);

    // The premium is paid: the winner's conversation becomes the after-sale one.
    await settle(request);
    await expect.poll(async () => (await service().from("conversations").select("buyer_payment_id, topic").eq("id", w.id!).single()).data?.buyer_payment_id).not.toBeNull();
    const { count } = await service().from("conversations").select("id", { count: "exact", head: true }).eq("auction_id", a.id).eq("buyer_id", winner.id);
    expect(count).toBe(1);
    const sent = await rpc(winner, "send_message", { p_conversation: w.id, p_body: "Paid! My number is +372 5123 4567." });
    expect((sent.data as { body: string; masked: boolean })).toMatchObject({ body: "Paid! My number is +372 5123 4567.", masked: false });
    const { data: first } = await service().from("messages").select("body, masked").eq("conversation_id", w.id!).order("created_at").limit(1).single();
    expect(first).toEqual({ body: `Can I call you? ${TOKEN}`, masked: true });

    await signIn(context, winner);
    await page.goto(`/account/messages/${w.id}`);
    await expect(page.getByText("Sale confirmed: contact details are now shared")).toBeVisible();
    await expect(page.getByRole("note")).toContainText("Biddr never asks you to pay through messages.");
    await expect(page.getByRole("heading", { name: "Problem with this sale?" })).toBeVisible();
    await expect(page.getByLabel("Message", { exact: true })).toBeVisible();
    await expectAccessible(page, "Conversation after the sale");
  });
});
