import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Car, MessageSquare } from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import { loginPath } from "@/lib/login";
import { isUnread, TOPIC_LABELS, type ConversationRow, type MessageRow } from "@/lib/messages";
import type { GalleryUrls } from "@/lib/types";
import { getServerSupabase } from "@/lib/supabase/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Messages" };
export const dynamic = "force-dynamic";

type Row = ConversationRow & { auction: { title: string; gallery_urls: GalleryUrls } | null };
type Latest = Pick<MessageRow, "conversation_id" | "sender_id" | "sender_role" | "body" | "created_at">;

/** Every conversation this member has with a buyer or a seller, newest first. */
export default async function MessagesPage() {
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(loginPath("/account/messages"));

  // RLS: only conversations this member is a party to.
  const { data } = await supabase
    .from("conversations")
    .select("*, auction:auctions(title, gallery_urls)")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .returns<Row[]>();
  const rows = data ?? [];

  const others = [...new Set(rows.map((c) => (c.buyer_id === user.id ? c.seller_id : c.buyer_id)))];
  const [{ data: profiles }, { data: latest }] = await Promise.all([
    others.length
      ? supabase.from("profiles").select("id, username").in("id", others).returns<{ id: string; username: string | null }[]>()
      : Promise.resolve({ data: [] as { id: string; username: string | null }[] }),
    rows.length
      ? supabase
          .from("messages")
          .select("conversation_id, sender_id, sender_role, body, created_at")
          .in("conversation_id", rows.map((c) => c.id))
          .order("created_at", { ascending: false })
          .limit(500)
          .returns<Latest[]>()
      : Promise.resolve({ data: [] as Latest[] }),
  ]);
  const names = new Map((profiles ?? []).map((p) => [p.id, p.username]));
  const last = new Map<string, Latest>();
  for (const m of latest ?? []) if (!last.has(m.conversation_id)) last.set(m.conversation_id, m);

  return (
    <main className="container max-w-3xl py-10">
      <h1 className="font-wide text-3xl font-extrabold tracking-tight">Messages</h1>
      <p className="mt-2 text-sm text-mute">
        Your conversations with buyers and sellers: questions and viewings before an auction ends, and the handover after a sale.
      </p>
      {rows.length === 0 ? (
        <p className="mt-8 rounded-lg border border-line bg-panel p-4 text-sm text-mute">
          <MessageSquare aria-hidden className="mr-2 inline size-4" />
          No conversations yet.
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-line rounded-lg border border-line bg-panel">
          {rows.map((c) => {
            const mine = c.buyer_id === user.id ? "buyer" : "seller";
            const readAt = mine === "buyer" ? c.buyer_last_read_at : c.seller_last_read_at;
            const m = last.get(c.id);
            // New activity (a message or a viewing update) since you last read it; your own actions mark it read.
            const unread = isUnread(c.last_message_at, readAt);
            const other = names.get(mine === "buyer" ? c.seller_id : c.buyer_id) ?? (mine === "buyer" ? "the seller" : "the buyer");
            const title = c.auction?.title ?? "Car";
            const cover = c.auction?.gallery_urls?.exterior?.[0];
            return (
              <li key={c.id}>
                <Link href={`/account/messages/${c.id}`} className="flex min-h-11 gap-3 p-3 hover:bg-asphalt/40 sm:p-4">
                  <span className="relative aspect-[4/3] w-16 shrink-0 overflow-hidden rounded-md bg-asphalt sm:w-20">
                    {cover ? (
                      <Image src={cover} alt="" fill sizes="80px" className="object-cover" />
                    ) : (
                      <Car aria-hidden className="absolute inset-0 m-auto size-5 text-mute" />
                    )}
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-start justify-between gap-3">
                      <span className={cn("min-w-0 truncate", unread ? "font-bold" : "font-semibold")}>{title}</span>
                      {unread ? (
                        <span className="shrink-0 rounded-sm bg-signal px-1.5 py-0.5 text-[11px] font-bold leading-none text-asphalt">
                          New<span className="sr-only"> messages</span>
                        </span>
                      ) : null}
                    </span>
                    <span className="truncate text-sm text-mute">
                      {mine === "buyer" ? "Seller" : "Buyer"}: <span className="text-chalk">{other}</span> · {TOPIC_LABELS[c.topic] ?? "Conversation"}
                    </span>
                    {m ? (
                      <span className="line-clamp-2 text-sm">
                        {m.sender_role === "support" ? "Biddr support: " : m.sender_id === user.id ? "You: " : ""}
                        {m.body}
                      </span>
                    ) : (
                      <span className="text-sm text-mute">No messages yet.</span>
                    )}
                    {m ? <LocalDateTime iso={m.created_at} className="text-xs text-mute" /> : null}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
