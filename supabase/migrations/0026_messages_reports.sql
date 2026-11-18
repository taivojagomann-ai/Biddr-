-- =============================================================================
-- 0026: Messages between buyer and seller after a sale, and "Report a problem"
-- (DECISIONS.md point 13).
--
-- - conversations: one per paid sale (buyer_payments.status = 'paid'), created by a
--   trigger when the premium is paid. Only the buyer and the seller read it.
-- - messages: text only, 1–2,000 characters, never edited or deleted (they're the
--   record if there's a dispute). Sent only through send_message(), which checks
--   the sender is a party, the conversation isn't read-only yet (30 days after
--   "Sale completed", or 60 days after the premium was paid), and a limit of 30
--   messages per 10 minutes. One "new message" notification per conversation until
--   it's read. Biddr's support can post too (sender_role 'support', server only).
-- - sale_reports: a problem reported by the buyer or the seller; admins review it.
--   Only the reporter reads their report. Admins see the conversation only while a
--   report on it is open, and each view is logged in admin_actions (by the app).
-- - profiles.selling_blocked_at / selling_block_reason: an admin can stop a member
--   from submitting cars (bidding blocks are 0025). No member access to these columns.
-- - Conversations are deleted 3 years after the sale (daily pg_cron job).
--
-- Idempotent: safe to run more than once. Nothing is dropped. place_bid is not touched.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Conversations
-- -----------------------------------------------------------------------------
create table if not exists public.conversations (
  id                  uuid primary key default gen_random_uuid(),
  auction_id          uuid not null references public.auctions (id) on delete cascade,
  buyer_payment_id    uuid not null unique references public.buyer_payments (id) on delete cascade,
  buyer_id            uuid not null references public.profiles (id),
  seller_id           uuid not null references public.profiles (id),
  last_message_at     timestamptz,
  buyer_last_read_at  timestamptz,
  seller_last_read_at timestamptz,
  created_at          timestamptz not null default now()
);
create index if not exists conversations_buyer_idx on public.conversations (buyer_id, last_message_at desc);
create index if not exists conversations_seller_idx on public.conversations (seller_id, last_message_at desc);

alter table public.conversations enable row level security;
revoke all on public.conversations from anon, authenticated;
grant select on public.conversations to authenticated;
grant all on public.conversations to service_role;
drop policy if exists "parties read their conversation" on public.conversations;
create policy "parties read their conversation" on public.conversations
  for select to authenticated using (buyer_id = auth.uid() or seller_id = auth.uid());

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid references public.profiles (id),
  sender_role     text not null check (sender_role in ('buyer', 'seller', 'support')),
  body            text not null check (char_length(body) between 1 and 2000),
  created_at      timestamptz not null default now()
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at);
create index if not exists messages_sender_idx on public.messages (sender_id, created_at desc);

alter table public.messages enable row level security;
revoke all on public.messages from anon, authenticated;
grant select on public.messages to authenticated;
grant all on public.messages to service_role;
drop policy if exists "parties read their messages" on public.messages;
create policy "parties read their messages" on public.messages
  for select to authenticated using (
    exists (select 1 from public.conversations c
             where c.id = conversation_id and (c.buyer_id = auth.uid() or c.seller_id = auth.uid()))
  );

-- Messages are a record: never changed or deleted one by one (deleting a whole
-- conversation, e.g. after 3 years, still works through the cascade).
create or replace function public.messages_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Messages can''t be changed.';
end $$;
drop trigger if exists messages_immutable on public.messages;
create trigger messages_immutable before update on public.messages
  for each row execute function public.messages_immutable();

-- Live updates in the conversation (Realtime respects the select policy).
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages') then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- A conversation opens when the premium is paid (and for sales already paid).
create or replace function public.conversation_on_paid()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' then
    insert into public.conversations (auction_id, buyer_payment_id, buyer_id, seller_id)
    values (new.auction_id, new.id, new.winner_id, new.seller_id)
    on conflict (buyer_payment_id) do nothing;
  end if;
  return null;
end $$;
drop trigger if exists conversation_on_paid on public.buyer_payments;
create trigger conversation_on_paid
  after insert or update of status on public.buyer_payments
  for each row execute function public.conversation_on_paid();

insert into public.conversations (auction_id, buyer_payment_id, buyer_id, seller_id)
select auction_id, id, winner_id, seller_id from public.buyer_payments where status = 'paid'
on conflict (buyer_payment_id) do nothing;

