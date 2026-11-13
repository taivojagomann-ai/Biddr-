import { defineConfig, devices } from "@playwright/test";

// Accessibility test: builds the app against a mock Supabase (tests/a11y/mock-supabase.mjs)
// and scans every page with axe. Run with `npm run test:a11y`.
const MOCK_PORT = 54329;
const APP_PORT = 3210;

export default defineConfig({
  testDir: "tests/a11y",
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${APP_PORT}`,
    trace: "off",
    timezoneId: "Europe/Tallinn",
    locale: "en-GB",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "phone", use: { ...devices["Pixel 7"] } },
  ],
  webServer: [
    {
      command: "node tests/a11y/mock-supabase.mjs",
      url: `http://127.0.0.1:${MOCK_PORT}/storage/v1/object/public/ping.png`,
      env: { MOCK_SUPABASE_PORT: String(MOCK_PORT) },
      reuseExistingServer: !process.env.CI,
    },
    {
      // Builds into .next with the mock's URL baked in: run `npm run build` again before using .next for anything else.
      command: `npm run build && npx next start -p ${APP_PORT} -H 127.0.0.1`,
      url: `http://127.0.0.1:${APP_PORT}/login`,
      timeout: 300_000,
      reuseExistingServer: !process.env.CI,
      env: {
        NEXT_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${MOCK_PORT}`,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "a11y-anon-key",
        SUPABASE_SERVICE_ROLE_KEY: "a11y-service-role-key",
        NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY: "pk_test_a11y",
        STRIPE_SECRET_KEY: "sk_test_a11y",
        NEXT_TELEMETRY_DISABLED: "1",
      },
    },
  ],
});
