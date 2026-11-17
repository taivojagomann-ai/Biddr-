import "server-only";

/**
 * END-TO-END TESTS ONLY (E2E_STRIPE_MOCK=true with a test key; see lib/stripe.ts).
 * stripe-mock answers with fixed sample data and can't act out captures, declines
 * or cards that need authentication. For ids the tests make up (pi_e2e_…,
 * pm_e2e_…), this answers like Stripe would; every other request goes to
 * stripe-mock unchanged. Never used with real Stripe.
 *
 * Conventions:
 * - Hold PaymentIntents pi_e2e_…: "expired" in the id → canceled (the hold lapsed);
 *   otherwise requires_capture for €500. The saved card is pm_e2e_authreq when the
 *   id contains "authreq", pm_e2e_declined for "declined", else pm_e2e_ok.
 * - Off-session charges with pm_e2e_ok succeed; pm_e2e_authreq fails with
 *   authentication_required; pm_e2e_declined fails with card_declined.
 * - Created PaymentIntents (pi_e2e_new_…) are remembered with their metadata,
 *   amount and status; one the test lists in e2e/.state/stripe-sim-paid.json
 *   reads back as succeeded (the winner "paid in the browser").
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

let counter = 0;

/** PaymentIntents this simulator created: their metadata, amount and status, like Stripe keeps them. */
const created = new Map<string, { amount: number; status: string; metadata: Record<string, string> }>();

/**
 * PaymentIntents the test says the winner paid in the browser (Stripe Elements
 * can't run in the tests): e2e/.state/stripe-sim-paid.json, a JSON array of ids.
 */
function paidInBrowser(id: string): boolean {
  const file = join(process.cwd(), "e2e", ".state", "stripe-sim-paid.json");
  if (!existsSync(file)) return false;
  try {
    return (JSON.parse(readFileSync(file, "utf8")) as string[]).includes(id);
  } catch {
    return false;
  }
}

function metadataOf(body: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of body) {
    const m = /^metadata\[(.+)\]$/.exec(k);
    if (m) out[m[1]!] = v;
  }
  return out;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "request-id": "req_e2e_sim" } });

function receipt(piId: string) {
  return { id: `ch_${piId}`, object: "charge", receipt_url: `https://pay.stripe.com/receipts/e2e/${piId}` };
}

function paymentIntent(id: string, fields: Record<string, unknown>) {
  return {
    id,
    object: "payment_intent",
    currency: "eur",
    client_secret: `${id}_secret_e2e`,
    metadata: {},
    latest_charge: null,
    last_payment_error: null,
    ...fields,
  };
}

function holdPaymentMethod(id: string): string {
  if (id.includes("authreq")) return "pm_e2e_authreq";
  if (id.includes("declined")) return "pm_e2e_declined";
  return "pm_e2e_ok";
}

/** Returns a simulated response, or null to let stripe-mock answer. */
export function simulateStripe(method: string, url: URL, body: URLSearchParams): Response | null {
  const path = url.pathname;
  const piMatch = /^\/v1\/payment_intents\/(pi_e2e_[A-Za-z0-9_]+)(\/(capture|cancel|confirm))?$/.exec(path);

  if (piMatch) {
    const id = piMatch[1]!;
    const action = piMatch[3];
    const made = created.get(id);
    if (action === "capture") {
      const cents = Number(body.get("amount_to_capture") ?? 50_000);
      return json(paymentIntent(id, { status: "succeeded", amount: 50_000, amount_received: cents, amount_capturable: 0, latest_charge: receipt(id) }));
    }
    if (action === "cancel") return json(paymentIntent(id, { status: "canceled", amount: 50_000, amount_capturable: 0 }));
    if (made) {
      const status = paidInBrowser(id) ? "succeeded" : made.status;
      const paid = status === "succeeded";
      return json(
        paymentIntent(id, {
          status,
          amount: made.amount,
          amount_received: paid ? made.amount : 0,
          metadata: made.metadata,
          latest_charge: paid ? receipt(id) : null,
        }),
      );
    }
    // A bidder's card hold.
    const expired = id.includes("expired");
    return json(
      paymentIntent(id, {
        status: expired ? "canceled" : "requires_capture",
        amount: 50_000,
        amount_capturable: expired ? 0 : 50_000,
        payment_method: holdPaymentMethod(id),
        capture_method: "manual",
      }),
    );
  }

  if (method === "POST" && path === "/v1/payment_intents" && body.get("metadata[kind]") === "buyer_premium") {
    const cents = Number(body.get("amount") ?? 0);
    const id = `pi_e2e_new_${cents}_${Date.now().toString(36)}${counter++}`;
    const pm = body.get("payment_method");
    const metadata = metadataOf(body);
    const remember = (status: string) => created.set(id, { amount: cents, status, metadata });
    if (!pm) {
      // On-session (the winner's "Complete payment"): the browser confirms it.
      remember("requires_payment_method");
      return json(paymentIntent(id, { status: "requires_payment_method", amount: cents, metadata }));
    }
    if (pm === "pm_e2e_authreq") {
      remember("requires_payment_method");
      return json(
        {
          error: {
            type: "card_error",
            code: "authentication_required",
            message: "This payment requires authentication.",
            payment_intent: paymentIntent(id, { status: "requires_payment_method", amount: cents }),
          },
        },
        402,
      );
    }
    if (pm === "pm_e2e_declined") {
      remember("requires_payment_method");
      return json(
        {
          error: {
            type: "card_error",
            code: "card_declined",
            decline_code: "generic_decline",
            message: "Your card was declined.",
            payment_intent: paymentIntent(id, { status: "requires_payment_method", amount: cents }),
          },
        },
        402,
      );
    }
    if (pm.startsWith("pm_e2e_")) {
      remember("succeeded");
      return json(paymentIntent(id, { status: "succeeded", amount: cents, amount_received: cents, metadata, latest_charge: receipt(id) }));
    }
  }

  if (method === "POST" && path === "/v1/refunds" && (body.get("payment_intent") ?? "").startsWith("pi_e2e_")) {
    return json({ id: `re_e2e_${counter++}`, object: "refund", status: "succeeded", amount: Number(body.get("amount") ?? 0), payment_intent: body.get("payment_intent") });
  }
  return null;
}
