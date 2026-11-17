// Admin demo data. Removing demo data deletes every demo listing, including ones
// other tests create, so this file runs on its own after all the other tests
// (the "after-all" project in playwright.e2e.config.ts).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
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
    expect(await count()).toBe(7);

    // Each demo car's cover (first exterior photo) is its real photo from lib/demo/photos,
    // byte for byte; the other photos stay generated placeholders.
    const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
    const covers: Record<string, string> = {
      "2020 BMW M2 Competition": "bmw-m2-competition.webp",
      "2021 Audi RS6 Avant": "audi-rs6-avant.webp",
      "2019 Porsche 911 Carrera S": "porsche-911-carrera-s.webp",
      "2014 Audi A5 Coupe 2.0 TFSI quattro": "audi-a5-coupe.webp",
      "2017 Mercedes-AMG C63 S Saloon": "mercedes-amg-c63-s.webp",
      "2022 BMW M3 Competition": "bmw-m3-competition.webp",
      "2017 Audi RS3 Sportback": "audi-rs3-sportback.webp",
    };
    const { data: demo } = await service().from("auctions").select("id, title, gallery_urls").eq("is_demo", true);
    expect((demo ?? []).map((a) => a.title).sort()).toEqual(Object.keys(covers).sort());
    const photoHashes = new Set(Object.values(covers).map((f) => sha(readFileSync(`lib/demo/photos/${f}`))));
    for (const a of demo ?? []) {
      const exterior = (a.gallery_urls as { exterior: string[] }).exterior;
      const cover = Buffer.from(await (await page.request.get(exterior[0]!)).body());
      expect(sha(cover), `${a.title}: cover`).toBe(sha(readFileSync(`lib/demo/photos/${covers[a.title as string]}`)));
      const second = Buffer.from(await (await page.request.get(exterior[1]!)).body());
      expect(photoHashes.has(sha(second)), `${a.title}: second photo is a placeholder`).toBe(false);
    }
    // The cover is the first photo on the auction page.
    const m2 = demo!.find((a) => a.title === "2020 BMW M2 Competition")!;
    await page.goto(`/auctions/${m2.id}`);
    await expect(page.locator("img[src*='exterior%2F1.webp'], img[src*='exterior/1.webp']").first()).toBeVisible();

    await page.goto("/admin");
    await panel.getByRole("button", { name: "Remove demo data" }).click();
    const remove = page.getByRole("dialog").or(page.getByRole("alertdialog")).last();
    await remove.getByRole("button", { name: /^Remove/ }).last().click();
    await expect(remove).toBeHidden({ timeout: 120_000 });
    expect(await count()).toBe(0);
    expect((await getAuction<{ status: string }>(real.id)).status).toBe("live");
  });});
