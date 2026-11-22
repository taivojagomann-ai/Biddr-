import { LocalDateTime } from "@/components/local-date-time";
import { EDIT_LABELS } from "@/lib/seller-edit";
import type { getAdminSupabase } from "@/lib/supabase/server";

type Db = ReturnType<typeof getAdminSupabase>;
type EditRow = {
  id: string;
  changes: Record<string, { from: unknown; to: unknown }>;
  rechecked: boolean;
  approval_undone: boolean;
  created_at: string;
};

function shown(v: unknown): string {
  if (v === null || v === undefined || v === "") return "(empty)";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) {
    if (!v.length) return "(empty)";
    return v.map((x) => (typeof x === "object" && x ? Object.values(x as object).filter(Boolean).join(", ") : String(x))).join("; ");
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** What the seller changed on "Edit listing" (0034), newest first, value by value. */
export async function SellerEdits({ db, auctionId }: { db: Db; auctionId: string }) {
  const { data } = await db
    .from("listing_edits")
    .select("id, changes, rechecked, approval_undone, created_at")
    .eq("auction_id", auctionId)
    .order("created_at", { ascending: false })
    .limit(30)
    .returns<EditRow[]>();
  const edits = data ?? [];
  if (!edits.length) return <p className="text-sm text-mute">The seller hasn&apos;t changed the listing since submitting it.</p>;
  return (
    <ol className="space-y-4">
      {edits.map((e) => (
        <li key={e.id} data-seller-edit className="rounded-md border border-line bg-asphalt/40 p-3 text-sm">
          <p className="font-semibold">
            <LocalDateTime iso={e.created_at} />
            {e.rechecked ? <span className="ml-2 font-normal text-mute">· the checks ran again</span> : null}
            {e.approval_undone ? <span className="ml-2 font-normal text-signal">· content approval undone</span> : null}
          </p>
          <dl className="mt-2 space-y-1.5">
            {Object.entries(e.changes).map(([k, c]) => (
              <div key={k} className="grid gap-x-3 sm:grid-cols-[11rem_1fr]">
                <dt className="text-mute">{EDIT_LABELS[k] ?? k}</dt>
                <dd className="min-w-0 break-words">
                  <span className="text-mute line-through decoration-mute/60">{shown(c.from)}</span>
                  <span aria-hidden> → </span>
                  <span className="sr-only"> changed to </span>
                  <span className="font-semibold">{shown(c.to)}</span>
                </dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ol>
  );
}
