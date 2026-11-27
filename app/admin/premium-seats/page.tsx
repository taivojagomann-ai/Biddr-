import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalDateTime } from "@/components/local-date-time";
import { requireAdmin } from "@/lib/admin";
import { formatEur } from "@/lib/format";
import { activePaidSeats, seatSettings } from "@/lib/premium-seat";
import { PremiumSeatRowActions, PremiumSettingsForm } from "./premium-seat-admin";

export const metadata: Metadata = { title: "Premium seats" };
export const dynamic = "force-dynamic";

type Purchase = {
  id: string;
  auction_id: string;
  amount_cents: number;
  status: string;
  paid_at: string | null;
  refunded_at: string | null;
  refund_reason: string | null;
  created_at: string;
  auction: { title: string; status: string; ends_at: string | null; premium_seat_until: string | null; premium_seat_source: string | null } | null;
  seller: { username: string | null } | null;
};

const STATUS: Record<string, string> = { pending: "Not paid yet", paid: "Paid", failed: "Failed", refunded: "Refunded", canceled: "Cancelled" };

/** Premium seats (0036): settings, every purchase, and seats set by admins. Refunds and removals are logged. */
export default async function AdminPremiumSeatsPage() {
  const ctx = await requireAdmin();
  if (!ctx) notFound();
  const [settings, active, { data: purchases }, { data: adminSeats }] = await Promise.all([
    seatSettings(ctx.db),
    activePaidSeats(ctx.db),
    ctx.db
      .from("premium_seat_purchases")
      .select("id, auction_id, amount_cents, status, paid_at, refunded_at, refund_reason, created_at, auction:auctions(title, status, ends_at, premium_seat_until, premium_seat_source), seller:profiles!premium_seat_purchases_seller_id_fkey(username)")
      .in("status", ["paid", "refunded"])
      .order("created_at", { ascending: false })
      .limit(200)
      .returns<Purchase[]>(),
    ctx.db
      .from("auctions")
      .select("id, title, premium_seat_until")
      .eq("premium_seat_source", "admin")
      .gt("premium_seat_until", new Date().toISOString())
      .returns<{ id: string; title: string; premium_seat_until: string }[]>(),
  ]);

  return (
    <main className="container max-w-5xl space-y-8 py-8 sm:py-12">
      <div>
        <Link href="/admin" className="inline-flex min-h-11 items-center text-sm text-mute hover:text-chalk">
          ← Admin
        </Link>
        <h1 className="font-wide text-3xl font-extrabold tracking-tight">Premium seats</h1>
        <p className="mt-1 text-sm text-mute">
          Optional paid places in the home page&apos;s featured carousel, always labelled &quot;Featured&quot;. Paid seats active now: {active} of{" "}
          {settings.limit}.
        </p>
      </div>

      <section aria-labelledby="settings-heading" className="rounded-lg border border-line bg-panel p-4">
        <h2 id="settings-heading" className="text-lg font-bold">
          Settings
        </h2>
        <PremiumSettingsForm initial={settings} />
      </section>

      <section aria-labelledby="paid-heading" className="space-y-3">
        <h2 id="paid-heading" className="text-lg font-bold">
          Purchases
        </h2>
        {purchases?.length ? (
          <ul className="divide-y divide-line rounded-lg border border-line bg-panel">
            {purchases.map((p) => {
              const active = p.status === "paid" && p.auction?.premium_seat_source === "paid" && p.auction.premium_seat_until && Date.parse(p.auction.premium_seat_until) > Date.now();
              return (
                <li key={p.id} data-seat-purchase={p.id} className="space-y-2 p-3 text-sm">
                  <p className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link href={`/admin/auctions/${p.auction_id}`} className="font-semibold underline underline-offset-4 hover:text-signal">
                      {p.auction?.title ?? "Auction"}
                    </Link>
                    <span className="tabular">{formatEur(p.amount_cents / 100)}</span>
                  </p>
                  <p className="text-mute">
                    Seller {p.seller?.username ?? "–"} · {STATUS[p.status] ?? p.status}
                    {p.paid_at ? (
                      <>
                        {" "}
                        · paid <LocalDateTime iso={p.paid_at} />
                      </>
                    ) : null}
                    {active ? (
                      <>
                        {" "}
                        · featured until <LocalDateTime iso={p.auction!.premium_seat_until} />
                      </>
                    ) : null}
                    {p.refunded_at ? (
                      <>
                        {" "}
                        · refunded <LocalDateTime iso={p.refunded_at} />
                        {p.refund_reason ? ` (${p.refund_reason})` : ""}
                      </>
                    ) : null}
                  </p>
                  {p.status === "paid" ? <PremiumSeatRowActions purchaseId={p.id} auctionId={p.auction_id} title={p.auction?.title ?? "auction"} live={p.auction?.status === "live"} /> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-mute">No premium seats have been bought yet.</p>
        )}
      </section>

      <section aria-labelledby="admin-seats-heading" className="space-y-3">
        <h2 id="admin-seats-heading" className="text-lg font-bold">
          Set by admins
        </h2>
        {adminSeats?.length ? (
          <ul className="divide-y divide-line rounded-lg border border-line bg-panel">
            {adminSeats.map((a) => (
              <li key={a.id} className="p-3 text-sm">
                <Link href={`/admin/auctions/${a.id}#premium-seat`} className="font-semibold underline underline-offset-4 hover:text-signal">
                  {a.title}
                </Link>{" "}
                <span className="text-mute">
                  · until <LocalDateTime iso={a.premium_seat_until} /> (remove it on the auction page)
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-mute">None right now.</p>
        )}
      </section>
    </main>
  );
}
