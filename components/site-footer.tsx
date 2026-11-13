import Link from "next/link";
import { COMPANY_DETAILS, FOOTER_LINKS } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="mt-16 border-t border-line bg-panel/40">
      <div className="container flex flex-col gap-4 py-8 text-sm md:flex-row md:items-center md:justify-between">
        <nav aria-label="Help and information">
          <ul className="flex flex-wrap gap-x-2 gap-y-1">
            {FOOTER_LINKS.map((l) => (
              <li key={l.label}>
                {l.href.startsWith("mailto:") ? (
                  <a href={l.href} className="inline-flex min-h-11 items-center px-2 text-chalk underline-offset-4 hover:underline">
                    {l.label}
                  </a>
                ) : (
                  <Link href={l.href} className="inline-flex min-h-11 items-center px-2 text-chalk underline-offset-4 hover:underline">
                    {l.label}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </nav>
        <p className="px-2 text-mute">{COMPANY_DETAILS}</p>
      </div>
    </footer>
  );
}
