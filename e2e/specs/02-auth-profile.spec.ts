// Area 2: sign-in (email code and magic link, read from the local mail catcher),
// first-time profile setup, redirects, validation and signing out.
import { test, expect, signIn, expectAccessible } from "../support/fixtures";
import { codeFrom, latestEmail, linkFrom } from "../support/mail";
import { createUser } from "../support/factory";

const freshEmail = () => `e2e-login-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}@example.test`;

async function requestEmail(page: import("@playwright/test").Page, email: string) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  const sentAt = new Date(Date.now() - 2000);
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  return latestEmail(email, sentAt);
}

test.describe("sign in and profile", () => {
  test("a new user signs in with the email code, sets up a profile and returns to the page they wanted", async ({ page }) => {
    const email = freshEmail();
    await page.goto("/sell");
    await expect(page).toHaveURL(/\/login\?next=%2Fsell/);
    const mail = await requestEmail(page, email);
    await page.getByLabel("6-digit code").fill(codeFrom(mail.text));
    await page.getByRole("button", { name: "Sign in with code" }).click();

    // First sign-in: profile setup, with the original page kept.
    await expect(page).toHaveURL(/\/account\/setup\?next=%2Fsell/);
    await expectAccessible(page, "Profile setup");
    const username = `new_${Date.now().toString(36)}`.slice(0, 24);
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Full name").fill("Test Person");
    await page.getByLabel("Country").selectOption("DE");
    await page.getByLabel("Phone").fill("+49 151 2345 6789");
    await page.getByRole("button", { name: "Save and continue" }).click();
    await expect(page).toHaveURL(/\/sell$/);

    // Saved values reload.
    await page.goto("/account/setup");
    await expect(page.getByLabel("Username")).toHaveValue(username);
    await expect(page.getByLabel("Country")).toHaveValue("DE");
    await expect(page.getByLabel("Phone")).toHaveValue(/\+49/);
  });

  test("signs in with the magic link from the email", async ({ page }) => {
    const user = await createUser();
    await page.goto("/login?next=%2Fhow-it-works");
    const mail = await requestEmail(page, user.email);
    await page.goto(linkFrom(mail.text, mail.html));
    await expect(page).toHaveURL(/\/how-it-works$/);
    // Signed in: the notification bell shows in the header (desktop and phone).
    await expect(page.getByRole("button", { name: /^Notifications, / })).toBeVisible();
  });

  test("a wrong code is refused with a clear message", async ({ page }) => {
    const user = await createUser();
    await page.goto("/login");
    await requestEmail(page, user.email);
    await page.getByLabel("6-digit code").fill("000000");
    await page.getByRole("button", { name: "Sign in with code" }).click();
    await expect(page.getByText("That code is wrong or has expired.")).toBeVisible();
  });

  for (const evil of ["https://evil.example", "//evil.example", "/\\evil.example", "/login"]) {
    test(`ignores an unsafe next address (${evil}) after sign-in`, async ({ page }) => {
      const user = await createUser();
      await page.goto(`/login?next=${encodeURIComponent(evil)}`);
      const mail = await requestEmail(page, user.email);
      await page.getByLabel("6-digit code").fill(codeFrom(mail.text));
      await page.getByRole("button", { name: "Sign in with code" }).click();
      await expect(page).toHaveURL("http://localhost:3100/");
    });
  }

  test("the profile and the account menu show the account's email", async ({ page, context, isMobile }) => {
    const user = await createUser();
    await signIn(context, user);
    await page.goto("/account/setup");
    const section = page.getByRole("region", { name: "Email" });
    await expect(section).toContainText(user.email);
    await expect(section).toContainText("You sign in with this address");
    // It isn't an editable field.
    await expect(section.getByRole("textbox")).toHaveCount(0);
    // "Signed in as" in the menu.
    await page.getByRole("button", { name: isMobile ? /^Menu/ : /account menu/ }).click();
    await expect(page.getByText(`Signed in as ${user.email}`).locator("visible=true")).toBeVisible();
  });

  test("profile validation: username rules, taken username, EU country and phone format", async ({ page, context }) => {
    const taken = await createUser();
    const user = await createUser({ complete: false });
    await signIn(context, user);
    await page.goto("/account/setup");
    const save = page.getByRole("button", { name: /Save and continue|Save changes/ });

    await page.getByLabel("Username").fill("No Spaces!");
    await page.getByLabel("Full name").fill("Test Person");
    await page.getByLabel("Phone").fill("12345");
    await save.click();
    await expect(page.getByText("Use 3–24 lowercase letters, numbers or _.")).toBeVisible();
    await expect(page.getByText("Choose your country.")).toBeVisible();
    await expect(page.getByText(/Enter the number with its country code/)).toBeVisible();
    await expect(page.getByLabel("Username")).toHaveAttribute("aria-invalid", "true");

    await page.getByLabel("Username").fill(taken.username!);
    await page.getByLabel("Country").selectOption("FI");
    await page.getByLabel("Phone").fill("+358 40 1234567");
    await save.click();
    await expect(page.getByText("That username is taken. Try another.")).toBeVisible();

    const options = await page.getByLabel("Country").locator("option:not([disabled])").count();
    expect(options).toBe(27);
  });

  test("signing out ends the session, and protected pages send you to sign in", async ({ page, context, isMobile }) => {
    const user = await createUser();
    await signIn(context, user);
    await page.goto("/account/listings");
    await expect(page.getByRole("heading", { name: "My listings" })).toBeVisible();
    // Desktop: the account menu under the username. Phones: the Menu button.
    await page.getByRole("button", { name: isMobile ? "Menu" : new RegExp(`${user.username}`) }).first().click();
    await page.getByRole("button", { name: "Sign out" }).locator("visible=true").click();
    await expect(page).toHaveURL("http://localhost:3100/");
    for (const path of ["/account/listings", "/account/watchlist", "/account/notifications", "/sell", "/admin"]) {
      await page.goto(path);
      await expect(page, path).toHaveURL(/\/login\?next=/);
    }
  });
});
