import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import { loginPath } from "@/lib/login";
import { MESSAGE_COLUMNS, SAFETY_NOTE, type ConversationRow, type MessageRow } from "@/lib/messages";
import { buyerPaymentOverdue, REASON_LABELS, STATUS_LABELS, type ReportRow } from "@/lib/reports";
import { getServerSupabase } from "@/lib/supabase/server";
import { ReportForm } from "./report-form";
import { Thread } from "./thread";

export const metadata: Metadata = { title: "Conversation" };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ConversationPage({ params }: { params: { id: string } }) {
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(loginPath(`/account/messages/${params.id}`));
  if (!UUID_RE.test(params.id)) notFound();

  // RLS: only the buyer and the seller can read the conversation and its messages.
  const { data: conv } = await supabase
    .from("conversations")
    .select("*, auction:auctions(id, title), payment:buyer_payments(status, paid_at, sale_completed_at)")
    .eq("id", params.id)
    .maybeSingle<ConversationRow & { auction: { id: string; title: string } | null; payment: { status: string; paid_at: string | null; sale_completed_at: string | null } | null }>();
  if (!conv) notFound();
  const role = conv.buyer_id === user.id ? "buyer" : "seller";
  const otherId = role === "buyer" ? conv.seller_id : conv.buyer_id;

  const [{ data: messages }, { data: readOnlyAt }, { data: other }, { data: reports }] = await Promise.all([
    supabase.from("messages").select(MESSAGE_COLUMNS).eq("conversation_id", conv.id).order("created_at").returns<MessageRow[]>(),
    supabase.rpc("conversation_read_only_at", { p_conversation: conv.id }),
    supabase.from("profiles").select("username").eq("id", otherId).maybeSingle<{ username: string | null }>(),
    supabase.from("sale_reports").select("*").eq("buyer_payment_id", conv.buyer_payment_id).order("created_at", { ascending: false }).returns<ReportRow[]>(),
  ]);
  const closed = conv.payment?.status !== "paid";
  const readOnly = closed || (typeof readOnlyAt === "string" && Date.parse(readOnlyAt) <= Date.now());
  const title = conv.auction?.title ?? "Car";
  const openReport = (reports ?? []).find((r) => r.status !== "resolved");

  return (
    <main className="container max-w-3xl py-10">
      <Link href="/account/messages" className="text-sm text-mute hover:text-chalk">
        ← Messages
      </Link>
      <h1 className="mt-3 font-wide text-2xl font-extrabold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-mute">
        {role === "buyer" ? "Seller" : "Buyer"}: <span className="text-chalk">{other?.username ?? (role === "buyer" ? "the seller" : "the buyer")}</span>
        {" · "}
        <Link href={role === "buyer" ? "/account/purchases" : "/account/listings"} className="underline underline-offset-4 hover:text-signal">
          {role === "buyer" ? "My purchases" : "My listings"}
        </Link>
      </p>
      {!readOnly && typeof readOnlyAt === "string" ? (
        <p className="mt-1 text-xs text-mute">
          Open for messages until <LocalDateTime iso={readOnlyAt} dateOnly />.
        </p>
      ) : null}

      <p role="note" className="mt-5 flex gap-2 rounded-md border border-signal/40 bg-signal/10 p-3 text-sm">
        <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-signal" />
        {SAFETY_NOTE}
      </p>

      <div className="mt-6">
        <Thread conversationId={conv.id} viewerRole={role} initial={messages ?? []} readOnly={readOnly} />
      </div>

      <section aria-labelledby="report-heading" className="mt-10 border-t border-line pt-6">
        <h2 id="report-heading" className="text-lg font-bold">
          Problem with this sale?
        </h2>
        {(reports ?? []).map((r) => (
          <div key={r.id} className="mt-3 rounded-md border border-line bg-panel p-3 text-sm">
            <p className="font-semibold">
              Your report: {REASON_LABELS[r.reason]} <span className="font-normal text-mute">(<LocalDateTime iso={r.created_at} dateOnly />)</span>
            </p>
            <p className="mt-1">Status: {STATUS_LABELS[r.status]}</p>
            {r.status === "resolved" && r.resolution ? (
              <p className="mt-1">
                Biddr&apos;s decision{r.outcome === "sale_failed" ? " (the sale failed)" : ""}: {r.resolution}
              </p>
            ) : null}
          </div>
        ))}
        {openReport ? null : closed ? (
          <p className="mt-2 text-sm text-mute">This sale is closed. Contact Biddr if you need help.</p>
        ) : (
          <div className="mt-3">
            <p className="mb-3 text-sm text-mute">Tell Biddr if the other party doesn&apos;t keep to the deal. Biddr&apos;s team reviews every report.</p>
            <ReportForm conversationId={conv.id} role={role} buyerOverdue={buyerPaymentOverdue(conv.payment?.paid_at ?? null)} />
          </div>
        )}
      </section>
    </main>
  );
}
