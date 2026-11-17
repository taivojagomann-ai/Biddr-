import { ExternalLink } from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import { formatEur } from "@/lib/format";
import { cn } from "@/lib/utils";

export interface HoldRow {
  id: string;
  amount: number;
  status: "pending" | "authorized" | "released" | "captured" | "failed";
  stripe_payment_intent_id: string;
  created_at: string;
  updated_at: string | null;
  user: { username: string | null } | null;
}

export interface EventRow {
  id: string;
  type: string;
  status: "processing" | "processed" | "failed";
  error: string | null;
  received_at: string;
  payment_intent_id: string | null;
}

/** Plain words for each hold status, so the admin doesn't need Stripe's vocabulary. */
const HOLD_STATUS: Record<HoldRow["status"], string> = {
  pending: "Card check started",
  authorized: "Held",
  released: "Released",
  captured: "Captured",
  failed: "Failed",
};

export function PaymentsPanel({ holds, events }: { holds: (HoldRow & { dashboardUrl: string })[]; events: EventRow[] }) {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="mb-2 font-semibold">Card holds ({holds.length})</h3>
        {holds.length === 0 ? (
          <p className="text-sm text-mute">No card holds.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="text-xs text-mute">
                <tr>
                  <th scope="col" className="py-2 pr-3 font-semibold">Bidder</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Amount</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Status</th>
                  <th scope="col" className="py-2 pr-3 font-semibold">Started</th>
                  <th scope="col" className="py-2 font-semibold">Stripe</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {holds.map((h) => (
                  <tr key={h.id}>
                    <td className="py-2 pr-3">{h.user?.username ?? "Member"}</td>
                    <td className="py-2 pr-3 tabular">{formatEur(h.amount)}</td>
                    <td className={cn("py-2 pr-3", h.status === "failed" && "text-signal")}>{HOLD_STATUS[h.status]}</td>
                    <td className="py-2 pr-3 text-mute tabular">
                      <LocalDateTime iso={h.created_at} />
                    </td>
                    <td className="py-2">
                      <a
                        href={h.dashboardUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex min-h-11 items-center gap-1 underline underline-offset-4 hover:text-signal"
                      >
                        <span className="font-mono text-xs">{h.stripe_payment_intent_id}</span>
                        <ExternalLink aria-hidden className="size-3.5" />
                        <span className="sr-only"> (opens Stripe in a new tab)</span>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div>
        <h3 className="mb-2 font-semibold">Stripe events</h3>
        {events.length === 0 ? (
          <p className="text-sm text-mute">No Stripe events yet.</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2">
                <time dateTime={e.received_at} className="text-xs text-mute tabular">
                  <LocalDateTime iso={e.received_at} />
                </time>
                <span className="font-mono text-xs">{e.type}</span>
                <span className={cn("text-xs font-semibold", e.status === "failed" ? "text-signal" : "text-mute")}>
                  {e.status === "processed" ? "Handled" : e.status === "failed" ? "Failed" : "Being handled"}
                </span>
                {e.error ? <span className="w-full text-xs text-signal">{e.error}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
