// End-to-end test settings. Everything points at the local Supabase stack
// (`supabase start`), the local stripe-mock container and the local app build.
// The defaults are the Supabase CLI's well-known local demo keys, not secrets.

export const SUPABASE_URL = process.env.E2E_SUPABASE_URL ?? "http://127.0.0.1:54321";
export const ANON_KEY =
  process.env.E2E_SUPABASE_ANON_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
export const SERVICE_ROLE_KEY =
  process.env.E2E_SUPABASE_SERVICE_ROLE_KEY ??
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
export const MAIL_URL = process.env.E2E_MAIL_URL ?? "http://127.0.0.1:54324";
export const APP_PORT = Number(process.env.E2E_APP_PORT ?? 3100);
export const APP_URL = `http://127.0.0.1:${APP_PORT}`;
export const STRIPE_MOCK_PORT = Number(process.env.E2E_STRIPE_MOCK_PORT ?? 12111);

/** Shared with the app build (playwright.e2e.config.ts). Test-only values. */
export const STRIPE_SECRET_KEY = "sk_test_e2e_only";
export const STRIPE_WEBHOOK_SECRET = "whsec_e2e_only";
export const CRON_SECRET = "e2e-cron-secret";
export const PASSWORD = "e2e-Password-1234";

/** Never run against anything but a local stack: no production data, users or payments. */
export function assertLocal(): void {
  for (const url of [SUPABASE_URL, MAIL_URL, APP_URL]) {
    const host = new URL(url).hostname;
    if (host !== "127.0.0.1" && host !== "localhost") {
      throw new Error(`E2E tests only run against a local stack, not ${url}.`);
    }
  }
}
