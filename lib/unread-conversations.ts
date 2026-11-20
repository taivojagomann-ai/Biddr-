import type { SupabaseClient } from "@supabase/supabase-js";
import { isUnread } from "@/lib/messages";

/** How many of this member's conversations have news they haven't read (the count after "Messages"). */
export async function unreadConversations(supabase: SupabaseClient, userId: string): Promise<number> {
  // RLS: only the member's own conversations.
  const { data } = await supabase
    .from("conversations")
    .select("buyer_id, last_message_at, buyer_last_read_at, seller_last_read_at")
    .not("last_message_at", "is", null)
    .returns<{ buyer_id: string; last_message_at: string | null; buyer_last_read_at: string | null; seller_last_read_at: string | null }[]>();
  return (data ?? []).filter((c) => isUnread(c.last_message_at, c.buyer_id === userId ? c.buyer_last_read_at : c.seller_last_read_at)).length;
}
