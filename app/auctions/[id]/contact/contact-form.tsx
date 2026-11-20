"use client";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { EMPTY_SLOT, SlotFields, slotsToIso, type Slot } from "@/components/messages/slot-fields";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useTimeZone } from "@/hooks/use-time-zone";
import { CONTACT_TOPICS, MESSAGE_MAX, type Topic } from "@/lib/messages";
import { cn } from "@/lib/utils";
import { startConversation } from "./actions";

type ContactTopic = Exclude<Topic, "sale">;

/** The first message to the seller: what it's about (required), the message, and for a viewing or an inspection up to 3 times. */
export function ContactForm({ auctionId }: { auctionId: string }) {
  const router = useRouter();
  const tz = useTimeZone();
  const [topic, setTopic] = useState<ContactTopic | null>(null);
  const [body, setBody] = useState("");
  const [slots, setSlots] = useState<Slot[]>([EMPTY_SLOT]);
  const [errors, setErrors] = useState<{ topic?: string; body?: string; slots?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const topicRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const withTimes = topic === "viewing" || topic === "inspection";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const next: typeof errors = {};
    if (!topic) next.topic = "Choose what your message is about.";
    if (!body.trim()) next.body = "Write a message first.";
    let iso: string[] = [];
    if (withTimes) {
      const r = slotsToIso(slots, tz);
      if ("error" in r) next.slots = r.error;
      else iso = r.iso;
    }
    setErrors(next);
    if (next.topic) return topicRef.current?.focus();
    if (next.body) return bodyRef.current?.focus();
    if (next.slots) return;

    setBusy(true);
    const result = await startConversation({ auctionId, topic, body, slots: iso });
    if (!result.ok) {
      setBusy(false);
      setErrors({ [result.field ?? "form"]: result.error });
      if (result.field === "body") bodyRef.current?.focus();
      return;
    }
    router.push(`/account/messages/${result.conversationId}${result.warning ? "?viewing=failed" : ""}`);
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="space-y-5">
      <fieldset aria-describedby={errors.topic ? `${id}-topic-error` : undefined}>
        <legend className="text-sm font-semibold">What is it about?</legend>
        <div className="mt-2 space-y-2">
          {CONTACT_TOPICS.map((t, i) => (
            <label
              key={t.value}
              className={cn(
                "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 text-sm",
                topic === t.value ? "border-signal bg-signal/10" : "border-field hover:border-chalk",
              )}
            >
              <input
                ref={i === 0 ? topicRef : undefined}
                type="radio"
                name="topic"
                value={t.value}
                checked={topic === t.value}
                onChange={() => setTopic(t.value)}
                className="mt-0.5 size-4 shrink-0 accent-[#FF5500]"
              />
              <span>
                <span className="block font-semibold">{t.label}</span>
                <span className="block text-mute">{t.hint}</span>
              </span>
            </label>
          ))}
        </div>
        {errors.topic ? (
          <p id={`${id}-topic-error`} role="alert" className="mt-2 text-sm text-signal">
            {errors.topic}
          </p>
        ) : null}
      </fieldset>

      <div>
        <label htmlFor={`${id}-body`} className="block text-sm font-semibold">
          Message
        </label>
        <Textarea
          ref={bodyRef}
          id={`${id}-body`}
          value={body}
          maxLength={MESSAGE_MAX}
          rows={5}
          onChange={(e) => setBody(e.target.value)}
          aria-invalid={errors.body ? true : undefined}
          aria-describedby={`${id}-count${errors.body ? ` ${id}-body-error` : ""}`}
          className="mt-1"
        />
        <p id={`${id}-count`} className="mt-1 text-right text-xs text-mute tabular">
          {body.length.toLocaleString("en-GB")} / {MESSAGE_MAX.toLocaleString("en-GB")} characters
        </p>
        {errors.body ? (
          <p id={`${id}-body-error`} role="alert" className="text-sm text-signal">
            {errors.body}
          </p>
        ) : null}
      </div>

      {withTimes ? (
        <div className="rounded-lg border border-line bg-panel p-3">
          <SlotFields slots={slots} onChange={setSlots} legend="Suggested times (optional)" describedBy={errors.slots ? `${id}-slots-error` : undefined} />
          {errors.slots ? (
            <p id={`${id}-slots-error`} role="alert" className="mt-2 text-sm text-signal">
              {errors.slots}
            </p>
          ) : null}
        </div>
      ) : null}

      {errors.form ? (
        <p role="alert" className="text-sm text-signal">
          {errors.form}
        </p>
      ) : null}

      <Button type="submit" size="lg" disabled={busy} className="w-full sm:w-auto">
        {busy ? <Loader2 aria-hidden className="animate-spin" /> : <Send aria-hidden />}
        Send to the seller
      </Button>
    </form>
  );
}
