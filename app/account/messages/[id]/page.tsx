import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import { loginPath } from "@/lib/login";
import {
  INFO_LINE,
  MESSAGE_COLUMNS,
  SAFETY_NOTE,
  TOPIC_LABELS,
  VIEWING_COLUMNS,
  type ConversationRow,
  type ConversationState,
  type MessageRow,
  type SharedPhone,
  type ViewingRequestRow,
} from "@/lib/messages";
import { buyerPaymentOverdue, REASON_LABELS, STATUS_LABELS, type ReportRow } from "@/lib/reports";
import { getServerSupabase } from "@/lib/supabase/server";
import type { GalleryUrls } from "@/lib/types";
import { ReportConversation } from "./report-conversation";
import { ReportForm } from "./report-form";
import { Thread } from "./thread";

export const metadata: Metadata = { title: "Conversation" };
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Conv = ConversationRow & {
  auction: { id: string; title: string; gallery_urls: GalleryUrls } | null;
  payment: { status: string; paid_at: string | null; sale_completed_at: string | null } | null;
};

/**
 * One conversation between a buyer and a seller (DECISIONS.md point 14): before the sale
 * ("Contact seller", contact details hidden, viewing requests) and, for the winner, after
 * the buyer's premium is paid (the same thread, contact details shared, Report a problem).
 */
