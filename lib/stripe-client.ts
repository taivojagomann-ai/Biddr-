import { loadStripe, type Appearance } from "@stripe/stripe-js";

/** Browser Stripe, shared by the card check and the buyer's premium payment. */
export const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!);

/** Stripe Elements in Biddr's dark theme. */
export const stripeAppearance: Appearance = {
  theme: "night",
  variables: {
    colorPrimary: "#FF5500",
    colorBackground: "#0A0A0B",
    colorText: "#F4F4F5",
    colorTextSecondary: "#A1A1AA",
    colorDanger: "#FF5500",
    borderRadius: "8px",
    fontFamily: "Archivo, system-ui, sans-serif",
  },
  rules: { ".Input": { border: "1px solid #71717A" }, ".Input:focus": { border: "1px solid #FF5500", boxShadow: "none" } },
};
