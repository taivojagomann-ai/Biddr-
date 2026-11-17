"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FOOTER_LINKS } from "@/lib/site";
import { cn } from "@/lib/utils";

/**
 * The footer's links in one row (right-aligned on wider screens, wrapping and
 * left-aligned on phones). The link for the current page is marked
 * aria-current="page" and shown in orange, underlined so it doesn't rely on colour.
 * Every link is at least 44 px high.
 */
export function FooterLinks() {
  const pathname = usePathname();
  const base = "inline-flex min-h-11 items-center px-2 underline-offset-4";
  return (
    <nav aria-label="Help and information">
      <ul className="-mx-2 flex flex-wrap gap-x-2 md:justify-end">
        {FOOTER_LINKS.map((l) => {
          if (l.href.startsWith("mailto:")) {
            return (
              <li key={l.label}>
                <a href={l.href} className={cn(base, "text-chalk hover:underline")}>
                  {l.label}
                </a>
              </li>
            );
          }
          const current = pathname === l.href;
          return (
            <li key={l.label}>
              <Link
                href={l.href}
                aria-current={current ? "page" : undefined}
                className={cn(base, current ? "text-signal underline decoration-2" : "text-chalk hover:underline")}
              >
                {l.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
