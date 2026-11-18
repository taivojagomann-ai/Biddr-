"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { LocalDateTime } from "@/components/local-date-time";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { MESSAGE_COLUMNS, MESSAGE_MAX, messageError, senderLabel, type MessageRow } from "@/lib/messages";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

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
  viewerRole,
  initial,
  readOnly,
  otherLastReadAt,
}: {
  conversationId: string;
  viewerRole: "buyer" | "seller";
  initial: MessageRow[];
  readOnly: boolean;
  /** When the other party last read the conversation: "Seen" under your last message. */
  otherLastReadAt: string | null;
}) {
  const router = useRouter();
  const otherRole = viewerRole === "buyer" ? "seller" : "buyer";
  const [messages, setMessages] = useState(initial);
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

  return (
    <div className="space-y-4">
      <div role="log" aria-label="Messages" aria-live="polite" className="space-y-3">
        {messages.length === 0 ? (
          <p className="rounded-md border border-dashed border-line p-4 text-center text-sm text-mute">
            No messages yet. Say hello and agree on the payment and the handover.
          </p>
        ) : (
          <ol className="space-y-3">
            {messages.map((m) => {
              const own = m.sender_role === viewerRole;
              const support = m.sender_role === "support";
              return (
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
                    {m.id === lastOwn?.id ? (
                      <p data-receipt="" className={cn("mt-1 text-right text-xs", seen ? "font-semibold text-signal" : "text-mute")}>
                        {seen ? "Seen" : "Sent"}
                      </p>
                    ) : null}
                  </article>
                </li>
              );
            })}
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

      {readOnly ? (
        <p className="rounded-md border border-line bg-asphalt/60 p-3 text-sm text-mute">
          This conversation is read-only now. You can still read it here.
        </p>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          className="space-y-2"
        >
          <label htmlFor="message-body" className="block text-sm font-semibold">
            Message
          </label>
          <Textarea
            ref={textRef}
            id="message-body"
            value={body}
            maxLength={MESSAGE_MAX}
            rows={4}
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
          <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-mute">
            <span id={helpId}>Ctrl+Enter sends. Enter starts a new line.</span>
            <span id={countId} className="tabular">
              {body.length.toLocaleString("en-GB")} / {MESSAGE_MAX.toLocaleString("en-GB")} characters
            </span>
          </div>
          {error ? (
            <p id="message-error" role="alert" className="text-sm text-signal">
              {error}
            </p>
          ) : null}
          <Button type="submit" disabled={sending}>
            {sending ? <Loader2 aria-hidden className="animate-spin" /> : <Send aria-hidden />}
            Send
          </Button>
        </form>
      )}
    </div>
  );
}
