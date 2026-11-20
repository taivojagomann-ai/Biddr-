"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { CalendarPlus, Loader2, Send } from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  MASKING_NOTE,
  MESSAGE_COLUMNS,
  MESSAGE_MAX,
  SALE_DIVIDER,
  VIEWING_COLUMNS,
  messageError,
  readOnlyText,
  senderLabel,
  type MessageRow,
  type SharedPhone,
  type ViewingRequestRow,
} from "@/lib/messages";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { PhonePanel, ProposeTimes, ViewingCard } from "./viewing";

/**
 * The conversation: messages oldest first, new ones live (Realtime), and the message box.
 * Ctrl+Enter (or ⌘+Enter) sends; Enter makes a new line. The list is a polite live log,
 * so screen readers hear new messages without losing their place.
 */
/** "Typing…" goes out at most this often while typing, and shows this long after the last one. */
const TYPING_SEND_MS = 2000;
const TYPING_SHOW_MS = 4000;

export function Thread({
  conversationId,
  viewerId,
  viewerRole,
  initial,
  readOnly,
  readOnlyReason = null,
  otherLastReadAt,
  phase = "sale",
  saleConfirmedAt = null,
  initialViewings = [],
  initialPhones = [],
  viewingFailed = false,
}: {
  conversationId: string;
  viewerId: string;
  viewerRole: "buyer" | "seller";
  initial: MessageRow[];
  readOnly: boolean;
  /** Why no new messages can be sent (conversation_state), e.g. AUCTION_ENDED. */
  readOnlyReason?: string | null;
  /** When the other party last read the conversation: "Seen" under your last message. */
  otherLastReadAt: string | null;
  /** Before the buyer's premium is paid ("pre_sale": contact details hidden) or after it. */
  phase?: "pre_sale" | "sale";
  /** When the sale was confirmed: the divider in the thread. */
  saleConfirmedAt?: string | null;
  initialViewings?: ViewingRequestRow[];
  initialPhones?: SharedPhone[];
  /** The first message went out but its viewing times didn't (from the contact page). */
  viewingFailed?: boolean;
}) {
  const router = useRouter();
  const otherRole = viewerRole === "buyer" ? "seller" : "buyer";
  const [messages, setMessages] = useState(initial);
  const [viewings, setViewings] = useState(initialViewings);
  const [phones, setPhones] = useState(initialPhones);
  const [proposing, setProposing] = useState(viewingFailed);
  const [otherReadAt, setOtherReadAt] = useState(otherLastReadAt);
  const [typing, setTyping] = useState(false);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingChannel = useRef<ReturnType<ReturnType<typeof getBrowserSupabase>["channel"]> | null>(null);
  const lastTypingSent = useRef(0);
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const channelKey = useId();
  const helpId = useId();
  const countId = useId();

  const add = (m: MessageRow) =>
    setMessages((list) => (list.some((x) => x.id === m.id) ? list : [...list, m].sort((a, b) => a.created_at.localeCompare(b.created_at))));
  const putViewing = (v: ViewingRequestRow) =>
    setViewings((list) => [...list.filter((x) => x.id !== v.id), v].sort((a, b) => a.created_at.localeCompare(b.created_at)));
  const reloadViewings = useCallback(async () => {
    const { data } = await getBrowserSupabase()
      .from("viewing_requests")
      .select(VIEWING_COLUMNS)
      .eq("conversation_id", conversationId)
      .order("created_at")
      .returns<ViewingRequestRow[]>();
    if (data) setViewings(data);
  }, [conversationId]);
  const reloadPhones = useCallback(async () => {
    const { data } = await getBrowserSupabase().rpc("conversation_shared_phones", { p_conversation: conversationId }).returns<SharedPhone[]>();
    if (Array.isArray(data)) setPhones(data);
  }, [conversationId]);

  // Reading the conversation marks it (and its "new message" notification) read, but only
  // while the page is really in front, so "Seen" on the other side is true.
  const markRead = useCallback(() => {
    if (document.visibilityState !== "visible") return;
    // Supabase queries only run when awaited (then): do so, and ignore the result.
    void getBrowserSupabase()
      .rpc("mark_conversation_read", { p_conversation: conversationId })
      .then(() => undefined);
  }, [conversationId]);
  useEffect(() => {
    markRead();
  }, [markRead, messages.length]);
  useEffect(() => {
    const onVisible = () => markRead();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [markRead]);

  const stopTyping = () => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    setTyping(false);
  };

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);

  // New messages from the other party (and Biddr support) arrive live.
  useEffect(() => {
    const supabase = getBrowserSupabase();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel = supabase
        .channel(`messages:${conversationId}:${channelKey}`)
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
          async (payload: { new: { id?: string } }) => {
            if (!payload.new.id) return;
            const { data: row } = await supabase.from("messages").select(MESSAGE_COLUMNS).eq("id", payload.new.id).maybeSingle<MessageRow>();
            if (!row) return;
            add(row);
            if (row.sender_role !== viewerRole) stopTyping();
            // Biddr support (e.g. a decision on a report): refresh the report status too.
            if (row.sender_role === "support") router.refresh();
          },
        )
        // The other party read the conversation: "Sent" becomes "Seen".
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "conversations", filter: `id=eq.${conversationId}` },
          (payload: { new: { buyer_last_read_at?: string | null; seller_last_read_at?: string | null } }) => {
            const at = otherRole === "buyer" ? payload.new.buyer_last_read_at : payload.new.seller_last_read_at;
            if (at) setOtherReadAt(at);
          },
        )
        // Viewing requests and shared phone numbers change live too.
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "viewing_requests", filter: `conversation_id=eq.${conversationId}` },
          () => void reloadViewings(),
        )
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "shared_phones", filter: `conversation_id=eq.${conversationId}` },
          () => void reloadPhones(),
        )
        .subscribe();
      // "Typing…": a private broadcast channel only the two parties can join (0027).
      typingChannel.current = supabase
        .channel(`conversation:${conversationId}`, { config: { private: true, broadcast: { self: false } } })
        .on("broadcast", { event: "typing" }, ({ payload }: { payload?: { role?: string } }) => {
          if (payload?.role !== otherRole) return;
          setTyping(true);
          if (typingTimer.current) clearTimeout(typingTimer.current);
          typingTimer.current = setTimeout(() => setTyping(false), TYPING_SHOW_MS);
        })
        .on("broadcast", { event: "stopped" }, ({ payload }: { payload?: { role?: string } }) => {
          if (payload?.role === otherRole) stopTyping();
        })
        .subscribe();
    });
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
      if (typingChannel.current) void supabase.removeChannel(typingChannel.current);
      typingChannel.current = null;
      if (typingTimer.current) clearTimeout(typingTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- router and the role are stable for this conversation
  }, [conversationId, channelKey]);

  function signalTyping(text: string) {
    const now = Date.now();
    if (!text.trim() || now - lastTypingSent.current < TYPING_SEND_MS) return;
    lastTypingSent.current = now;
    void typingChannel.current?.send({ type: "broadcast", event: "typing", payload: { role: viewerRole } });
  }

  async function send() {
    if (sending) return;
    const text = body.trim();
    if (!text) {
      setError(messageError("MESSAGE_EMPTY"));
      textRef.current?.focus();
      return;
    }
    setSending(true);
    setError(null);
    const { data, error: rpcError } = await getBrowserSupabase()
      .rpc("send_message", { p_conversation: conversationId, p_body: text })
      .single<MessageRow>();
    setSending(false);
    if (rpcError || !data) {
      setError(messageError(rpcError?.message));
      textRef.current?.focus();
      return;
    }
    add(data);
    setBody("");
    lastTypingSent.current = 0;
    void typingChannel.current?.send({ type: "broadcast", event: "stopped", payload: { role: viewerRole } });
    textRef.current?.focus();
  }

  // "Sent" or "Seen" under your newest message.
  const lastOwn = [...messages].reverse().find((m) => m.sender_role === viewerRole);
  const seen = Boolean(lastOwn && otherReadAt && Date.parse(otherReadAt) >= Date.parse(lastOwn.created_at));

  // Messages and viewing requests, oldest first, with the divider where the sale was
  // confirmed (only when the conversation started before it).
  type Item = { kind: "message"; at: string; m: MessageRow } | { kind: "viewing"; at: string; v: ViewingRequestRow };
  const items: Item[] = [
    ...messages.map((m): Item => ({ kind: "message", at: m.created_at, m })),
    ...viewings.map((v): Item => ({ kind: "viewing", at: v.created_at, v })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const confirmedAt = saleConfirmedAt ? Date.parse(saleConfirmedAt) : null;
  const dividerIndex =
    confirmedAt !== null && items.some((it) => Date.parse(it.at) < confirmedAt)
      ? (() => {
          const k = items.findIndex((it) => Date.parse(it.at) >= confirmedAt);
          return k === -1 ? items.length : k;
        })()
      : -1;
  const hasConfirmedViewing = viewings.some((v) => v.status === "confirmed");
  const writable = !readOnly;
  const divider = (
    <li key="sale-divider" data-sale-divider="" className="flex items-center gap-3 py-1 text-xs font-semibold text-verified">
      <span aria-hidden className="h-px flex-1 bg-verified/40" />
      <span>{SALE_DIVIDER}</span>
      <span aria-hidden className="h-px flex-1 bg-verified/40" />
    </li>
  );

  return (
    <div className="space-y-4">
      {/* A polite live log: new messages are read out once they arrive, never while typing. */}
      <div role="log" aria-label="Messages" aria-live="polite" aria-relevant="additions" className="space-y-3">
        {items.length === 0 ? (
          <p className="rounded-md border border-dashed border-line p-4 text-center text-sm text-mute">
            {phase === "sale" ? "No messages yet. Say hello and agree on the payment and the handover." : "No messages yet."}
          </p>
        ) : (
          <ol className="space-y-3">
            {items.flatMap((it, index) => {
              const out: React.ReactNode[] = [];
              if (index === dividerIndex) out.push(divider);
              if (it.kind === "viewing") {
                out.push(
                  <li key={`v-${it.v.id}`}>
                    <ViewingCard
                      request={it.v}
                      viewerId={viewerId}
                      viewerRole={viewerRole}
                      writable={writable}
                      onChanged={putViewing}
                      onProposeOther={() => {
                        setProposing(true);
                        requestAnimationFrame(() => document.getElementById("propose-times")?.scrollIntoView({ block: "nearest" }));
                      }}
                    />
                  </li>,
                );
                return out;
              }
              const m = it.m;
              const own = m.sender_role === viewerRole;
              const support = m.sender_role === "support";
              out.push(
                <li key={m.id} className={cn("flex", own ? "justify-end" : "justify-start")}>
                  <article
                    aria-label={`${senderLabel(m.sender_role, viewerRole)}`}
                    className={cn(
                      "max-w-[85%] rounded-lg border px-3 py-2 text-sm",
                      support ? "border-verified/60 bg-verified/10" : own ? "border-signal/40 bg-signal/10" : "border-line bg-panel",
                    )}
                  >
                    <p className="flex flex-wrap items-baseline gap-x-2 text-xs text-mute">
                      <span className={cn("font-semibold", support ? "text-verified" : "text-chalk")}>{senderLabel(m.sender_role, viewerRole)}</span>
                      <LocalDateTime iso={m.created_at} />
                    </p>
                    {/* Plain text: links aren't made clickable (protection against scam links). */}
                    <p className="mt-1 whitespace-pre-wrap break-words">{m.body}</p>
                    {m.masked && own ? <p className="mt-1 text-xs text-mute">Contact details were hidden until the sale is paid.</p> : null}
                    {m.id === lastOwn?.id ? (
                      <p data-receipt="" className={cn("mt-1 text-right text-xs", seen ? "font-semibold text-signal" : "text-mute")}>
                        {seen ? "Seen" : "Sent"}
                      </p>
                    ) : null}
                  </article>
                </li>,
              );
              return out;
            })}
            {dividerIndex === items.length ? divider : null}
          </ol>
        )}
        <div ref={bottomRef} />
      </div>

      {/* The other party is typing: three orange dots, and a short status for screen readers. */}
      <div className="flex min-h-6 items-center gap-2">
        {typing ? (
          <span aria-hidden data-typing="" className="inline-flex items-center gap-1 rounded-full border border-line bg-panel px-3 py-2">
            {[0, 150, 300].map((delay) => (
              <span key={delay} className="size-2 rounded-full bg-signal motion-safe:animate-bounce" style={{ animationDelay: `${delay}ms` }} />
            ))}
          </span>
        ) : null}
        <p role="status" className="sr-only">
          {typing ? `The ${otherRole} is typing…` : ""}
        </p>
      </div>

      {phase === "pre_sale" && hasConfirmedViewing ? (
        <PhonePanel
          conversationId={conversationId}
          viewerId={viewerId}
          viewerRole={viewerRole}
          phones={phones}
          writable={writable}
          onShared={() => void reloadPhones()}
        />
      ) : null}

      {readOnly ? (
        <p data-read-only="" className="rounded-md border border-line bg-asphalt/60 p-3 text-sm text-mute">
          {readOnlyText(readOnlyReason)}
        </p>
      ) : (
        <>
          {phase === "pre_sale" ? (
            proposing ? (
              <div id="propose-times">
                {viewingFailed ? (
                  <p role="alert" className="mb-2 text-sm text-signal">
                    Your message was sent, but the viewing times weren&apos;t. Propose them again here.
                  </p>
                ) : null}
                <ProposeTimes
                  conversationId={conversationId}
                  onProposed={(v) => {
                    putViewing(v);
                    setProposing(false);
                  }}
                  onCancel={() => setProposing(false)}
                />
              </div>
            ) : (
              <Button type="button" variant="outline" className="min-h-11" onClick={() => setProposing(true)}>
                <CalendarPlus aria-hidden />
                Propose viewing times
              </Button>
            )
          ) : null}
          {/* Phones: the message box stays at the bottom of the screen, above the keyboard. */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="sticky bottom-0 z-10 -mx-4 space-y-2 border-t border-line bg-asphalt px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:static sm:mx-0 sm:border-0 sm:bg-transparent sm:p-0"
          >
            <label htmlFor="message-body" className="block text-sm font-semibold">
              Message
            </label>
            <Textarea
              ref={textRef}
              id="message-body"
              value={body}
              maxLength={MESSAGE_MAX}
              rows={3}
              onChange={(e) => {
                setBody(e.target.value);
                signalTyping(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void send();
                }
              }}
              aria-describedby={`${helpId} ${countId}${error ? " message-error" : ""}`}
              aria-invalid={error ? true : undefined}
            />
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-mute">
              <span id={helpId}>
                Ctrl+Enter sends. Enter starts a new line.{phase === "pre_sale" ? ` ${MASKING_NOTE}` : ""}
              </span>
              <span id={countId} className="tabular">
                {body.length.toLocaleString("en-GB")} / {MESSAGE_MAX.toLocaleString("en-GB")} characters
              </span>
            </div>
            {error ? (
              <p id="message-error" role="alert" className="text-sm text-signal">
                {error}
              </p>
            ) : null}
            <Button type="submit" disabled={sending} className="min-h-11">
              {sending ? <Loader2 aria-hidden className="animate-spin" /> : <Send aria-hidden />}
              Send
            </Button>
          </form>
        </>
      )}
    </div>
  );
}
