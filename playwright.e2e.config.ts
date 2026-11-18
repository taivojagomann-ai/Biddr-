import { defineConfig, devices } from "@playwright/test";
import { ANON_KEY, APP_PORT, APP_URL, CRON_SECRET, SERVICE_ROLE_KEY, STRIPE_MOCK_PORT, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, SUPABASE_URL } from "./e2e/support/env";

// End-to-end tests against the local Supabase stack (`npx supabase start`) and
// stripe-mock. Never touches the production database, real users or real payments.
// Run with `npm run test:e2e`; see TESTING.md.
export default defineConfig({
  testDir: "e2e/specs",
  globalSetup: "./e2e/global-setup.ts",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: process.env.CI ? 2 : 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI
    ? [["list"], ["html", { outputFolder: "e2e-report", open: "never" }]]
    : [["list"], ["html", { outputFolder: "e2e-report", open: "never" }]],
  use: {
    baseURL: APP_URL,
    locale: "en-GB",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "desktop-berlin",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, timezoneId: "Europe/Berlin" },
      testIgnore: [/14-demo-data/],
    },
    {
      name: "phone-tallinn",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, timezoneId: "Europe/Tallinn" },
      // Database-only and server checks don't depend on the screen: run them once.
      testIgnore: [/01-database-security/, /11-lifecycle/, /14-demo-data/],
    },
    {
      // Tests that change data other tests rely on (removing all demo data) run
      // alone, after everything else has finished.
      name: "after-all",
      testMatch: /14-demo-data/,
      dependencies: ["desktop-berlin", "phone-tallinn"],
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, timezoneId: "Europe/Berlin" },
    },
  ],
  webServer: {
    command: `npx next build && npx next start -p ${APP_PORT}`,
    url: `${APP_URL}/login`,
    timeout: 600_000,
    reuseExistingServer: !process.env.CI,
    env: {
      NEXT_DIST_DIR: ".next-e2e",
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON_KEY,
      SUPABASE_SERVICE_ROLE_KEY: SERVICE_ROLE_KEY,
      NEXT_PUBLIC_SITE_URL: APP_URL,
      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_e2eonly",
      STRIPE_SECRET_KEY,
      STRIPE_WEBHOOK_SECRET,
      E2E_STRIPE_MOCK: "true",
      E2E_STRIPE_MOCK_PORT: String(STRIPE_MOCK_PORT),
      CRON_SECRET,
      // Emails go to the local mail catcher (Mailpit's SMTP port, see supabase/config.toml).
      SMTP_HOST: process.env.E2E_SMTP_HOST ?? "127.0.0.1",
      SMTP_PORT: process.env.E2E_SMTP_PORT ?? "54325",
      SMTP_SECURE: "false",
      EMAIL_FROM: "Biddr <noreply@biddr.test>",
      ENABLE_DEMO_DATA: "true",
      BID_HOLD_AMOUNT_EUR: "500",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
