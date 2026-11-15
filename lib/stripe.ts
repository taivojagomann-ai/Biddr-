import "server-only";
import Stripe from "stripe";

/**
 * End-to-end tests only: E2E_STRIPE_MOCK=true points the client at the local
 * stripe-mock container instead of Stripe. Refused unless the key is a test key,
 * so a production deployment can't be switched to it by accident.
 */
const useStripeMock = process.env.E2E_STRIPE_MOCK === "true";
if (useStripeMock && !process.env.STRIPE_SECRET_KEY?.startsWith("sk_test_")) {
  throw new Error("E2E_STRIPE_MOCK needs a test secret key (sk_test_…).");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  appInfo: { name: "biddr" },
  typescript: true,
  ...(useStripeMock
    ? { host: process.env.E2E_STRIPE_MOCK_HOST ?? "127.0.0.1", port: Number(process.env.E2E_STRIPE_MOCK_PORT ?? 12111), protocol: "http" as const }
    : {}),
});

export const HOLD_AMOUNT_EUR = Number(process.env.BID_HOLD_AMOUNT_EUR ?? 500);
