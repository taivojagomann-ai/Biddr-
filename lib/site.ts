// Site-wide copy and links. Placeholders in [brackets] must be filled in before launch.

/** TODO before launch: the real support address. */
export const SUPPORT_EMAIL = "[support email]";

/** TODO before launch: legal entity details shown in the footer. */
export const COMPANY_DETAILS = "[Company name, registry code, address]";

/** Footer links, in the same order on every page (WCAG 3.2.6 Consistent help). */
export const FOOTER_LINKS = [
  { label: "How it works", href: "/how-it-works" },
  { label: "Help and contact", href: `mailto:${SUPPORT_EMAIL}` },
  { label: "Terms", href: "/terms" },
  { label: "Bidding terms", href: "/terms/bidding" },
  { label: "Privacy", href: "/privacy" },
] as const;

/**
 * Absolute site origin for shares and Open Graph tags. Set NEXT_PUBLIC_SITE_URL in
 * Vercel (e.g. https://biddr.ee). Previews fall back to VERCEL_URL, local dev to localhost.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/+$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}
