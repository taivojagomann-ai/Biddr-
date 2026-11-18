import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalDateTime } from "@/components/local-date-time";
import { requireAdmin } from "@/lib/admin";
import { LiftBlock } from "./lift-block";

export const metadata: Metadata = { title: "Users" };
export const dynamic = "force-dynamic";

type Blocked = { id: string; username: string | null; full_name: string | null; bidding_blocked_at: string; bidding_block_reason: string | null };

/** Members blocked from bidding (a buyer's premium not paid in time), and lifting the block. */
export default async function AdminUsersPage() {
  const ctx = await requireAdmin();
  if (!ctx) notFound();
  const { data } = await ctx.db
    .from("profiles")
    .select("id, username, full_name, bidding_blocked_at, bidding_block_reason")
    .not("bidding_blocked_at", "is", null)
    .order("bidding_blocked_at", { ascending: false })
    .limit(200)
    .returns<Blocked[]>();
  const rows = data ?? [];
  // Live auctions they're leading: their existing bids still stand, so an admin may want to act.
  const leading = new Map<string, { id: string; title: string }[]>();
  if (rows.length) {
    const { data: live } = await ctx.db
      .from("auctions")
      .select("id, title, leading_bidder_id")
      .eq("status", "live")
      .in("leading_bidder_id", rows.map((r) => r.id))
      .returns<{ id: string; title: string; leading_bidder_id: string }[]>();
    for (const a of live ?? []) leading.set(a.leading_bidder_id, [...(leading.get(a.leading_bidder_id) ?? []), a]);
  }

  return (
    <main className="container max-w-4xl py-8 sm:py-12">
      <Link href="/admin" className="text-sm text-mute hover:text-chalk">
        ← All auctions
      </Link>
      <h1 className="mt-4 font-wide text-3xl font-extrabold tracking-tight">Users</h1>
      <p className="mt-1 text-sm text-mute">
        Members blocked from bidding because a buyer&apos;s premium wasn&apos;t paid in time. Only an admin can lift a block.
      </p>
      <h2 className="mt-8 text-lg font-bold">Blocked from bidding ({rows.length})</h2>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-mute">Nobody is blocked.</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((r) => {
            const name = r.username ?? r.full_name ?? "Member";
            const lead = leading.get(r.id) ?? [];
            return (
              <li key={r.id} className="rounded-lg border border-line bg-panel p-4">
                <article aria-labelledby={`user-${r.id}`}>
                  <h3 id={`user-${r.id}`} className="font-bold">
                    {name}
                    {r.full_name && r.username ? <span className="ml-2 font-normal text-mute">({r.full_name})</span> : null}
                  </h3>
                  <p className="mt-1 text-sm">{r.bidding_block_reason ?? "Blocked from bidding."}</p>
                  <p className="mt-1 text-xs text-mute">
                    Blocked <LocalDateTime iso={r.bidding_blocked_at} />
                  </p>
                  {lead.length ? (
                    <p className="mt-2 text-sm text-signal">
                      Still the high bidder on:{" "}
                      {lead.map((a, i) => (
                        <span key={a.id}>
                          {i ? ", " : ""}
                          <Link href={`/admin/auctions/${a.id}`} className="underline underline-offset-4">
                            {a.title}
                          </Link>
                        </span>
                      ))}
                    </p>
                  ) : null}
                  <div className="mt-3">
                    <LiftBlock userId={r.id} name={name} />
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