export default async function ConversationPage({ params, searchParams }: { params: { id: string }; searchParams: { viewing?: string } }) {
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(loginPath(`/account/messages/${params.id}`));
  if (!UUID_RE.test(params.id)) notFound();

  // RLS: only the buyer and the seller can read the conversation and everything in it.
  const { data: conv } = await supabase
    .from("conversations")
    .select("*, auction:auctions(id, title, gallery_urls), payment:buyer_payments(status, paid_at, sale_completed_at)")
    .eq("id", params.id)
    .maybeSingle<Conv>();
  if (!conv) notFound();
  const role = conv.buyer_id === user.id ? "buyer" : "seller";
  const otherId = role === "buyer" ? conv.seller_id : conv.buyer_id;

  const [{ data: messages }, { data: stateData }, { data: other }, { data: viewings }, { data: phones }, { data: myReports }, { data: saleReports }] =
    await Promise.all([
      supabase.from("messages").select(MESSAGE_COLUMNS).eq("conversation_id", conv.id).order("created_at").returns<MessageRow[]>(),
      supabase.rpc("conversation_state", { p_conversation: conv.id }),
      supabase.from("profiles").select("username").eq("id", otherId).maybeSingle<{ username: string | null }>(),
      supabase.from("viewing_requests").select(VIEWING_COLUMNS).eq("conversation_id", conv.id).order("created_at").returns<ViewingRequestRow[]>(),
      supabase.rpc("conversation_shared_phones", { p_conversation: conv.id }).returns<SharedPhone[]>(),
      supabase
        .from("conversation_reports")
        .select("id, created_at, resolved_at")
        .eq("conversation_id", conv.id)
        .order("created_at", { ascending: false })
        .returns<{ id: string; created_at: string; resolved_at: string | null }[]>(),
      conv.buyer_payment_id
        ? supabase.from("sale_reports").select("*").eq("buyer_payment_id", conv.buyer_payment_id).order("created_at", { ascending: false }).returns<ReportRow[]>()
        : Promise.resolve({ data: [] as ReportRow[] }),
    ]);
  const state = (stateData ?? { phase: "pre_sale", writable: false, reason: "CONVERSATION_CLOSED" }) as ConversationState;
  const sale = state.phase === "sale";
  const title = conv.auction?.title ?? "Car";
  const cover = conv.auction?.gallery_urls?.exterior?.[0];
  const otherName = other?.username ?? (role === "buyer" ? "the seller" : "the buyer");
  const openSaleReport = (saleReports ?? []).find((r) => r.status !== "resolved");
  const openReport = (myReports ?? []).find((r) => !r.resolved_at);

  return (
    <main className="container max-w-3xl py-6 sm:py-10">
      <Link href="/account/messages" className="inline-flex min-h-11 items-center text-sm text-mute hover:text-chalk">
        ← Messages
      </Link>
      <div className="mt-1 flex items-start gap-3">
        {cover ? (
          <div className="relative aspect-[4/3] w-16 shrink-0 overflow-hidden rounded-md bg-panel sm:w-20">
            <Image src={cover} alt="" fill sizes="80px" className="object-cover" />
          </div>
        ) : null}
        <div className="min-w-0">
          <h1 className="font-wide text-xl font-extrabold tracking-tight sm:text-2xl">
            {conv.auction ? (
              <Link href={`/auctions/${conv.auction.id}`} className="hover:text-signal">
                {title}
              </Link>
            ) : (
              title
            )}
          </h1>
          <p className="mt-1 text-sm text-mute">
            {role === "buyer" ? "Seller" : "Buyer"}: <span className="text-chalk">{otherName}</span>
            {" · "}
            {TOPIC_LABELS[conv.topic] ?? "Conversation"}
            {sale ? (
              <>
                {" · "}
                <Link href={role === "buyer" ? "/account/purchases" : "/account/listings"} className="underline underline-offset-4 hover:text-signal">
                  {role === "buyer" ? "My purchases" : "My listings"}
                </Link>
              </>
            ) : null}
          </p>
          {sale && state.writable && state.read_only_at ? (
            <p className="mt-1 text-xs text-mute">
              Open for messages until <LocalDateTime iso={state.read_only_at} dateOnly />.
            </p>
          ) : null}
        </div>
      </div>

      <div role="note" className="mt-5 flex gap-2 rounded-md border border-signal/40 bg-signal/10 p-3 text-sm">
        <ShieldAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-signal" />
        <div className="space-y-1">
          <p>{INFO_LINE}</p>
          {sale ? <p>{SAFETY_NOTE}</p> : null}
        </div>
      </div>

      <div className="mt-6">
        <Thread
          conversationId={conv.id}
          viewerId={user.id}
          viewerRole={role}
          initial={messages ?? []}
          readOnly={!state.writable}
          readOnlyReason={state.reason}
          otherLastReadAt={role === "buyer" ? conv.seller_last_read_at : conv.buyer_last_read_at}
          phase={state.phase}
          saleConfirmedAt={conv.sale_confirmed_at}
          initialViewings={viewings ?? []}
          initialPhones={Array.isArray(phones) ? phones : []}
          viewingFailed={searchParams.viewing === "failed"}
        />
      </div>

      {sale ? (
        <section aria-labelledby="report-heading" className="mt-10 border-t border-line pt-6">
          <h2 id="report-heading" className="text-lg font-bold">
            Problem with this sale?
          </h2>
          {(saleReports ?? []).map((r) => (
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
          {openSaleReport ? null : conv.payment?.status !== "paid" ? (
            <p className="mt-2 text-sm text-mute">This sale is closed. Contact Biddr if you need help.</p>
          ) : (
            <div className="mt-3">
              <p className="mb-3 text-sm text-mute">Tell Biddr if the other party doesn&apos;t keep to the deal. Biddr&apos;s team reviews every report.</p>
              <ReportForm conversationId={conv.id} role={role} buyerOverdue={buyerPaymentOverdue(conv.payment?.paid_at ?? null)} />
            </div>
          )}
        </section>
      ) : null}

      <section aria-labelledby="report-conversation-heading" className={sale ? "mt-8" : "mt-10 border-t border-line pt-6"}>
        <h2 id="report-conversation-heading" className="text-base font-bold">
          Report this conversation
        </h2>
        {openReport ? (
          <p className="mt-2 text-sm text-mute">
            You reported this conversation on <LocalDateTime iso={openReport.created_at} dateOnly />. Biddr&apos;s team will look at it.
          </p>
        ) : (
          <ReportConversation conversationId={conv.id} otherRole={role === "buyer" ? "seller" : "buyer"} />
        )}
      </section>
    </main>
  );
}
