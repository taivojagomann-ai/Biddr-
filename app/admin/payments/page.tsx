import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { notFound } from "next/navigation";
import { LocalDateTime } from "@/components/local-date-time";
import { requireAdmin } from "@/lib/admin";
import { formatEur } from "@/lib/format";
import type { BuyerPaymentRow, BuyerPaymentStatus } from "@/lib/settlement";
import { stripeDashboardUrl } from "@/lib/stripe";
import { cn } from "@/lib/utils";
import { PaymentActions } from "./payment-actions";

export const metadata: Metadata = { title: "Payments" };
export const dynamic = "force-dynamic";

const FILTERS: { key: BuyerPaymentStatus | "all"; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Processing" },
  { key: "action_required", label: "Needs the winner" },
  { key: "failed", label: "Failed" },
  { key: "paid", label: "Paid" },
  { key: "refunded", label: "Refunded" },
  { key: "unpaid", label: "Buyer didn't pay" },
  { key: "cancelled", label: "Cancelled" },
];
const LABEL = Object.fromEntries(FILTERS.map((f) => [f.key, f.label])) as Record<string, string>;

type Row = BuyerPaymentRow & {
  auction: { title: string } | null;
  winner: { username: string | null } | null;
};

/** Every buyer's premium, with status filters, Stripe links and admin actions. */
export default async function AdminPaymentsPage({ searchParams }: { searchParams: { status?: string } }) {
  const ctx = await requireAdmin();
  if (!ctx) notFound();
  const filter = FILTERS.find((f) => f.key === searchParams.status)?.key ?? "all";
  let query = ctx.db
    .from("buyer_payments")
    .select("*, auction:auctions(title), winner:profiles!buyer_payments_winner_id_fkey(username)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (filter !== "all") query = query.eq("status", filter);
  const { data } = await query.returns<Row[]>();
  const rows = data ?? [];
  const { data: invoiceRows } = rows.length
    ? await ctx.db
        .from("invoices")
        .select("id, number, kind, buyer_payment_id")
        .in("buyer_payment_id", rows.map((r) => r.id))
        .returns<{ id: string; number: string; kind: "invoice" | "credit_note"; buyer_payment_id: string }[]>()
    : { data: [] };
  const docs = new Map<string, { id: string; number: string; kind: "invoice" | "credit_note" }[]>();
  for (const d of invoiceRows ?? []) docs.set(d.buyer_payment_id, [...(docs.get(d.buyer_payment_id) ?? []), d]);

  return (
    <main className="container py-8 sm:py-12">
      <Link href="/admin" className="text-sm text-mute hover:text-chalk">
        ← All auctions
      </Link>
      <h1 className="mt-4 font-wide text-3xl font-extrabold tracking-tight">Payments</h1>
      <p className="mt-1 text-sm text-mute">
        Buyer&apos;s premiums for sold cars. Links open the payment in Stripe&apos;s dashboard.{" "}
        <Link href="/admin/invoices" className="font-semibold text-chalk underline underline-offset-4">
          All invoices
        </Link>
      </p>

      <nav aria-label="Payment status" className="mt-6 flex flex-wrap gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === "all" ? "/admin/payments" : `/admin/payments?status=${f.key}`}
            aria-current={filter === f.key ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center rounded-full border px-4",
              filter === f.key ? "border-chalk bg-chalk font-semibold text-asphalt" : "border-field hover:border-chalk",
            )}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="mt-8 text-sm text-mute">No payments here.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {rows.map((r) => {
            const title = r.auction?.title ?? "Car";
            const captured = r.captured_from_hold;
            return (
              <li key={r.id} className="rounded-lg border border-line bg-panel p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-bold">
                    <Link href={`/admin/auctions/${r.auction_id}`} className="underline-offset-4 hover:underline">
                      {title}
                    </Link>
                  </h2>
                  <span className={cn("text-sm font-semibold", r.status === "failed" || r.status === "action_required" ? "text-signal" : r.status === "paid" ? "text-verified" : "text-mute")}>
                    {LABEL[r.status]}
                  </span>
                </div>
                <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                  <div className="flex justify-between gap-3"><dt className="text-mute">Winner</dt><dd>{r.winner?.username ?? "Member"}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-mute">Winning bid</dt><dd className="tabular">{formatEur(r.winning_bid)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-mute">Premium</dt><dd className="tabular font-semibold">{formatEur(r.premium_amount)}</dd></div>
                  <div className="flex justify-between gap-3"><dt className="text-mute">From the hold</dt><dd className="tabular">{captured === null ? "Not yet" : formatEur(captured)}</dd></div>
                  {r.due_at ? <div className="flex justify-between gap-3"><dt className="text-mute">Due</dt><dd><LocalDateTime iso={r.due_at} /></dd></div> : null}
                  {r.paid_at ? <div className="flex justify-between gap-3"><dt className="text-mute">Paid</dt><dd><LocalDateTime iso={r.paid_at} /></dd></div> : null}
                </dl>
                {r.failure_reason ? <p className="mt-2 text-sm text-signal">{r.failure_reason}</p> : null}
                <p className="mt-2 flex flex-wrap gap-x-4 text-sm">
                  {r.hold_payment_intent_id ? (
                    <a href={stripeDashboardUrl(r.hold_payment_intent_id)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4 hover:text-signal">
                      Card hold in Stripe <ExternalLink aria-hidden className="size-3.5" />
                      <span className="sr-only"> for {title} (opens in a new tab)</span>
                    </a>
                  ) : null}
                  {r.remainder_payment_intent_id ? (
                    <a href={stripeDashboardUrl(r.remainder_payment_intent_id)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4 hover:text-signal">
                      Card charge in Stripe <ExternalLink aria-hidden className="size-3.5" />
                      <span className="sr-only"> for {title} (opens in a new tab)</span>
                    </a>
                  ) : null}
                  {(docs.get(r.id) ?? []).map((d) => (
                    <a key={d.id} href={`/api/invoices/${d.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4 hover:text-signal">
                      {d.kind === "credit_note" ? "Credit note" : "Invoice"} {d.number} (PDF) <ExternalLink aria-hidden className="size-3.5" />
                      <span className="sr-only"> for {title} (opens in a new tab)</span>
                    </a>
                  ))}
                </p>
                <div className="mt-2">
                  <PaymentActions paymentId={r.id} status={r.status} title={title} premium={formatEur(r.premium_amount)} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