-- When a conversation becomes read-only: 30 days after "Sale completed", otherwise
-- 60 days after the premium was paid.
create or replace function public.conversation_read_only_at(p_conversation uuid)
returns timestamptz language sql stable security definer set search_path = public as $$
  select coalesce(p.sale_completed_at + interval '30 days', coalesce(p.paid_at, c.created_at) + interval '60 days')
    from public.conversations c join public.buyer_payments p on p.id = c.buyer_payment_id
   where c.id = p_conversation;
$$;
revoke all on function public.conversation_read_only_at(uuid) from public, anon;
grant execute on function public.conversation_read_only_at(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- send_message: the only way a member writes a message.
-- -----------------------------------------------------------------------------
create or replace function public.send_message(p_conversation uuid, p_body text)
returns public.messages
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_conv public.conversations;
  v_role text;
  v_body text := btrim(coalesce(p_body, ''));
  v_msg public.messages;
  v_other uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  select * into v_conv from public.conversations where id = p_conversation;
  if not found or (v_conv.buyer_id <> v_uid and v_conv.seller_id <> v_uid) then
    raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.buyer_payments where id = v_conv.buyer_payment_id and status = 'paid') then
    raise exception 'CONVERSATION_CLOSED' using errcode = 'P0001';
  end if;
  if public.conversation_read_only_at(p_conversation) <= now() then
    raise exception 'CONVERSATION_READ_ONLY' using errcode = 'P0001';
  end if;
  if char_length(v_body) = 0 then
    raise exception 'MESSAGE_EMPTY' using errcode = 'P0001';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'MESSAGE_TOO_LONG' using errcode = 'P0001';
  end if;
  if (select count(*) from public.messages where sender_id = v_uid and created_at > now() - interval '10 minutes') >= 30 then
    raise exception 'MESSAGE_RATE_LIMIT' using errcode = 'P0001';
  end if;

  v_role := case when v_conv.buyer_id = v_uid then 'buyer' else 'seller' end;
  v_other := case when v_role = 'buyer' then v_conv.seller_id else v_conv.buyer_id end;

  insert into public.messages (conversation_id, sender_id, sender_role, body)
  values (p_conversation, v_uid, v_role, v_body)
  returning * into v_msg;

  update public.conversations
     set last_message_at = v_msg.created_at,
         buyer_last_read_at  = case when v_role = 'buyer'  then v_msg.created_at else buyer_last_read_at end,
         seller_last_read_at = case when v_role = 'seller' then v_msg.created_at else seller_last_read_at end
   where id = p_conversation;

  -- One "new message" notification per conversation until the other party reads it.
  if not exists (select 1 from public.notifications
                  where user_id = v_other and type = 'new_message' and read_at is null
                    and data->>'conversation_id' = p_conversation::text) then
    perform public.notify(v_other, 'new_message', v_conv.auction_id, null, v_uid,
      jsonb_build_object('conversation_id', p_conversation, 'role', case when v_role = 'buyer' then 'seller' else 'buyer' end));
  end if;
  return v_msg;
end $$;
revoke all on function public.send_message(uuid, text) from public, anon;
grant execute on function public.send_message(uuid, text) to authenticated;

