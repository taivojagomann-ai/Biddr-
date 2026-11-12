"use client";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { cn } from "@/lib/utils";
import { COUNTRY_NAMES } from "@/lib/format";
import type { Country } from "@/lib/types";

export const STATUS_TABS = [
  { value: "live", label: "Live" },
  { value: "ending", label: "Ending in 24h" },
  { value: "upcoming", label: "Coming up" },
  { value: "past", label: "Past results" },
] as const;
export type FeedStatus = (typeof STATUS_TABS)[number]["value"];

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
    "h-9 rounded-md border border-line bg-panel px-2.5 text-sm text-chalk focus-visible:border-signal";

  return (
    <div className={cn("flex flex-col gap-3 md:flex-row md:items-center md:justify-between", pending && "opacity-70")}>
      <nav aria-label="Auction status" className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
        {STATUS_TABS.map((t) => (
          <Link
            key={t.value}
            href={hrefWith("status", t.value === "live" ? null : t.value)}
            scroll={false}
            aria-current={status === t.value ? "page" : undefined}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-sm transition-colors",
              status === t.value ? "bg-chalk font-semibold text-asphalt" : "text-mute hover:text-chalk",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      <div className="flex gap-2 overflow-x-auto [scrollbar-width:none]">
        <label className="sr-only" htmlFor="f-make">Make</label>
        <select id="f-make" className={selectClass} value={params.get("make") ?? ""} onChange={(e) => setParam("make", e.target.value)}>
          <option value="">All makes</option>
          {makes.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>

        <label className="sr-only" htmlFor="f-country">Country</label>
        <select id="f-country" className={selectClass} value={params.get("country") ?? ""} onChange={(e) => setParam("country", e.target.value)}>
          <option value="">EE, LV and LT</option>
          {(Object.keys(COUNTRY_NAMES) as Country[]).map((c) => (
            <option key={c} value={c}>{COUNTRY_NAMES[c]}</option>
          ))}
        </select>

        <label className="sr-only" htmlFor="f-condition">Condition</label>
        <select id="f-condition" className={selectClass} value={params.get("condition") ?? ""} onChange={(e) => setParam("condition", e.target.value)}>
          <option value="">Any history</option>
          <option value="clean">Clean history</option>
          <option value="restored">Restored, partner verified</option>
        </select>
      </div>
    </div>
  );
}
