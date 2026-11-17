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

/**
 * stripe-mock's request validator rejects `payment_method_types` on
 * PaymentIntent create (a stripe-mock limitation, not a Stripe one), so the mock
 * client leaves that one field out. Real Stripe always gets the full request.
 */
const mockFetch: typeof fetch = (input, init) => {
  if (typeof init?.body === "string" && String(input).endsWith("/v1/payment_intents")) {
    const params = new URLSearchParams(init.body);
    for (const key of Array.from(params.keys())) if (key.startsWith("payment_method_types")) params.delete(key);
    const headers = new Headers(init.headers);
    headers.delete("content-length");
    init = { ...init, headers, body: params.toString() };
  }
  return fetch(input, init);
};

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  appInfo: { name: "biddr" },
  typescript: true,
  ...(useStripeMock
    ? {
        host: process.env.E2E_STRIPE_MOCK_HOST ?? "127.0.0.1",
        port: Number(process.env.E2E_STRIPE_MOCK_PORT ?? 12111),
        protocol: "http" as const,
        httpClient: Stripe.createFetchHttpClient(mockFetch),
      }
    : {}),
});

export const HOLD_AMOUNT_EUR = Number(process.env.BID_HOLD_AMOUNT_EUR ?? 500);

/** Link to a payment in the Stripe dashboard (the test-mode dashboard while test keys are used). */
export function stripeDashboardUrl(paymentIntentId: string): string {
  const test = !process.env.STRIPE_SECRET_KEY?.startsWith("sk_live_");
  return `https://dashboard.stripe.com/${test ? "test/" : ""}payments/${encodeURIComponent(paymentIntentId)}`;
}
