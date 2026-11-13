"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils";
import { COUNTRY_NAMES } from "@/lib/format";
import type { Country } from "@/lib/types";
import { STATUS_TABS, type FeedStatus } from "@/lib/feed";

export function AuctionFilters({ makes, status }: { makes: string[]; status: FeedStatus }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const hrefWith = (key: string, value: string | null) => {
    const next = new URLSearchParams(params.toString());
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
    <div className={cn("flex flex-col gap-3 md:flex-row md:items-end md:justify-between", pending && "opacity-70")} aria-busy={pending}>
      <nav aria-label="Auction status" className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
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

      <div className="grid grid-cols-1 gap-2 min-[400px]:grid-cols-3 md:flex md:gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-mute" htmlFor="f-make">Make</label>
          <select id="f-make" className={selectClass} value={params.get("make") ?? ""} onChange={(e) => setParam("make", e.target.value)}>
            <option value="">All makes</option>
            {makes.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-mute" htmlFor="f-country">Country</label>
          <select id="f-country" className={selectClass} value={params.get("country") ?? ""} onChange={(e) => setParam("country", e.target.value)}>
            <option value="">All three countries</option>
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
  );
}