-- mark_conversation_read: the caller has read it (and its "new message" notification).
create or replace function public.mark_conversation_read(p_conversation uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  update public.conversations
     set buyer_last_read_at  = case when buyer_id  = v_uid then now() else buyer_last_read_at end,
         seller_last_read_at = case when seller_id = v_uid then now() else seller_last_read_at end
   where id = p_conversation and (buyer_id = v_uid or seller_id = v_uid);
  update public.notifications set read_at = now()
   where user_id = v_uid and type = 'new_message' and read_at is null
     and data->>'conversation_id' = p_conversation::text;
end $$;
revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- Conversations are deleted 3 years after the sale (the privacy policy says so).
create or replace function public.purge_old_conversations()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  delete from public.conversations c
   using public.buyer_payments p
   where p.id = c.buyer_payment_id
     and coalesce(p.paid_at, c.created_at) < now() - interval '3 years';
  get diagnostics v_n = row_count;
  return v_n;
end $$;
revoke all on function public.purge_old_conversations() from public, anon, authenticated;
grant execute on function public.purge_old_conversations() to service_role;
select cron.schedule('purge-old-conversations', '17 3 * * *', $$select public.purge_old_conversations()$$);

-- -----------------------------------------------------------------------------
-- Reports
-- -----------------------------------------------------------------------------
create table if not exists public.sale_reports (
  id               uuid primary key default gen_random_uuid(),
  buyer_payment_id uuid not null references public.buyer_payments (id) on delete cascade,
  auction_id       uuid not null references public.auctions (id) on delete cascade,
  conversation_id  uuid references public.conversations (id) on delete set null,
  reporter_id      uuid not null references public.profiles (id),
  reporter_role    text not null check (reporter_role in ('buyer', 'seller')),
  reason           text not null check (reason in (
                     'seller_wont_hand_over', 'not_as_described', 'cant_reach_seller',
                     'buyer_not_paid', 'cant_reach_buyer', 'other')),
  description      text not null check (char_length(description) between 20 and 2000),
  status           text not null default 'open' check (status in ('open', 'in_review', 'resolved')),
  outcome          text check (outcome in ('resolved', 'sale_failed')),
  resolution       text check (resolution is null or char_length(resolution) <= 2000),
  resolved_by      uuid references public.profiles (id),
  resolved_at      timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create unique index if not exists sale_reports_one_open
  on public.sale_reports (buyer_payment_id, reporter_id) where status <> 'resolved';
create index if not exists sale_reports_status_idx on public.sale_reports (status, created_at desc);

drop trigger if exists sale_reports_touch on public.sale_reports;
create trigger sale_reports_touch before update on public.sale_reports
  for each row execute function public.touch_updated_at();

alter table public.sale_reports enable row level security;
revoke all on public.sale_reports from anon, authenticated;
grant select on public.sale_reports to authenticated;
grant all on public.sale_reports to service_role;
drop policy if exists "reporters read their reports" on public.sale_reports;
create policy "reporters read their reports" on public.sale_reports
  for select to authenticated using (reporter_id = auth.uid());

-- A sale an admin marked as failed after a report.
alter table public.buyer_payments add column if not exists sale_failed_at timestamptz;

-- -----------------------------------------------------------------------------
-- Blocked from selling (admins, after a report)
-- -----------------------------------------------------------------------------
alter table public.profiles add column if not exists selling_blocked_at timestamptz;
alter table public.profiles add column if not exists selling_block_reason text;

-- New listings: a member blocked from selling can't submit a car (sellers insert
-- drafts with their own session; service-role inserts, e.g. relisting, aren't affected).
create or replace function public.auctions_require_seller()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and exists (
    select 1 from public.profiles where id = new.seller_id and selling_blocked_at is not null
  ) then
    raise exception 'SELLING_BLOCKED' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists auctions_require_seller on public.auctions;
create trigger auctions_require_seller before insert on public.auctions
  for each row execute function public.auctions_require_seller();

-- -----------------------------------------------------------------------------
-- Notifications. Widen-only, as in earlier migrations.
-- -----------------------------------------------------------------------------
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.notifications'::regclass and conname = 'notifications_type_check';
  if v_def is null or exists (
    select 1 from unnest(array['question', 'answer', 'outbid', 'listing_approved', 'listing_rejected',
      'auction_live', 'auction_ended', 'auction_won', 'listing_submitted',
      'watch_ending_soon', 'watch_live', 'inspection_rejected',
      'withdrawal_approved', 'withdrawal_declined',
      'seller_decided', 'inspection_decision_reminder', 'inspection_decision_expired',
      'history_report_rejected', 'premium_due', 'premium_paid', 'premium_failed',
      'make_suggested', 'premium_reminder', 'premium_unpaid', 'buyer_did_not_pay',
      'second_chance_offer', 'second_chance_closed', 'bidding_unblocked',
      'new_message', 'report_opened', 'report_resolved', 'account_blocked', 'selling_unblocked']) as t(v)
     where position(quote_literal(t.v) in v_def) = 0
  ) then
    alter table public.notifications drop constraint if exists notifications_type_check;
    alter table public.notifications add constraint notifications_type_check check (type in (
      'question', 'answer', 'outbid', 'listing_approved', 'listing_rejected',
      'auction_live', 'auction_ended', 'auction_won', 'listing_submitted',
      'watch_ending_soon', 'watch_live', 'inspection_rejected',
      'withdrawal_approved', 'withdrawal_declined',
      'seller_decided', 'inspection_decision_reminder', 'inspection_decision_expired',
      'history_report_rejected', 'premium_due', 'premium_paid', 'premium_failed',
      'make_suggested', 'premium_reminder', 'premium_unpaid', 'buyer_did_not_pay',
      'second_chance_offer', 'second_chance_closed', 'bidding_unblocked',
      'new_message', 'report_opened', 'report_resolved', 'account_blocked', 'selling_unblocked'
    ));
  end if;
end $$;
