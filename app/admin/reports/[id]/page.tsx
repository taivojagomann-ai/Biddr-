import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LocalDateTime } from "@/components/local-date-time";
import { logAdminAction, requireAdmin } from "@/lib/admin";
import { partyContact } from "@/lib/contacts";
import { formatEur } from "@/lib/format";
import { MESSAGE_COLUMNS, senderLabel, type MessageRow } from "@/lib/messages";
import { REASON_LABELS, type ReportRow } from "@/lib/reports";
import type { BuyerPaymentRow } from "@/lib/settlement";
import { cn } from "@/lib/utils";
import { ReportActions } from "./report-actions";

export const metadata: Metadata = { title: "Report" };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUS: Record<string, string> = { open: "Open", in_review: "In review", resolved: "Resolved" };

/**
 * One report. The conversation between buyer and seller is shown only while the report
 * is open or in review, and every view is logged ("conversation.view").
 */
export default async function ReportPage({ params }: { params: { id: string } }) {
  const ctx = await requireAdmin();
  if (!ctx || !UUID_RE.test(params.id)) notFound();
  const { data: report } = await ctx.db
    .from("sale_reports")
    .select("*, auction:auctions(id, title)")
    .eq("id", params.id)
    .maybeSingle<ReportRow & { auction: { id: string; title: string } | null }>();
  if (!report) notFound();
  const { data: payment } = await ctx.db.from("buyer_payments").select("*").eq("id", report.buyer_payment_id).maybeSingle<BuyerPaymentRow & { sale_failed_at: string | null }>();
  const [buyer, seller, { data: names }] = await Promise.all([
    payment ? partyContact(ctx.db, payment.winner_id) : null,
    payment ? partyContact(ctx.db, payment.seller_id) : null,
    payment
      ? ctx.db.from("profiles").select("id, username").in("id", [payment.winner_id, payment.seller_id]).returns<{ id: string; username: string | null }[]>()
      : Promise.resolve({ data: [] as { id: string; username: string | null }[] }),
  ]);
  const username = (id?: string) => (names ?? []).find((n) => n.id === id)?.username ?? "member";

  const showConversation = report.status !== "resolved" && Boolean(report.conversation_id);
  let messages: MessageRow[] = [];
  if (showConversation) {
    const { data } = await ctx.db.from("messages").select(MESSAGE_COLUMNS).eq("conversation_id", report.conversation_id!).order("created_at").returns<MessageRow[]>();
    messages = data ?? [];
    // Messages from before the sale had contact details hidden from the parties: admins see the original text.
    const masked = messages.filter((m) => m.masked).map((m) => m.id);
    if (masked.length) {
      const { data: originals } = await ctx.db.from("messages_private").select("message_id, original_body").in("message_id", masked).returns<{ message_id: string; original_body: string }[]>();
      const byId = new Map((originals ?? []).map((o) => [o.message_id, o.original_body]));
      messages = messages.map((m) => (byId.has(m.id) ? { ...m, body: byId.get(m.id)! } : m));
    }
    await logAdminAction(ctx, report.auction_id, "conversation.view", { report_id: report.id, conversation_id: report.conversation_id });
  }
  const title = report.auction?.title ?? "Car";

  return (
    <main className="container max-w-4xl py-8 sm:py-12">
      <Link href="/admin/reports" className="text-sm text-mute hover:text-chalk">
        ← Reports
      </Link>
      <h1 className="mt-4 font-wide text-2xl font-extrabold tracking-tight">
        {title}: {REASON_LABELS[report.reason]}
      </h1>
      <p className="mt-1 text-sm text-mute">
        {STATUS[report.status]} · Reported by the {report.reporter_role} on <LocalDateTime iso={report.created_at} />
      </p>

      <section aria-labelledby="report-details" className="mt-6 rounded-lg border border-line bg-panel p-4 text-sm">
        <h2 id="report-details" className="font-bold">
          What was reported
        </h2>
        <p className="mt-2 whitespace-pre-wrap break-words">{report.description}</p>
        {report.status === "resolved" ? (
          <p className="mt-3">
            <span className="font-semibold">Decision{report.outcome === "sale_failed" ? " (the sale failed)" : ""}:</span> {report.resolution}
          </p>
        ) : null}
      </section>

      <section aria-labelledby="sale-details" className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
        <h2 id="sale-details" className="sr-only">
          The sale
        </h2>
        {[
          { label: "Buyer", id: payment?.winner_id, c: buyer },
          { label: "Seller", id: payment?.seller_id, c: seller },
        ].map((p) => (
          <div key={p.label} className="rounded-lg border border-line bg-panel p-4">
            <p className="font-bold">
              {p.label}: {username(p.id)}
            </p>
            <p className="mt-1">{p.c?.fullName ?? "No name"}</p>
            <p>{p.c?.phone ?? "No phone"}</p>
            <p className="break-all">{p.c?.email ?? "No email"}</p>
          </div>
        ))}
        {payment ? (
          <p className="sm:col-span-2">
            Winning bid {formatEur(payment.winning_bid)} · Premium {formatEur(payment.premium_amount)} ({payment.status})
            {payment.paid_at ? (
              <>
                {" "}· Paid <LocalDateTime iso={payment.paid_at} dateOnly />
              </>
            ) : null}
            {payment.sale_completed_at ? " · Seller marked the sale completed" : ""}
            {payment.sale_failed_at ? " · Marked as failed" : ""}
            {" · "}
            <Link href={`/admin/auctions/${report.auction_id}`} className="underline underline-offset-4">
              Auction
            </Link>
            {" · "}
            <Link href="/admin/payments?status=paid" className="underline underline-offset-4">
              Payments (refund)
            </Link>
          </p>
        ) : null}
      </section>

      <section aria-labelledby="conversation-heading" className="mt-8">
        <h2 id="conversation-heading" className="text-lg font-bold">
          Conversation
        </h2>
        {showConversation ? (
          <>
            <p className="mt-1 text-xs text-mute">You can see this because the report is open. Your view is logged.</p>
            {messages.length === 0 ? (
              <p className="mt-3 text-sm text-mute">No messages.</p>
            ) : (
              <ol className="mt-3 space-y-2" aria-label="Messages">
                {messages.map((m) => (
                  <li key={m.id} className={cn("rounded-md border px-3 py-2 text-sm", m.sender_role === "support" ? "border-verified/60 bg-verified/10" : "border-line bg-panel")}>
                    <p className="text-xs text-mute">
                      <span className="font-semibold text-chalk">{m.sender_role === "support" ? "Biddr support" : senderLabel(m.sender_role, "admin")}</span>{" "}
                      <LocalDateTime iso={m.created_at} />
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words">{m.body}</p>
                  </li>
                ))}
              </ol>
            )}
          </>
        ) : (
          <p className="mt-1 text-sm text-mute">Hidden: the report is resolved, so admins can no longer read the conversation.</p>
        )}
      </section>

      <section aria-labelledby="actions-heading" className="mt-8 border-t border-line pt-6">
        <h2 id="actions-heading" className="sr-only">
          Actions
        </h2>
        <ReportActions reportId={report.id} status={report.status} buyer={username(payment?.winner_id)} seller={username(payment?.seller_id)} />
      </section>
    </main>
  );
}
