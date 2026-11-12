import type Stripe from "stripe";
import { getAdminSupabase } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { markHoldAuthorized } from "@/lib/holds";

export const runtime = "nodejs";

/** Backstop for the confirm route (closed tabs, 3-D Secure redirects, retries). */
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

  switch (event.type) {
    case "payment_intent.amount_capturable_updated":
      await markHoldAuthorized(admin, event.data.object);
      break;
    case "payment_intent.canceled":
      await admin.from("bid_holds").update({ status: "released" })
        .eq("stripe_payment_intent_id", event.data.object.id).in("status", ["pending", "authorized"]);
      break;
    case "payment_intent.payment_failed":
      await admin.from("bid_holds").update({ status: "failed" })
        .eq("stripe_payment_intent_id", event.data.object.id).eq("status", "pending");
      break;
    case "payment_intent.succeeded":
      await admin.from("bid_holds").update({ status: "captured" })
        .eq("stripe_payment_intent_id", event.data.object.id);
      break;
    default:
      break;
  }

  return Response.json({ received: true });
}
