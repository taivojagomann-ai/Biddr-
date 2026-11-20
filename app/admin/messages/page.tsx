import type { Metadata } from "next";
import Link from "next/link";
import { LocalDateTime } from "@/components/local-date-time";
import { logAdminAction, requireAdmin } from "@/lib/admin";
import { MESSAGE_COLUMNS, TOPIC_LABELS, VIEWING_COLUMNS, senderLabel, type MessageRow, type Topic, type ViewingRequestRow } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { ConversationActions } from "./conversation-actions";

export const metadata: Metadata = { title: "Reported conversations" };
export const dynamic = "force-dynamic";

type Report = {
  id: string;
  conversation_id: string;
  reporter_id: string;
  reason: string;
  created_at: string;
  conversation: {
    id: string;
    auction_id: string;
    buyer_id: string;
    seller_id: string;
    topic: Topic;
    status: "open" | "closed";
    created_at: string;
    auction: { id: string; title: string; status: string } | null;
  } | null;
};

/**
 * Conversations with an open report (DECISIONS.md point 14): the reports, then the
 * whole conversation with the ORIGINAL text of messages whose contact details were
 * hidden from the parties. Admins see a conversation only while a report on it is open,
 * and every view is logged ("conversation.view").
 */
export default async function AdminMessagesPage() {
  const ctx = (await requireAdmin())!;
  const { data } = await ctx.db
    .from("conversation_reports")
    .select("id, conversation_id, reporter_id, reason, created_at, conversation:conversations(id, auction_id, buyer_id, seller_id, topic, status, created_at, auction:auctions(id, title, status))")
    .is("resolved_at", null)
    .order("created_at", { ascending: false })
    .limit(200)
    .returns<Report[]>();
  const byConversation = new Map<string, { conv: NonNullable<Report["conversation"]>; reports: Report[] }>();
  for (const r of data ?? []) {
    if (!r.conversation) continue;
    const entry = byConversation.get(r.conversation_id) ?? { conv: r.conversation, reports: [] };
    entry.reports.push(r);
    byConversation.set(r.conversation_id, entry);
  }
  const conversations = [...byConversation.values()];
  const convIds = conversations.map((c) => c.conv.id);
  const people = [...new Set(conversations.flatMap((c) => [c.conv.buyer_id, c.conv.seller_id]))];

  const [{ data: messages }, { data: viewings }, { data: profiles }] = await Promise.all([
    convIds.length
      ? ctx.db.from("messages").select(MESSAGE_COLUMNS).in("conversation_id", convIds).order("created_at").returns<MessageRow[]>()
      : Promise.resolve({ data: [] as MessageRow[] }),
    convIds.length
      ? ctx.db.from("viewing_requests").select(VIEWING_COLUMNS).in("conversation_id", convIds).order("created_at").returns<ViewingRequestRow[]>()
      : Promise.resolve({ data: [] as ViewingRequestRow[] }),
    people.length
      ? ctx.db.from("profiles").select("id, username, messaging_blocked_at").in("id", people).returns<{ id: string; username: string | null; messaging_blocked_at: string | null }[]>()
      : Promise.resolve({ data: [] as { id: string; username: string | null; messaging_blocked_at: string | null }[] }),
  ]);
  const maskedIds = (messages ?? []).filter((m) => m.masked).map((m) => m.id);
  const { data: originals } = maskedIds.length
    ? await ctx.db.from("messages_private").select("message_id, original_body").in("message_id", maskedIds).returns<{ message_id: string; original_body: string }[]>()
    : { data: [] as { message_id: string; original_body: string }[] };
  const original = new Map((originals ?? []).map((o) => [o.message_id, o.original_body]));
  const profile = new Map((profiles ?? []).map((p) => [p.id, p]));
  const name = (id: string) => profile.get(id)?.username ?? "member";

  await Promise.all(conversations.map((c) => logAdminAction(ctx, c.conv.auction_id, "conversation.view", { conversation_id: c.conv.id, source: "admin_messages" })));

  return (
    <main className="container max-w-4xl py-8 sm:py-12">
      <Link href="/admin" className="text-sm text-mute hover:text-chalk">
        ← All auctions
      </Link>
      <h1 className="mt-4 font-wide text-3xl font-extrabold tracking-tight">Reported conversations</h1>
      <p className="mt-1 text-sm text-mute">
        Conversations a buyer or seller reported. You see the original text, including contact details hidden from the other party.
        Each view is logged.
      </p>
      {conversations.length === 0 ? (
        <p className="mt-8 rounded-lg border border-line bg-panel p-4 text-sm text-mute">No reported conversations.</p>
      ) : (
        <ul className="mt-8 space-y-6">
          {conversations.map(({ conv, reports }) => {
            const msgs = (messages ?? []).filter((m) => m.conversation_id === conv.id);
            const vs = (viewings ?? []).filter((v) => v.conversation_id === conv.id);
            return (
              <li key={conv.id} id={`conversation-${conv.id}`} className="scroll-mt-24 rounded-lg border border-line bg-panel p-4">
                <article aria-labelledby={`conv-${conv.id}`}>
                  <h2 id={`conv-${conv.id}`} className="text-lg font-bold">
                    {conv.auction ? (
                      <Link href={`/admin/auctions/${conv.auction.id}`} className="hover:text-signal">
                        {conv.auction.title}
                      </Link>
                    ) : (
                      "Car"
                    )}
                  </h2>
                  <p className="mt-1 text-sm text-mute">
                    Buyer <span className="text-chalk">{name(conv.buyer_id)}</span> · Seller <span className="text-chalk">{name(conv.seller_id)}</span> ·{" "}
                    {TOPIC_LABELS[conv.topic]} · {conv.status === "closed" ? "Closed" : "Open"} · Auction {conv.auction?.status ?? "unknown"}
                  </p>

                  <h3 className="mt-4 text-sm font-semibold">Reports ({reports.length})</h3>
                  <ul className="mt-2 space-y-2">
                    {reports.map((r) => (
                      <li key={r.id} className="rounded-md border border-signal/40 bg-signal/10 p-3 text-sm">
                        <p className="text-xs text-mute">
                          {r.reporter_id === conv.buyer_id ? "The buyer" : "The seller"} ({name(r.reporter_id)}), <LocalDateTime iso={r.created_at} />
                        </p>
                        <p className="mt-1 whitespace-pre-wrap break-words">{r.reason}</p>
                      </li>
                    ))}
                  </ul>

                  <h3 className="mt-4 text-sm font-semibold">Conversation ({msgs.length} messages)</h3>
                  <ol className="mt-2 space-y-2">
                    {msgs.map((m) => {
                      const role = m.sender_role;
                      const orig = original.get(m.id);
                      return (
                        <li key={m.id} className={cn("rounded-md border p-2.5 text-sm", role === "support" ? "border-verified/60" : "border-line")}>
                          <p className="text-xs text-mute">
                            <span className="font-semibold text-chalk">{role === "support" ? "Biddr support" : `${senderLabel(role, "admin")} (${name(m.sender_id ?? "")})`}</span>{" "}
                            <LocalDateTime iso={m.created_at} />
                          </p>
                          <p className="mt-1 whitespace-pre-wrap break-words">{orig ?? m.body}</p>
                          {orig ? (
                            <p className="mt-1 text-xs text-mute">
                              Original text. The other party saw: <span className="italic">{m.body}</span>
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                  {vs.length ? (
                    <>
                      <h3 className="mt-4 text-sm font-semibold">Viewing requests</h3>
                      <ul className="mt-2 space-y-1 text-sm">
                        {vs.map((v) => (
                          <li key={v.id}>
                            {v.created_by === conv.buyer_id ? "Buyer" : "Seller"} proposed{" "}
                            {v.proposed_slots.map((s, i) => (
                              <span key={s}>
                                {i ? ", " : ""}
                                <LocalDateTime iso={s} />
                              </span>
                            ))}
                            : {v.status}
                            {v.confirmed_slot ? (
                              <>
                                {" "}
                                (<LocalDateTime iso={v.confirmed_slot} />)
                              </>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : null}

                  <div className="mt-4 border-t border-line pt-4">
                    <ConversationActions
                      conversationId={conv.id}
                      closed={conv.status === "closed"}
                      parties={[
                        { id: conv.buyer_id, name: name(conv.buyer_id), role: "buyer", blocked: Boolean(profile.get(conv.buyer_id)?.messaging_blocked_at) },
                        { id: conv.seller_id, name: name(conv.seller_id), role: "seller", blocked: Boolean(profile.get(conv.seller_id)?.messaging_blocked_at) },
                      ]}
                    />
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
