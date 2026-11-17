/**
 * Shown on every page while Stripe runs with test keys (pk_test_…), so nobody
 * mistakes the site for a live one. Never shown with live keys. Dark text on
 * yellow: well above 4.5:1 contrast (WCAG 1.4.3).
 */
export function TestModeBanner() {
  if (!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.startsWith("pk_test_")) return null;
  return (
    <div className="bg-[#FACC15] px-4 py-1.5 text-center text-xs font-semibold text-[#0A0A0B] sm:text-sm">
      <p>Test mode: no real payments. Use Stripe test cards.</p>
    </div>
  );
}
