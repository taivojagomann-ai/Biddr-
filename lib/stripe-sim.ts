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
 * - Stripe Identity: a created VerificationSession (vs_e2e_…) sends the member straight
 *   back to its return_url. Reading it back gives the result the test wrote to
 *   e2e/.state/identity-sim.json under the member's id:
 *   { "<user id>": { "status": "verified", "first_name": "…", "last_name": "…", "country": "EE" } }.
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
  return {
    id: `ch_${piId}`,
    object: "charge",
    payment_intent: piId,
    created: Math.floor(Date.now() / 1000),
    receipt_url: `https://pay.stripe.com/receipts/e2e/${piId}`,
    payment_method_details: { type: "card", card: { brand: "visa", last4: "4242" } },
  };
}

/**
 * Refunds made outside Biddr (e.g. a partial refund in Stripe's dashboard), as the test
 * wrote them to e2e/.state/stripe-sim-refunds.json: { "<charge id>": [{ "id", "amount" }] }.
 */
function refundsOf(chargeId: string): { id: string; amount: number }[] {
  const file = join(process.cwd(), "e2e", ".state", "stripe-sim-refunds.json");
  if (!existsSync(file)) return [];
  try {
    return (JSON.parse(readFileSync(file, "utf8")) as Record<string, { id: string; amount: number }[]>)[chargeId] ?? [];
  } catch {
    return [];
  }
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

/** Identity sessions this simulator created: their member (metadata.user_id). */
const identitySessions = new Map<string, Record<string, string>>();

function identityResult(userId: string | undefined): { status: string; first_name?: string; last_name?: string; country?: string } | null {
  const file = join(process.cwd(), "e2e", ".state", "identity-sim.json");
  if (!userId || !existsSync(file)) return null;
  try {
    return (JSON.parse(readFileSync(file, "utf8")) as Record<string, { status: string }>)[userId] ?? null;
  } catch {
    return null;
  }
}

function identitySession(id: string, metadata: Record<string, string>) {
  const result = identityResult(metadata.user_id);
  const status = result?.status ?? "requires_input";
  return {
    id,
    object: "identity.verification_session",
    type: "document",
    status,
    metadata,
    url: null,
    verified_outputs: status === "verified" ? { first_name: result?.first_name ?? null, last_name: result?.last_name ?? null } : null,
    last_verification_report:
      status === "verified" ? { id: `vr_${id}`, object: "identity.verification_report", document: { issuing_country: result?.country ?? null } } : null,
  };
}

/** Returns a simulated response, or null to let stripe-mock answer. */
export function simulateStripe(method: string, url: URL, body: URLSearchParams): Response | null {
  const path = url.pathname;

  if (method === "POST" && path === "/v1/identity/verification_sessions") {
    const metadata = metadataOf(body);
    // The member's id is part of the session id, so reading it back works from any route.
    const id = `vs_e2e_${(metadata.user_id ?? "").replace(/-/g, "")}_${Date.now().toString(36)}${counter++}`;
    identitySessions.set(id, metadata);
    // The hosted page is skipped: the member comes straight back.
    return json({ ...identitySession(id, metadata), status: "requires_input", url: body.get("return_url") });
  }
  const vsMatch = /^\/v1\/identity\/verification_sessions\/(vs_e2e_[A-Za-z0-9_]+)$/.exec(path);
  if (vsMatch) {
    const id = vsMatch[1]!;
    const hex = /^vs_e2e_([0-9a-f]{32})_/.exec(id)?.[1];
    const userId = hex ? `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` : "";
    return json(identitySession(id, identitySessions.get(id) ?? { user_id: userId }));
  }
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

  if (method === "GET" && path === "/v1/refunds" && (url.searchParams.get("charge") ?? "").startsWith("ch_pi_e2e_")) {
    const charge = url.searchParams.get("charge")!;
    const data = refundsOf(charge).map((r) => ({ id: r.id, object: "refund", amount: r.amount, charge, status: "succeeded", created: Math.floor(Date.now() / 1000) }));
    return json({ object: "list", data, has_more: false, url: "/v1/refunds" });
  }
  if (method === "POST" && path === "/v1/refunds" && (body.get("payment_intent") ?? "").startsWith("pi_e2e_")) {
    return json({
      id: `re_e2e_${Date.now().toString(36)}${counter++}`,
      object: "refund",
      status: "succeeded",
      amount: Number(body.get("amount") ?? 0),
      payment_intent: body.get("payment_intent"),
    });
  }
  return null;
}
