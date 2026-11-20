"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MenuCount } from "@/components/menu-count";
import { SELL_BUTTON } from "@/lib/nav";
import { useFitToViewport } from "@/hooks/use-fit-to-viewport";

export interface MenuLink {
  label: string;
  href: string;
  /** A count shown after the label, e.g. unanswered questions on My listings. */
  count?: number;
  /** What the count is (default: unanswered questions). */
  countKind?: "unanswered" | "unread";
}

/**
 * Disclosure menu for small screens: a button that shows or hides "Sell a car" and a
 * list of links. Escape closes it and returns focus to the button; navigating closes it too.
 */
export function MobileMenu({ links, signedIn, email }: { links: MenuLink[]; signedIn: boolean; email?: string | null }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  useFitToViewport(panelRef, open);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    // Clicking or tapping outside the menu closes it.
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && e.target instanceof Node && !rootRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="sm:hidden">
      <Button
        ref={buttonRef}
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="h-10"
      >
        {open ? <X aria-hidden /> : <Menu aria-hidden />}
        Menu
      </Button>
      <div
        ref={panelRef}
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 top-full overflow-y-auto border-b border-line bg-asphalt shadow-2xl"
      >
        <ul className="container flex flex-col py-2">
          <li className="pb-2 pt-1">
            <Link
              href="/sell"
              aria-current={pathname === "/sell" ? "page" : undefined}
              onClick={() => setOpen(false)}
              className={`${SELL_BUTTON} min-h-12 w-full text-base`}
            >
              Sell a car
            </Link>
          </li>
          {links.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={pathname === l.href ? "page" : undefined}
                onClick={() => setOpen(false)}
                className="flex min-h-11 items-center gap-2 rounded-md px-2 text-base hover:bg-panel aria-[current=page]:font-semibold aria-[current=page]:text-signal"
              >
                {l.label}
                {l.count ? <>{" "}<MenuCount count={l.count} kind={l.countKind} /></> : null}
              </Link>
            </li>
          ))}
          {signedIn ? (
            <li className="mt-1 border-t border-line pt-1">
              {email ? (
                <p className="px-2 pb-1 pt-2 text-xs text-mute">
                  Signed in as <span className="break-all text-chalk">{email}</span>
                </p>
              ) : null}
              <form action="/auth/signout" method="post">
                <button type="submit" className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-base hover:bg-panel">
                  <LogOut aria-hidden className="size-4" />
                  Sign out
                </button>
              </form>
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
