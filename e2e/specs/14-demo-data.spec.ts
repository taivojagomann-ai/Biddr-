// Admin demo data. Removing demo data deletes every demo listing, including ones
// other tests create, so this file runs on its own after all the other tests
// (the "after-all" project in playwright.e2e.config.ts).
import { test, expect, signIn } from "../support/fixtures";
import { createAuction, createUser, getAuction, service } from "../support/factory";

test.describe("admin demo data", () => {
  test("demo data loads and is removed again, without touching real listings", async ({ page, context, seed }) => {
    test.setTimeout(240_000);
    const real = await createAuction({ seller: await createUser({ role: "seller" }) });
    await signIn(context, seed.admin);
    await page.goto("/admin");
    const panel = page.locator("section[aria-labelledby='demo-heading']");
    const label = (await panel.getByRole("button", { name: "Reset demo data" }).count()) ? "Reset demo data" : "Load demo data";
    await panel.getByRole("button", { name: label }).click();
    const dialog = page.getByRole("dialog").or(page.getByRole("alertdialog")).last();
    await dialog.getByRole("button", { name: /^(Load|Reset)/ }).last().click();
    await expect(dialog).toBeHidden({ timeout: 180_000 });
    const count = async () => (await service().from("auctions").select("id", { count: "exact", head: true }).eq("is_demo", true)).count ?? 0;
    expect(await count()).toBeGreaterThan(5);

    await panel.getByRole("button", { name: "Remove demo data" }).click();
    const remove = page.getByRole("dialog").or(page.getByRole("alertdialog")).last();
    await remove.getByRole("button", { name: /^Remove/ }).last().click();
    await expect(remove).toBeHidden({ timeout: 120_000 });
    expect(await count()).toBe(0);
    expect((await getAuction<{ status: string }>(real.id)).status).toBe("live");
  });});
