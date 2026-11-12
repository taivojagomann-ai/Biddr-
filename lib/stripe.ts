import "server-only";
import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  appInfo: { name: "biddr" },
  typescript: true,
});

export const HOLD_AMOUNT_EUR = Number(process.env.BID_HOLD_AMOUNT_EUR ?? 500);
