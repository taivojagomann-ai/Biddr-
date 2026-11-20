"use server";
import { z } from "zod";
import { MESSAGE_MAX, messageError } from "@/lib/messages";
import { getServerSupabase } from "@/lib/supabase/server";

export type StartResult =
  | { ok: true; conversationId: string; warning?: string }
  | { ok: false; error: string; field?: "topic" | "body" | "slots" };

const input = z.object({
  auctionId: z.string().uuid(),
  topic: z.enum(["viewing", "inspection", "question"], { errorMap: () => ({ message: messageError("TOPIC_REQUIRED") }) }),
  body: z.string().trim().min(1, messageError("MESSAGE_EMPTY")).max(MESSAGE_MAX, messageError("MESSAGE_TOO_LONG")),
  slots: z.array(z.string().datetime()).max(3).default([]),
});

/**
 * "Contact seller": opens the conversation (or reuses this buyer's one for the car) with
 * the first message, then proposes the viewing times if any. The database checks who
 * may do this (start_conversation, propose_viewing), as the signed-in member.
 */
export async function startConversation(raw: unknown): Promise<StartResult> {
  const parsed = input.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path[0];
    return {
      ok: false,
      error: issue?.message ?? "Check the form.",
      field: field === "topic" || field === "body" || field === "slots" ? field : undefined,
    };
  }
  const supabase = getServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: messageError("NOT_AUTHENTICATED") };

  const { auctionId, topic, body, slots } = parsed.data;
  const { data: id, error } = await supabase.rpc("start_conversation", { p_auction: auctionId, p_topic: topic, p_body: body });
  if (error || typeof id !== "string") {
    const field = error?.message === "TOPIC_REQUIRED" ? "topic" : error?.message?.startsWith("MESSAGE_") ? "body" : undefined;
    return { ok: false, error: messageError(error?.message, "Your message wasn't sent. Try again."), field };
  }
  if (slots.length) {
    const { error: viewingError } = await supabase.rpc("propose_viewing", { p_conversation: id, p_slots: slots });
    if (viewingError) {
      return {
        ok: true,
        conversationId: id,
        warning: `Your message was sent, but the times weren't: ${messageError(viewingError.message, "try again in the conversation.")}`,
      };
    }
  }
  return { ok: true, conversationId: id };
}
