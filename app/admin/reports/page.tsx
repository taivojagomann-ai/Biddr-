import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalDateTime } from "@/components/local-date-time";
import { requireAdmin } from "@/lib/admin";
import { REASON_LABELS, type ReportRow, type ReportStatus } from "@/lib/reports";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

const FILTERS: { key: ReportStatus | "all"; label: string }[] = [
  { key: "open", label: "Open" },
  { key: "in_review", label: "In review" },
  { key: "resolved", label: "Resolved" },
  { key: "all", label: "All" },
];
const LABEL: Record<ReportStatus, string> = { open: "Open", in_review: "In review", resolved: "Resolved" };

export default async function ReportsPage({ searchParams }: { searchParams: { status?: string } }) {
  const ctx = await requireAdmin();
  if (!ctx) notFound();
  const filter = FILTERS.find((f) => f.key === searchParams.status)?.key ?? "open";
  let query = ctx.db
    .from("sale_reports")
    .select("*, auction:auctions(title), reporter:profiles!sale_reports_reporter_id_fkey(username)")
    .order("created_at", { ascending: false })
    .limit(200);
  if (filter !== "all") query = query.eq("status", filter);
  const { data } = await query.returns<(ReportRow & { auction: { title: string } | null; reporter: { username: string | null } | null })[]>();
  const rows = data ?? [];

  return (
    <main className="container max-w-4xl py-8 sm:py-12">
      <Link href="/admin" className="text-sm text-mute hover:text-chalk">
        ← All auctions
      </Link>
      <h1 className="mt-4 font-wide text-3xl font-extrabold tracking-tight">Reports</h1>
      <p className="mt-1 text-sm text-mute">Problems reported by buyers and sellers after a sale.</p>
      <nav aria-label="Report status" className="mt-6 flex flex-wrap gap-2 text-sm">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/admin/reports?status=${f.key}`}
            aria-current={filter === f.key ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center rounded-md border px-3",
              filter === f.key ? "border-signal text-chalk" : "border-line text-mute hover:text-chalk",
            )}
          >
            {f.label}
          </Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <p className="mt-8 text-sm text-mute">No reports here.</p>
      ) : (
        <ul className="mt-6 space-y-3">
          {rows.map((r) => (
            <li key={r.id} className="rounded-lg border border-line bg-panel p-4">
              <p className="flex flex-wrap items-center justify-between gap-2">
                <Link href={`/admin/reports/${r.id}`} className="font-bold underline-offset-4 hover:underline">
                  {r.auction?.title ?? "Car"}: {REASON_LABELS[r.reason]}
                </Link>
                <span className="rounded-sm border border-line px-1.5 py-0.5 text-xs font-semibold">{LABEL[r.status]}</span>
              </p>
              <p className="mt-1 text-sm text-mute">
                Reported by the {r.reporter_role} ({r.reporter?.username ?? "member"}), <LocalDateTime iso={r.created_at} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
