"use client";
import { useEffect, useId, useRef, useState } from "react";
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
export function Thread({
  conversationId,
  viewerRole,
  initial,
  readOnly,
}: {
  conversationId: string;
  viewerRole: "buyer" | "seller";
  initial: MessageRow[];
  readOnly: boolean;
}) {
  const [messages, setMessages] = useState(initial);
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

  // Reading the conversation marks it (and its "new message" notification) read.
  useEffect(() => {
    // Supabase queries only run when awaited (then): do so, and ignore the result.
    void getBrowserSupabase()
      .rpc("mark_conversation_read", { p_conversation: conversationId })
      .then(() => undefined);
  }, [conversationId, messages.length]);

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
            if (row) add(row);
          },
        )
        .subscribe();
    });
    return () => {
      cancelled = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [conversationId, channelKey]);

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
    textRef.current?.focus();
  }

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
                  </article>
                </li>
              );
            })}
          </ol>
        )}
        <div ref={bottomRef} />
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
            onChange={(e) => setBody(e.target.value)}
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
