import type Stripe from "stripe";
import { getAdminSupabase } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { markHoldAuthorized } from "@/lib/holds";
import { finishWithPaymentIntent } from "@/lib/settlement";
import { handleIdentityEvent } from "@/lib/identity";
import { receiptForRefundedCharge } from "@/lib/receipts/issue";

export const runtime = "nodejs";

type EventRow = { status: "processing" | "processed" | "failed" };

/**
 * Stripe webhooks. A backstop for the confirm route (closed tabs, 3-D Secure
 * redirects, retries) and the record of what Stripe did.
 * - Signatures are verified with STRIPE_WEBHOOK_SECRET; anything else gets 400.
 * - Each event is stored by id in stripe_events and handled once: Stripe retries
 *   and can send duplicates. A failed event answers 500 so Stripe retries it, and
 *   the error is kept for the admin's Payments section.
 */
export async function POST(req: Request): Promise<Response> {
  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await req.text(), signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return new Response("Invalid signature", { status: 400 });
  }

  const admin = getAdminSupabase();
  const object = event.data.object as { id?: string; object?: string; metadata?: Record<string, string> };
  const paymentIntentId = object.object === "payment_intent" ? (object.id ?? null) : null;
  const auctionId = /^[0-9a-f-]{36}$/i.test(object.metadata?.auction_id ?? "") ? object.metadata!.auction_id : null;

  // Claim the event. A duplicate of a processed (or in-flight) event is acknowledged without work.
  const { error: claimError } = await admin
    .from("stripe_events")
    .insert({ id: event.id, type: event.type, payment_intent_id: paymentIntentId, auction_id: auctionId, status: "processing" });
  if (claimError) {
    if (claimError.code !== "23505") {
      console.error("stripe webhook: couldn't record event", event.id, claimError);
      return new Response("Couldn't record the event", { status: 500 });
    }
    const { data: seen } = await admin.from("stripe_events").select("status").eq("id", event.id).maybeSingle<EventRow>();
    if (seen?.status !== "failed") return Response.json({ received: true, duplicate: true });
    // A retry of a failed event: handle it again.
    await admin.from("stripe_events").update({ status: "processing", error: null }).eq("id", event.id);
  }

  try {
    await handle(admin, event);
    await admin.from("stripe_events").update({ status: "processed", processed_at: new Date().toISOString(), error: null }).eq("id", event.id);
    return Response.json({ received: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("stripe webhook: handling failed", event.id, event.type, message);
    await admin.from("stripe_events").update({ status: "failed", error: message.slice(0, 1000) }).eq("id", event.id);
    return new Response("Handling failed", { status: 500 });
  }
}

async function handle(admin: ReturnType<typeof getAdminSupabase>, event: Stripe.Event): Promise<void> {
  const check = (error: { message: string } | null) => {
    if (error) throw new Error(error.message);
  };
  switch (event.type) {
    case "payment_intent.amount_capturable_updated":
      await markHoldAuthorized(admin, event.data.object);
      break;
    case "payment_intent.canceled":
      check(
        (await admin.from("bid_holds").update({ status: "released" })
          .eq("stripe_payment_intent_id", event.data.object.id).in("status", ["pending", "authorized"])).error,
      );
      break;
    case "payment_intent.payment_failed":
      check(
        (await admin.from("bid_holds").update({ status: "failed" })
          .eq("stripe_payment_intent_id", event.data.object.id).eq("status", "pending")).error,
      );
      break;
    case "payment_intent.succeeded":
      if (event.data.object.metadata?.kind === "buyer_premium") {
        // The winner paid the premium (on the site or off-session): mark it paid.
        const pi = await stripe.paymentIntents.retrieve(event.data.object.id, { expand: ["latest_charge"] });
        await finishWithPaymentIntent(admin, pi);
      } else {
        check((await admin.from("bid_holds").update({ status: "captured" }).eq("stripe_payment_intent_id", event.data.object.id)).error);
      }
      break;
    case "charge.refunded":
      // A refund on a premium (e.g. a partial refund in Stripe's dashboard): a refund receipt.
      await receiptForRefundedCharge(admin, event.data.object);
      break;
    case "identity.verification_session.processing":
    case "identity.verification_session.requires_input":
    case "identity.verification_session.canceled":
    case "identity.verification_session.verified":
      // A seller's identity check (Stripe Identity).
      await handleIdentityEvent(admin, event);
      break;
    default:
      break;
  }
}
