// Signed Stripe webhooks for the tests: the same signature scheme Stripe uses,
// with the test-only webhook secret. Nothing here talks to Stripe.
import Stripe from "stripe";
import type { APIRequestContext } from "@playwright/test";
import { APP_URL, STRIPE_WEBHOOK_SECRET } from "./env";

let n = 0;

/** Posts a signed event to /api/stripe/webhook and returns the response. `id` defaults to a fresh evt_ id. */
export async function sendWebhook(
  request: APIRequestContext,
  type: string,
  object: Record<string, unknown>,
  id = `evt_e2e_${Date.now().toString(36)}_${(n++).toString(36)}`,
) {
  const payload = JSON.stringify({ id, object: "event", type, data: { object } });
  const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret: STRIPE_WEBHOOK_SECRET });
  const res = await request.post(`${APP_URL}/api/stripe/webhook`, {
    data: payload,
    headers: { "stripe-signature": signature, "content-type": "application/json" },
  });
  return { id, res };
}

/**
 * Runs `fn` while holding a lock shared by every test worker. stripe-mock returns
 * the same PaymentIntent id for every create, so tests that go through the real
 * card-check route must not overlap (the desktop and phone runs would otherwise
 * clean up each other's hold).
 */
export async function withStripeMockLock<T>(fn: () => Promise<T>): Promise<T> {
  const { mkdirSync, rmSync } = await import("node:fs");
  const dir = "e2e/.state/stripe-mock.lock";
  const started = Date.now();
  for (;;) {
    try {
      mkdirSync(dir); // atomic: only one worker succeeds
      break;
    } catch {
      if (Date.now() - started > 120_000) rmSync(dir, { recursive: true, force: true }); // a crashed holder
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  try {
    return await fn();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
