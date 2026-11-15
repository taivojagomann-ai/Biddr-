import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Car, ChevronRight } from "lucide-react";
import { DemoBadge } from "@/components/auction/badges";
import { Countdown } from "@/components/auction/countdown";
import { requireAdmin } from "@/lib/admin";
import { isDemoDataEnabled } from "@/lib/demo/config";
import { countDemoAuctions } from "@/lib/demo/seed";
import { DemoDataPanel } from "./demo-data-panel";
import { ADMIN_STATUS_LABELS, ADMIN_TABS, type AdminTab } from "@/lib/admin-schemas";
import { formatEur } from "@/lib/format";
import type { Auction, Country } from "@/lib/types";
import { cn } from "@/lib/utils";

type Row = Pick<
  Auction,
  | "id" | "title" | "status" | "condition_type" | "location_country" | "created_at" | "gallery_urls"
  | "current_bid" | "bid_count" | "ends_at" | "starts_at" | "is_demo"
> & { seller: { username: string | null; country: Country | null } | null };

// Loading demo data uploads ~75 files; give the server action time to finish.
export const maxDuration = 60;

const ROW_COLUMNS =
  "id,title,status,is_demo,condition_type,location_country,created_at,gallery_urls,current_bid,bid_count,ends_at,starts_at,seller:profiles!auctions_seller_id_fkey(username,country)";

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Tallinn" });

