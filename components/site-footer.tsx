import Link from "next/link";
import { FooterLinks } from "@/components/footer-links";
import { COMPANY_DETAILS } from "@/lib/site";

/**
 * Left: the Biddr wordmark (as in the header) linking home, with the company line
 * under it. Right: the footer links. Side by side and vertically centred on wider
 * screens; stacked on phones (logo and company line first, then the links).
 */
export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-panel/40">
      <div className="container flex flex-col gap-4 py-8 text-sm md:flex-row md:items-center md:justify-between md:gap-8">
        <div>
          <Link href="/" className="inline-block font-wide text-lg font-extrabold leading-7 tracking-tight">
            Biddr<span className="text-signal">.</span>
            <span className="sr-only">, home</span>
          </Link>
          <p className="mt-1.5 text-mute">{COMPANY_DETAILS}</p>
        </div>
        <FooterLinks />
      </div>
    </footer>
  );
}
