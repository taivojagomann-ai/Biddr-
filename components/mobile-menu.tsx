"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { LogOut, Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface MenuLink {
  label: string;
  href: string;
}

/**
 * Disclosure menu for small screens: a button that shows or hides a list of links.
 * Escape closes it and returns focus to the button; navigating closes it too.
 */
export function MobileMenu({ links, signedIn }: { links: MenuLink[]; signedIn: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

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
        id={panelId}
        hidden={!open}
        className="absolute inset-x-0 top-full border-b border-line bg-asphalt shadow-2xl"
      >
        <ul className="container flex flex-col py-2">
          {links.map((l) => (
            <li key={l.href}>
              <Link
                href={l.href}
                aria-current={pathname === l.href ? "page" : undefined}
                onClick={() => setOpen(false)}
                className="flex min-h-11 items-center rounded-md px-2 text-base hover:bg-panel aria-[current=page]:font-semibold aria-[current=page]:text-signal"
              >
                {l.label}
              </Link>
            </li>
          ))}
          {signedIn ? (
            <li className="mt-1 border-t border-line pt-1">
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
