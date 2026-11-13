"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown, LogOut } from "lucide-react";

export const ACCOUNT_LINKS = [
  { label: "Profile", href: "/account/setup" },
  { label: "My listings", href: "/account/listings" },
  { label: "Watchlist", href: "/account/watchlist" },
  { label: "Notifications", href: "/account/notifications" },
] as const;

/** Desktop account menu under the username. Escape closes and returns focus. */
export function AccountMenu({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const firstRef = useRef<HTMLAnchorElement>(null);
  const panelId = useId();

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (open) firstRef.current?.focus();
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
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

  const item = "flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left text-sm hover:bg-asphalt/60 aria-[current=page]:font-semibold aria-[current=page]:text-signal";
  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex min-h-10 max-w-[12rem] items-center gap-1.5 rounded-md border border-field px-3 text-sm hover:border-chalk"
      >
        <span className="truncate">{label}</span>
        <ChevronDown aria-hidden className={`size-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
        <span className="sr-only">, account menu</span>
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="absolute right-0 top-full z-50 mt-2 w-56 rounded-lg border border-line bg-panel p-1 shadow-2xl"
      >
        <ul>
          {ACCOUNT_LINKS.map((l, i) => (
            <li key={l.href}>
              <Link
                ref={i === 0 ? firstRef : undefined}
                href={l.href}
                aria-current={pathname === l.href ? "page" : undefined}
                className={item}
                onClick={() => setOpen(false)}
              >
                {l.label}
              </Link>
            </li>
          ))}
          <li className="mt-1 border-t border-line pt-1">
            <form action="/auth/signout" method="post">
              <button type="submit" className={item}>
                <LogOut aria-hidden className="size-4" />
                Sign out
              </button>
            </form>
          </li>
        </ul>
      </div>
    </div>
  );
}
