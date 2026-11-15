// Area 6: questions and comments: who can post, replies, the Seller and Biddr
// team labels, live updates, links to a comment, and the database rules behind them.
import { test, expect, signIn } from "../support/fixtures";
import { createAuction, createUser, notificationsFor, service } from "../support/factory";
import { userDb } from "../support/supabase";

test.describe("questions and comments", () => {
  test("signed out you're asked to sign in; an incomplete profile is asked to finish it", async ({ page, context }) => {
    const a = await createAuction({ seller: await createUser({ role: "seller" }) });
    await page.goto(`/auctions/${a.id}`);
    const section = page.getByRole("region", { name: "Questions and comments" });
    await expect(section.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", `/login?next=/auctions/${a.id}`);
    await expect(section).toContainText("No questions yet.");

    await signIn(context, await createUser({ complete: false }));
    await page.reload();
    await expect(section.getByRole("link", { name: "Finish your profile to comment" })).toHaveAttribute(
      "href",
      `/account/setup?next=${encodeURIComponent(`/auctions/${a.id}`)}`,
    );
  });

  test("a question and the seller's reply: labels, notifications and live updates in another browser", async ({ page, context, browser }) => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({ seller });
    const asker = await createUser();
    const text = `Has the cambelt been changed? ${Date.now()}`;

    // The seller has the page open in another browser.
    const sellerCtx = await browser.newContext();
    await signIn(sellerCtx, seller);
    const sellerPage = await sellerCtx.newPage();
    await sellerPage.goto(`/auctions/${a.id}`);
    await sellerPage.waitForTimeout(1500);

    await signIn(context, asker);
    await page.goto(`/auctions/${a.id}`);
    await page.getByLabel("Ask the seller a question").fill(text);
    await page.getByRole("button", { name: "Post question" }).click();
    await expect(page.getByText(text)).toBeVisible();
    await expect(page.getByRole("status").filter({ hasText: "Your question was posted." })).toHaveCount(1);
    await expect(page.getByLabel("Ask the seller a question")).toHaveValue("");

    // It appears for the seller without reloading, and the seller gets one notification.
    await expect(sellerPage.getByText(text)).toBeVisible({ timeout: 15_000 });
    await expect.poll(async () => (await notificationsFor(seller, "question")).length).toBe(1);

    // The seller replies; the reply is labelled Seller and the asker is told.
    await sellerPage.getByRole("button", { name: `Reply to ${asker.username}` }).click();
    await sellerPage.getByLabel(`Reply to ${asker.username}`).fill("Yes, at 90,000 km.");
    await sellerPage.getByRole("button", { name: "Post reply" }).click();
    const reply = page.locator("li li", { hasText: "Yes, at 90,000 km." });
    await expect(reply).toBeVisible({ timeout: 15_000 });
    await expect(reply.getByText("Seller", { exact: true })).toBeVisible();
    await expect.poll(async () => (await notificationsFor(asker, "answer")).length).toBe(1);
    // The seller isn't notified about their own reply.
    expect(await notificationsFor(seller, "answer")).toHaveLength(0);
    await sellerCtx.close();
  });

  test("a comment by the Biddr team is labelled; a link to a comment moves focus to it", async ({ page }) => {
    const seller = await createUser({ role: "seller" });
    const a = await createAuction({ seller });
    const admin = await createUser({ role: "admin" });
    const { data } = await (await userDb(admin.email))
      .from("comments")
      .insert({ auction_id: a.id, content: "Photos of the service book were added." })
      .select("id")
      .single();
    await page.goto(`/auctions/${a.id}#comment-${data!.id}`);
    const item = page.locator(`#comment-${data!.id}`);
    await expect(item.getByText("Biddr team", { exact: true })).toBeVisible();
    await expect(item).toBeFocused();
  });

  test("database rules: no comments on drafts, no faking the author or seller label, parent must be on the same auction", async () => {
    const seller = await createUser({ role: "seller" });
    const live = await createAuction({ seller });
    const other = await createAuction({ seller });
    const draft = await createAuction({ seller, status: "draft" });
    const user = await createUser();
    const db = await userDb(user.email);

    expect((await db.from("comments").insert({ auction_id: draft.id, content: "Hi" })).error).not.toBeNull();

    // user_id and is_seller_reply can't be written by the client.
    const spoof = await db.from("comments").insert({ auction_id: live.id, content: "Hi", user_id: seller.id, is_seller_reply: true });
    expect(spoof.error).not.toBeNull();
    const { data: ok, error } = await db.from("comments").insert({ auction_id: live.id, content: "Real question" }).select("id, user_id, is_seller_reply").single();
    expect(error).toBeNull();
    expect(ok).toMatchObject({ user_id: user.id, is_seller_reply: false });

    const crossed = await db.from("comments").insert({ auction_id: other.id, parent_id: ok!.id, content: "Reply" });
    expect(crossed.error?.message).toBe("INVALID_PARENT");

    const incomplete = await createUser({ complete: false });
    const inc = await (await userDb(incomplete.email)).from("comments").insert({ auction_id: live.id, content: "Hi" });
    expect(inc.error?.message).toBe("PROFILE_INCOMPLETE");

    // Only admins can delete comments.
    await db.from("comments").delete().eq("id", ok!.id);
    const { count } = await service().from("comments").select("id", { count: "exact", head: true }).eq("id", ok!.id);
    expect(count).toBe(1);
  });
});
