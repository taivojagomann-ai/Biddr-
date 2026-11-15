"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useTransition } from "react";
import { cn } from "@/lib/utils";
import { COUNTRY_NAMES } from "@/lib/format";
import type { Country } from "@/lib/types";
import { STATUS_TABS, type FeedStatus } from "@/lib/feed";
import { AuctionSearch } from "./auction-search";

export function AuctionFilters({ status }: { status: FeedStatus }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const navRef = useRef<HTMLElement>(null);

  // On phones the tab row scrolls sideways: bring the active tab into view. Only the
  // row scrolls (never the page), and without animation if motion is reduced.
  useEffect(() => {
    const nav = navRef.current;
    const active = nav?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!nav || !active) return;
    const left = active.offsetLeft - nav.offsetLeft;
    const right = left + active.offsetWidth;
    if (left >= nav.scrollLeft && right <= nav.scrollLeft + nav.clientWidth) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    nav.scrollTo({ left: Math.max(0, left - 16), behavior: reduced ? "auto" : "smooth" });
  }, [status]);

  const hrefWith = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
    next.delete("make"); // the old Make filter, replaced by search
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    return qs ? `${pathname}?${qs}` : pathname;
  };

  const setParam = (key: string, value: string) =>
    startTransition(() => router.replace(hrefWith(key, value || null), { scroll: false }));

  const selectClass =
    "h-9 w-full rounded-md border border-field bg-panel px-2.5 text-sm text-chalk focus-visible:border-signal [@media(pointer:coarse)]:h-11";

  return (
    <div className="flex flex-col gap-4">
      <AuctionSearch />
      <div className={cn("flex flex-col gap-3 md:flex-row md:items-end md:justify-between", pending && "opacity-70")} aria-busy={pending}>
        <nav ref={navRef} aria-label="Auction status" className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
          {STATUS_TABS.map((t) => (
            <Link
              key={t.value}
              href={hrefWith("status", t.value === "live" ? null : t.value)}
              scroll={false}
              aria-current={status === t.value ? "page" : undefined}
              className={cn(
                "inline-flex min-h-9 items-center whitespace-nowrap rounded-md px-3 text-sm transition-colors [@media(pointer:coarse)]:min-h-11",
                status === t.value ? "bg-chalk font-semibold text-asphalt" : "text-mute hover:text-chalk",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>

        <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 md:flex md:gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-mute" htmlFor="f-country">Country</label>
            <select id="f-country" className={selectClass} value={params.get("country") ?? ""} onChange={(e) => setParam("country", e.target.value)}>
              <option value="">All countries</option>
              {(Object.keys(COUNTRY_NAMES) as Country[]).map((c) => (
                <option key={c} value={c}>{COUNTRY_NAMES[c]}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-mute" htmlFor="f-condition">History</label>
            <select id="f-condition" className={selectClass} value={params.get("condition") ?? ""} onChange={(e) => setParam("condition", e.target.value)}>
              <option value="">Any history</option>
              <option value="clean">Clean history</option>
              <option value="restored">Restored, partner verified</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