export default async function AdminPage({ searchParams }: { searchParams: { tab?: string; requests?: string } }) {
  const ctx = await requireAdmin();
  if (!ctx) notFound();

  const active = ADMIN_TABS.find((t) => t.key === searchParams.tab) ?? ADMIN_TABS[0];

  const counts = await Promise.all(
    ADMIN_TABS.map(async (t) => {
      const { count } = await ctx.db.from("auctions").select("id", { count: "exact", head: true }).in("status", [...t.statuses]);
      return [t.key, count ?? 0] as const;
    }),
  );
  const countOf = Object.fromEntries(counts) as Record<AdminTab, number>;

  // Live auctions whose seller asked to withdraw them (0015).
  const { data: requestRows } = await ctx.db
    .from("auction_private")
    .select("auction_id, auction:auctions!inner(status)")
    .eq("withdraw_request_status", "pending")
    .eq("auction.status", "live")
    .returns<{ auction_id: string }[]>();
  const requestIds = new Set((requestRows ?? []).map((r) => r.auction_id));
  const onlyRequests = active.key === "live" && searchParams.requests === "1";

  let query = ctx.db.from("auctions").select(ROW_COLUMNS).in("status", [...active.statuses]).limit(200);
  if (onlyRequests) query = query.in("id", requestIds.size ? [...requestIds] : ["00000000-0000-0000-0000-000000000000"]);
  query =
    active.key === "live"
      ? query.order("ends_at", { ascending: true })
      : query.order("created_at", { ascending: false });
  const { data, error } = await query.returns<Row[]>();
  const rows = data ?? [];
  const now = Date.now();
  const demoEnabled = isDemoDataEnabled();
  const demoAuctions = demoEnabled ? await countDemoAuctions(ctx.db) : 0;

  return (
    <main className="container py-8 sm:py-12">
      <h1 className="font-wide text-3xl font-extrabold tracking-tight">Admin</h1>
      <p className="mt-1 text-sm text-mute">Review submitted cars, schedule auctions and manage live ones.</p>

      <nav aria-label="Auction status" className="-mx-4 mt-6 overflow-x-auto px-4">
        <ul className="flex min-w-max gap-1 border-b border-line">
          {ADMIN_TABS.map((t) => {
            const isActive = t.key === active.key;
            return (
              <li key={t.key}>
                <Link
                  href={t.key === "review" ? "/admin" : `/admin?tab=${t.key}`}
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "-mb-px flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-semibold transition-colors",
                    isActive ? "border-signal text-chalk" : "border-transparent text-mute hover:text-chalk",
                  )}
                >
                  {t.label}
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs tabular",
                      isActive ? "bg-signal text-asphalt" : "bg-line text-chalk",
                    )}
                  >
                    {countOf[t.key]}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {active.key === "live" ? (
        <nav aria-label="Live auction filter" className="mt-4 flex flex-wrap gap-2 text-sm">
          <Link
            href="/admin?tab=live"
            aria-current={onlyRequests ? undefined : "page"}
            className={cn(
              "inline-flex min-h-9 items-center rounded-full border px-3 [@media(pointer:coarse)]:min-h-11",
              onlyRequests ? "border-field text-mute hover:text-chalk" : "border-chalk font-semibold",
            )}
          >
            All live
          </Link>
          <Link
            href="/admin?tab=live&requests=1"
            aria-current={onlyRequests ? "page" : undefined}
            className={cn(
              "inline-flex min-h-9 items-center gap-2 rounded-full border px-3 [@media(pointer:coarse)]:min-h-11",
              onlyRequests ? "border-chalk font-semibold" : "border-field text-mute hover:text-chalk",
            )}
          >
            Withdrawal requests
            <span className={cn("rounded-full px-2 py-0.5 text-xs tabular", requestIds.size ? "bg-signal text-asphalt" : "bg-line text-chalk")}>
              {requestIds.size}
            </span>
          </Link>
        </nav>
      ) : null}

      {error ? (
        <p role="alert" className="mt-6 text-sm text-signal">
          We couldn&apos;t load the auctions. Reload the page.
        </p>
      ) : rows.length === 0 ? (
        <p className="mt-10 text-center text-sm text-mute">Nothing here right now.</p>
      ) : (
        <ul className="mt-6 divide-y divide-line overflow-hidden rounded-lg border border-line bg-panel">
          {rows.map((r) => {
            const cover = r.gallery_urls?.exterior?.[0];
            return (
              <li key={r.id}>
                <Link href={`/admin/auctions/${r.id}`} className="flex items-center gap-4 p-3 hover:bg-asphalt/40">
                  <div className="relative aspect-[4/3] w-20 shrink-0 overflow-hidden rounded-md bg-asphalt sm:w-28">
                    {cover ? (
                      <Image src={cover} alt="" fill sizes="112px" className="object-cover" />
                    ) : (
                      <Car aria-hidden className="absolute inset-0 m-auto size-6 text-mute" />
                    )}
                  </div>
                  <div className="grid min-w-0 flex-1 gap-1 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center md:gap-4">
                    <div className="min-w-0">
                      <p className="truncate font-semibold">
                        {r.is_demo ? <DemoBadge className="mr-2 align-middle" /> : null}
                        {r.title}
                      </p>
                      {requestIds.has(r.id) ? (
                        <p className="text-xs font-semibold text-signal">Withdrawal requested</p>
                      ) : null}
                      <p className="truncate text-xs text-mute">
                        {r.seller?.username ?? "No username"} · {r.location_country} ·{" "}
                        {r.condition_type === "restored_accident" ? "Restored" : "Clean"}
                        {active.key === "closed" || active.key === "finished" ? ` · ${ADMIN_STATUS_LABELS[r.status]}` : ""}
                      </p>
                    </div>
                    <p className="text-xs text-mute">Submitted {dateFmt.format(new Date(r.created_at))}</p>
                    {r.status === "live" ? (
                      <div className="flex flex-wrap items-baseline gap-x-3 text-sm">
                        <span className="font-semibold tabular">{r.current_bid ? formatEur(r.current_bid) : "No bids"}</span>
                        <span className="text-xs text-mute">
                          {r.bid_count} {r.bid_count === 1 ? "bid" : "bids"}
                        </span>
                        <Countdown
                          endsAt={r.ends_at}
                          startsAt={r.starts_at}
                          status={r.status}
                          initialNow={now}
                          className="text-xs"
                        />
                      </div>
                    ) : r.status === "upcoming" && r.starts_at ? (
                      <p className="text-xs text-mute">Opens {dateFmt.format(new Date(r.starts_at))}</p>
                    ) : (
                      <span className="hidden md:block" />
                    )}
                  </div>
                  <ChevronRight aria-hidden className="size-5 shrink-0 text-mute" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {demoEnabled ? <DemoDataPanel demoAuctions={demoAuctions} /> : null}
    </main>
  );
}
