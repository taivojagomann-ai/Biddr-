-- =============================================================================
-- 0027: "Typing…" and "Seen" in conversations (DECISIONS.md point 14).
--
-- - Seen: conversations.buyer_last_read_at / seller_last_read_at already record when
--   each party last read the conversation. Adding conversations to Realtime lets the
--   other party's page update "Sent" to "Seen" live (Realtime applies the existing
--   select policy, so only the two parties receive the changes).
-- - Typing: short "typing" signals between the two parties go over a private
--   Realtime broadcast channel "conversation:<id>" and are never stored. These
--   policies let only the buyer and the seller of that conversation join and send.
--
-- Idempotent: safe to run more than once. Nothing is dropped.
-- =============================================================================

do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations') then
    alter publication supabase_realtime add table public.conversations;
  end if;
end $$;

-- Is the signed-in user a party to the conversation in this Realtime topic?
create or replace function public.is_conversation_party(p_topic text)
returns boolean language sql stable security definer set search_path = public as $$
  select p_topic like 'conversation:%'
     and exists (
       select 1 from public.conversations c
        where c.id::text = substring(p_topic from 14)
          and (c.buyer_id = auth.uid() or c.seller_id = auth.uid())
     );
$$;
revoke all on function public.is_conversation_party(text) from public, anon;
grant execute on function public.is_conversation_party(text) to authenticated;

-- realtime.messages already has row level security (Supabase owns the table); these
-- policies only allow the two parties on a "conversation:<id>" topic.
do $$
begin
  if to_regclass('realtime.messages') is not null then
    drop policy if exists "conversation parties receive typing" on realtime.messages;
    create policy "conversation parties receive typing" on realtime.messages
      for select to authenticated
      using (realtime.messages.extension = 'broadcast' and public.is_conversation_party(realtime.topic()));
    drop policy if exists "conversation parties send typing" on realtime.messages;
    create policy "conversation parties send typing" on realtime.messages
      for insert to authenticated
      with check (realtime.messages.extension = 'broadcast' and public.is_conversation_party(realtime.topic()));
  end if;
end $$;
