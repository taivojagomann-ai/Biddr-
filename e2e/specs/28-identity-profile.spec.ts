// Area 28: the seller's identity on the profile (DECISIONS.md point 16). Verify any time
// from Profile, see the verified name and date there, and continue a check that was
// closed early on Stripe's page (it used to stay "in progress" for ever).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test, expect, signIn, expectAccessible } from "../support/fixtures";
import { createUser, service } from "../support/factory";
import { sendWebhook } from "../support/stripe";

/** What the simulated Stripe says about this member's session (e2e/.state/identity-sim.json). */
function writeIdentity(userId: string, result: Record<string, string>) {
  const dir = join(process.cwd(), "e2e", ".state");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "identity-sim.json");
  const all = existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>) : {};
  all[userId] = result;
  writeFileSync(file, JSON.stringify(all));
}

async function identityOf(userId: string) {
  const { data } = await service().from("profiles").select("identity_status, identity_session_id, identity_verified_name").eq("id", userId).single();
  return data!;
}

test.describe("identity on the profile", () => {
  test.skip(({ isMobile }) => isMobile, "covered on desktop");

  test("verify from Profile at any time: closed early → continue; submitted → checking; then Verified with the name", async ({ page, context, request }) => {
    const seller = await createUser({ role: "seller" });
    await signIn(context, seller);
    await page.goto("/account/setup");
    const section = page.getByRole("region", { name: "Identity" });
    await expect(section.locator("[data-identity-state]")).toHaveAttribute("data-identity-state", "none");
    await expect(section).toContainText("Not verified yet.");
    await expectAccessible(page, "Profile: identity");

    // Closed Stripe's page without finishing: back on the profile, nothing is stuck.
    await section.getByRole("button", { name: "Verify your identity" }).click();
    await expect(page).toHaveURL(/\/account\/setup\?identity=return/);
    await expect(section.locator("[data-identity-state]")).toHaveAttribute("data-identity-state", "unfinished");
    await expect(section).toContainText("You started the identity check but didn't finish it.");
    const started = await identityOf(seller.id);
    expect(started.identity_status).toBe("none");
    expect(started.identity_session_id).toMatch(/^vs_e2e_/);

    // Continue, and this time submit the documents: Stripe is checking them.
    writeIdentity(seller.id, { status: "processing" });
    await section.getByRole("button", { name: "Continue identity check" }).click();
    await expect(page).toHaveURL(/\/account\/setup\?identity=return/);
    await expect(section.locator("[data-identity-state]")).toHaveAttribute("data-identity-state", "checking");
    expect((await identityOf(seller.id)).identity_status).toBe("pending");

    // Stripe says verified.
    writeIdentity(seller.id, { status: "verified", first_name: "Mari", last_name: "Tamm", country: "EE" });
    const { res } = await sendWebhook(request, "identity.verification_session.verified", {
      id: (await identityOf(seller.id)).identity_session_id,
      object: "identity.verification_session",
      status: "verified",
      metadata: { user_id: seller.id },
    });
    expect(res.status()).toBe(200);
    await page.goto("/account/setup");
    await expect(section.locator("[data-identity-state]")).toHaveAttribute("data-identity-state", "verified");
    await expect(section).toContainText("Mari Tamm, verified on");
    await expect(section.getByRole("button")).toHaveCount(0);
  });

  test("a check left \"in progress\" by the old flow can be continued", async ({ page, context }) => {
    const seller = await createUser({ role: "seller" });
    await service().from("profiles").update({ identity_status: "pending", identity_session_id: "vs_e2e_stale" }).eq("id", seller.id);
    await signIn(context, seller);
    await page.goto("/account/setup");
    const section = page.getByRole("region", { name: "Identity" });
    await expect(section.locator("[data-identity-state]")).toHaveAttribute("data-identity-state", "checking");
    await expect(section.getByRole("button", { name: "Continue identity check" })).toBeVisible();
  });
});
