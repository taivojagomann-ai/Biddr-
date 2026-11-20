-- =============================================================================
-- 0029: "Contact seller" before bidding, and viewing requests (DECISIONS.md point 14).
--
-- One conversation per buyer and car, in the existing conversations / messages tables:
-- - A signed-in member with a complete profile and accepted bidding terms (not blocked,
--   not the seller) can open one while the auction is upcoming or live, with a topic:
--   'viewing', 'inspection' or 'question'. After-sale conversations have topic 'sale'.
-- - If that buyer wins and pays the buyer's premium, the same conversation carries on
--   as the after-sale conversation (conversation_on_paid attaches the payment). A winner
--   without one gets a new conversation, as before.
-- - Contact details (phone numbers, email addresses, links) in messages are replaced by
--   "[contact details hidden]" until the premium is paid; the original text is kept in
--   messages_private, which only admins (service role) read. Messages sent after the
--   premium is paid aren't masked; earlier ones stay masked.
-- - Conversations of buyers who didn't win become read-only when the auction ends.
-- - viewing_requests: the buyer or seller proposes 1-3 times; the other confirms one or
--   declines. shared_phones: after a confirmed viewing, a party can share their own phone.
-- - conversation_reports: either party reports a conversation; admins review them on
--   /admin/messages and can close it or block a member from messaging.
-- - Every write goes through the security definer functions below, which check the
--   caller, the conversation's state and the rate limits (20 messages an hour, 10 new
--   conversations a day before a sale).
--
-- Idempotent: safe to run more than once. Nothing is dropped; existing conversations
-- and messages aren't rewritten (they get topic 'sale'). place_bid is not touched.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Conversations: topic, status, one per buyer and car, no sale needed
-- -----------------------------------------------------------------------------
alter table public.conversations add column if not exists topic text;
alter table public.conversations add column if not exists status text not null default 'open';
alter table public.conversations add column if not exists sale_confirmed_at timestamptz;
alter table public.conversations add column if not exists closed_at timestamptz;
alter table public.conversations alter column buyer_payment_id drop not null;

-- Existing conversations are after-sale ones.
update public.conversations set topic = 'sale' where topic is null;
update public.conversations set sale_confirmed_at = created_at where sale_confirmed_at is null and buyer_payment_id is not null;
alter table public.conversations alter column topic set default 'sale';
alter table public.conversations alter column topic set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.conversations'::regclass and conname = 'conversations_topic_check') then
    alter table public.conversations add constraint conversations_topic_check
      check (topic in ('viewing', 'inspection', 'question', 'sale'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.conversations'::regclass and conname = 'conversations_status_check') then
    alter table public.conversations add constraint conversations_status_check check (status in ('open', 'closed'));
  end if;
  -- One conversation per buyer and car. Stop with a clear message rather than guess
  -- if older data ever had two (a sale is paid once per auction, so it shouldn't).
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'conversations_auction_buyer_key') then
    if exists (select 1 from public.conversations group by auction_id, buyer_id having count(*) > 1) then
      raise exception 'Two conversations exist for the same buyer and car. Merge them by hand before running 0029.';
    end if;
    create unique index conversations_auction_buyer_key on public.conversations (auction_id, buyer_id);
  end if;
end $$;
create index if not exists conversations_buyer_created_idx on public.conversations (buyer_id, created_at desc);

-- -----------------------------------------------------------------------------
-- Messages: masked contact details, originals for admins only
-- -----------------------------------------------------------------------------
alter table public.messages add column if not exists masked boolean not null default false;

create table if not exists public.messages_private (
  -- Deferred: the original is stored by the BEFORE INSERT trigger, before the message row exists.
  message_id    uuid primary key references public.messages (id) on delete cascade deferrable initially deferred,
  original_body text not null,
  created_at    timestamptz not null default now()
);
alter table public.messages_private enable row level security;
revoke all on public.messages_private from anon, authenticated;
grant all on public.messages_private to service_role;

-- Replaces phone numbers, email addresses and links with "[contact details hidden]".
-- Phone numbers: 7-15 digits with spaces, dots, dashes, slashes or brackets between them,
-- but not prices (after €/EUR), measurements (before km, hp, kW...) or dates.
create or replace function public.mask_contact_details(p_text text)
returns text language plpgsql immutable set search_path = public as $$
declare
  v text := p_text;
  m text[];
  v_digits integer;
  c_token constant text := '[contact details hidden]';
begin
  if v is null then
    return v;
  end if;
  v := regexp_replace(v, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', c_token, 'g');
  v := regexp_replace(v, '(https?://|www\.)[^\s]+', c_token, 'gi');
  v := regexp_replace(v,
    '\m[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)*\.(com|net|org|info|biz|io|eu|ee|lv|lt|fi|se|no|dk|de|at|ch|nl|be|fr|it|es|pt|pl|cz|sk|hu|ro|bg|gr|ie|uk|co|me|app|link|ly|to|ru|ua|lu|si|hr|cy|mt|is)\M(/[^\s]*)?',
    c_token, 'gi');
  for m in
    select regexp_matches(v, '(€ ?|eur ?)?(\+?\(?\d[\d .()/-]{5,}\d\)?)( ?(km|€|eur|kw|hp|ps|cc|kg|mm|nm|l/100))?', 'gi')
  loop
    continue when m[1] is not null or m[3] is not null;
    continue when m[2] ~ '\d{4}-\d{1,2}-\d{1,2}' or m[2] ~ '(^|[^\d])\d{1,2}[./]\d{1,2}[./]\d{2,4}';
    v_digits := char_length(regexp_replace(m[2], '\D', '', 'g'));
    continue when v_digits < 7 or v_digits > 15;
    v := replace(v, m[2], c_token);
  end loop;
  return v;
end $$;
revoke all on function public.mask_contact_details(text) from public, anon;
grant execute on function public.mask_contact_details(text) to authenticated, service_role;

-- Masked unless the conversation's buyer's premium is paid (Biddr support is never masked).
create or replace function public.messages_mask_contacts()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_masked text;
begin
  if new.sender_role = 'support' then
    return new;
  end if;
  if exists (
    select 1 from public.conversations c join public.buyer_payments p on p.id = c.buyer_payment_id
     where c.id = new.conversation_id and p.status = 'paid'
  ) then
    return new;
  end if;
  v_masked := public.mask_contact_details(new.body);
  if v_masked is distinct from new.body then
    insert into public.messages_private (message_id, original_body) values (new.id, new.body)
    on conflict (message_id) do nothing;
    new.body := v_masked;
    new.masked := true;
  end if;
  return new;
end $$;
drop trigger if exists messages_mask_contacts on public.messages;
create trigger messages_mask_contacts before insert on public.messages
  for each row execute function public.messages_mask_contacts();

-- -----------------------------------------------------------------------------
-- Blocked from messaging (admins, after a report)
-- -----------------------------------------------------------------------------
alter table public.profiles add column if not exists messaging_blocked_at timestamptz;
alter table public.profiles add column if not exists messaging_block_reason text;

-- -----------------------------------------------------------------------------
-- Viewing requests, shared phones, reports
-- -----------------------------------------------------------------------------
create table if not exists public.viewing_requests (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  proposed_slots  timestamptz[] not null check (cardinality(proposed_slots) between 1 and 3),
  confirmed_slot  timestamptz,
  status          text not null default 'proposed' check (status in ('proposed', 'confirmed', 'declined', 'cancelled')),
  created_by      uuid not null references public.profiles (id),
  responded_by    uuid references public.profiles (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists viewing_requests_conversation_idx on public.viewing_requests (conversation_id, created_at);
create index if not exists viewing_requests_creator_idx on public.viewing_requests (created_by, created_at desc);
alter table public.viewing_requests enable row level security;
revoke all on public.viewing_requests from anon, authenticated;
grant select on public.viewing_requests to authenticated;
grant all on public.viewing_requests to service_role;
drop policy if exists "parties read viewing requests" on public.viewing_requests;
create policy "parties read viewing requests" on public.viewing_requests
  for select to authenticated using (
    exists (select 1 from public.conversations c
             where c.id = conversation_id and (c.buyer_id = auth.uid() or c.seller_id = auth.uid()))
  );

create table if not exists public.shared_phones (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  shared_at       timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
alter table public.shared_phones enable row level security;
revoke all on public.shared_phones from anon, authenticated;
grant select on public.shared_phones to authenticated;
grant all on public.shared_phones to service_role;
drop policy if exists "parties read shared phones" on public.shared_phones;
create policy "parties read shared phones" on public.shared_phones
  for select to authenticated using (
    exists (select 1 from public.conversations c
             where c.id = conversation_id and (c.buyer_id = auth.uid() or c.seller_id = auth.uid()))
  );

create table if not exists public.conversation_reports (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  reporter_id     uuid not null references public.profiles (id),
  reason          text not null check (char_length(reason) between 10 and 1000),
  resolved_at     timestamptz,
  resolved_by     uuid references public.profiles (id),
  created_at      timestamptz not null default now()
);
create unique index if not exists conversation_reports_one_open
  on public.conversation_reports (conversation_id, reporter_id) where resolved_at is null;
create index if not exists conversation_reports_open_idx on public.conversation_reports (created_at desc) where resolved_at is null;
alter table public.conversation_reports enable row level security;
revoke all on public.conversation_reports from anon, authenticated;
grant select on public.conversation_reports to authenticated;
grant all on public.conversation_reports to service_role;
drop policy if exists "reporters read their conversation reports" on public.conversation_reports;
create policy "reporters read their conversation reports" on public.conversation_reports
  for select to authenticated using (reporter_id = auth.uid());

-- Live updates in the conversation (Realtime applies the select policies).
do $$
declare
  t text;
begin
  foreach t in array array['viewing_requests', 'shared_phones'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- The conversation's state: which phase it is in and whether it takes new messages.
--   phase 'sale': the buyer's premium is paid (or was: refunded and cancelled close it).
--   phase 'pre_sale': before that. Writable while the auction is upcoming or live, and
--   for the winner (or a second-chance buyer) while their premium is being paid.
-- -----------------------------------------------------------------------------
create or replace function public.conversation_state(p_conversation uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_conv public.conversations;
  v_auction public.auctions;
  v_payment text;
  v_read_only timestamptz;
begin
  select * into v_conv from public.conversations where id = p_conversation;
  if not found then
    return null;
  end if;
  select * into v_auction from public.auctions where id = v_conv.auction_id;

  if v_conv.buyer_payment_id is not null then
    select status into v_payment from public.buyer_payments where id = v_conv.buyer_payment_id;
    v_read_only := public.conversation_read_only_at(p_conversation);
    return jsonb_build_object(
      'phase', 'sale',
      'writable', v_conv.status = 'open' and v_payment = 'paid' and (v_read_only is null or v_read_only > now()),
      'reason', case when v_conv.status <> 'open' then 'CONVERSATION_CLOSED_BY_BIDDR'
                     when v_payment is distinct from 'paid' then 'CONVERSATION_CLOSED'
                     when v_read_only <= now() then 'CONVERSATION_READ_ONLY' end,
      'read_only_at', v_read_only);
  end if;

  if v_conv.status <> 'open' then
    return jsonb_build_object('phase', 'pre_sale', 'writable', false, 'reason', 'CONVERSATION_CLOSED_BY_BIDDR');
  end if;
  if v_auction.status in ('upcoming', 'live') and v_auction.ends_at > now() then
    return jsonb_build_object('phase', 'pre_sale', 'writable', true, 'reason', null);
  end if;
  if exists (select 1 from public.buyer_payments
              where auction_id = v_conv.auction_id and winner_id = v_conv.buyer_id
                and status in ('pending', 'action_required', 'failed')) then
    return jsonb_build_object('phase', 'pre_sale', 'writable', true, 'reason', null);
  end if;
  return jsonb_build_object('phase', 'pre_sale', 'writable', false, 'reason', 'AUCTION_ENDED');
end $$;
revoke all on function public.conversation_state(uuid) from public, anon;
grant execute on function public.conversation_state(uuid) to authenticated, service_role;

-- Can this member contact sellers? (the same checks as bidding, plus messaging blocks)
create or replace function public.contact_requirement(p_user uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when not public.bidder_profile_complete(p_user) then 'PROFILE_INCOMPLETE'
    when not public.bidder_terms_accepted(p_user) then 'TERMS_NOT_ACCEPTED'
    when public.bidder_blocked(p_user) then 'BIDDING_BLOCKED'
    when exists (select 1 from public.profiles where id = p_user and messaging_blocked_at is not null) then 'MESSAGING_BLOCKED'
  end;
$$;
revoke all on function public.contact_requirement(uuid) from public, anon, authenticated;
grant execute on function public.contact_requirement(uuid) to service_role;

-- Shared by the functions below: the caller's conversation, or an error.
create or replace function public.conversation_for_party(p_conversation uuid, p_uid uuid)
returns public.conversations language plpgsql stable security definer set search_path = public as $$
declare
  v_conv public.conversations;
begin
  if p_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  select * into v_conv from public.conversations where id = p_conversation;
  if not found or (v_conv.buyer_id <> p_uid and v_conv.seller_id <> p_uid) then
    raise exception 'CONVERSATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  return v_conv;
end $$;
revoke all on function public.conversation_for_party(uuid, uuid) from public, anon, authenticated;

create or replace function public.require_writable(p_conversation uuid, p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_state jsonb := public.conversation_state(p_conversation);
begin
  if exists (select 1 from public.profiles where id = p_uid and messaging_blocked_at is not null) then
    raise exception 'MESSAGING_BLOCKED' using errcode = 'P0001';
  end if;
  if not coalesce((v_state->>'writable')::boolean, false) then
    raise exception '%', coalesce(v_state->>'reason', 'CONVERSATION_CLOSED') using errcode = 'P0001';
  end if;
  return v_state;
end $$;
revoke all on function public.require_writable(uuid, uuid) from public, anon, authenticated;

-- A thread was active: newest first in the inbox, and the actor has read it.
create or replace function public.touch_conversation(p_conversation uuid, p_uid uuid, p_at timestamptz)
returns void language sql security definer set search_path = public as $$
  update public.conversations
     set last_message_at = p_at,
         buyer_last_read_at  = case when buyer_id  = p_uid then p_at else buyer_last_read_at end,
         seller_last_read_at = case when seller_id = p_uid then p_at else seller_last_read_at end
   where id = p_conversation;
$$;
revoke all on function public.touch_conversation(uuid, uuid, timestamptz) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- send_message: the only way a member writes a message (now for both phases).
-- -----------------------------------------------------------------------------
create or replace function public.send_message(p_conversation uuid, p_body text)
returns public.messages
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_conv public.conversations;
  v_state jsonb;
  v_role text;
  v_body text := btrim(coalesce(p_body, ''));
  v_msg public.messages;
  v_other uuid;
begin
  v_conv := public.conversation_for_party(p_conversation, v_uid);
  v_state := public.require_writable(p_conversation, v_uid);
  if char_length(v_body) = 0 then
    raise exception 'MESSAGE_EMPTY' using errcode = 'P0001';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'MESSAGE_TOO_LONG' using errcode = 'P0001';
  end if;
  if v_state->>'phase' = 'sale' then
    if (select count(*) from public.messages where sender_id = v_uid and created_at > now() - interval '10 minutes') >= 30 then
      raise exception 'MESSAGE_RATE_LIMIT' using errcode = 'P0001';
    end if;
  elsif (select count(*) from public.messages where sender_id = v_uid and created_at > now() - interval '1 hour') >= 20 then
    raise exception 'MESSAGE_RATE_LIMIT' using errcode = 'P0001';
  end if;

  v_role := case when v_conv.buyer_id = v_uid then 'buyer' else 'seller' end;
  v_other := case when v_role = 'buyer' then v_conv.seller_id else v_conv.buyer_id end;

  insert into public.messages (conversation_id, sender_id, sender_role, body)
  values (p_conversation, v_uid, v_role, v_body)
  returning * into v_msg;
  perform public.touch_conversation(p_conversation, v_uid, v_msg.created_at);

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

-- -----------------------------------------------------------------------------
-- start_conversation: "Contact seller". Returns the conversation (an existing one for
-- this buyer and car is reused, with the message added to it).
-- -----------------------------------------------------------------------------
create or replace function public.start_conversation(p_auction uuid, p_topic text, p_body text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_auction public.auctions;
  v_requirement text;
  v_id uuid;
  v_body text := btrim(coalesce(p_body, ''));
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  select * into v_auction from public.auctions where id = p_auction;
  if not found or v_auction.status not in ('upcoming', 'live') or v_auction.ends_at <= now() then
    raise exception 'AUCTION_NOT_OPEN' using errcode = 'P0001';
  end if;
  if v_auction.is_demo then
    raise exception 'DEMO_AUCTION' using errcode = 'P0001';
  end if;
  if v_auction.seller_id = v_uid then
    raise exception 'OWN_AUCTION' using errcode = 'P0001';
  end if;
  v_requirement := public.contact_requirement(v_uid);
  if v_requirement is not null then
    raise exception '%', v_requirement using errcode = 'P0001';
  end if;
  if p_topic is null or p_topic not in ('viewing', 'inspection', 'question') then
    raise exception 'TOPIC_REQUIRED' using errcode = 'P0001';
  end if;
  if char_length(v_body) = 0 then
    raise exception 'MESSAGE_EMPTY' using errcode = 'P0001';
  end if;
  if char_length(v_body) > 2000 then
    raise exception 'MESSAGE_TOO_LONG' using errcode = 'P0001';
  end if;

  select id into v_id from public.conversations where auction_id = p_auction and buyer_id = v_uid;
  if v_id is null then
    if (select count(*) from public.conversations
         where buyer_id = v_uid and topic <> 'sale' and created_at > now() - interval '1 day') >= 10 then
      raise exception 'CONVERSATION_RATE_LIMIT' using errcode = 'P0001';
    end if;
    insert into public.conversations (auction_id, buyer_id, seller_id, topic)
    values (p_auction, v_uid, v_auction.seller_id, p_topic)
    on conflict (auction_id, buyer_id) do nothing
    returning id into v_id;
    if v_id is null then
      select id into v_id from public.conversations where auction_id = p_auction and buyer_id = v_uid;
    end if;
  end if;
  perform public.send_message(v_id, v_body);
  return v_id;
end $$;
revoke all on function public.start_conversation(uuid, text, text) from public, anon;
grant execute on function public.start_conversation(uuid, text, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Viewing requests
-- -----------------------------------------------------------------------------
create or replace function public.propose_viewing(p_conversation uuid, p_slots timestamptz[])
returns public.viewing_requests language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_conv public.conversations;
  v_slots timestamptz[];
  v_row public.viewing_requests;
begin
  v_conv := public.conversation_for_party(p_conversation, v_uid);
  perform public.require_writable(p_conversation, v_uid);
  select array_agg(distinct s order by s) into v_slots from unnest(coalesce(p_slots, '{}')) s where s is not null;
  if v_slots is null or cardinality(v_slots) < 1 or cardinality(v_slots) > 3 then
    raise exception 'VIEWING_SLOTS' using errcode = 'P0001';
  end if;
  if exists (select 1 from unnest(v_slots) s where s <= now() or s > now() + interval '90 days') then
    raise exception 'VIEWING_SLOT_TIME' using errcode = 'P0001';
  end if;
  if (select count(*) from public.viewing_requests where created_by = v_uid and created_at > now() - interval '1 day') >= 10 then
    raise exception 'VIEWING_RATE_LIMIT' using errcode = 'P0001';
  end if;
  -- New times replace any still waiting for an answer.
  update public.viewing_requests set status = 'cancelled', updated_at = now()
   where conversation_id = p_conversation and status = 'proposed';
  insert into public.viewing_requests (conversation_id, proposed_slots, created_by)
  values (p_conversation, v_slots, v_uid)
  returning * into v_row;
  perform public.touch_conversation(p_conversation, v_uid, v_row.created_at);
  perform public.notify(case when v_conv.buyer_id = v_uid then v_conv.seller_id else v_conv.buyer_id end,
    'viewing_update', v_conv.auction_id, null, v_uid,
    jsonb_build_object('conversation_id', p_conversation, 'request_id', v_row.id, 'status', 'proposed'));
  return v_row;
end $$;
revoke all on function public.propose_viewing(uuid, timestamptz[]) from public, anon;
grant execute on function public.propose_viewing(uuid, timestamptz[]) to authenticated;

-- p_action: 'confirm' (with one of the proposed times) or 'decline', by the other
-- party; 'cancel' by the proposer while waiting, or by either party once confirmed.
create or replace function public.respond_viewing(p_request uuid, p_action text, p_slot timestamptz default null)
returns public.viewing_requests language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_req public.viewing_requests;
  v_conv public.conversations;
  v_other uuid;
begin
  select * into v_req from public.viewing_requests where id = p_request;
  if not found then
    raise exception 'VIEWING_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_conv := public.conversation_for_party(v_req.conversation_id, v_uid);
  perform public.require_writable(v_req.conversation_id, v_uid);
  v_other := case when v_conv.buyer_id = v_uid then v_conv.seller_id else v_conv.buyer_id end;

  if p_action = 'confirm' then
    if v_req.status <> 'proposed' or v_req.created_by = v_uid then
      raise exception 'VIEWING_NOT_PENDING' using errcode = 'P0001';
    end if;
    if p_slot is null or not (p_slot = any (v_req.proposed_slots)) or p_slot <= now() then
      raise exception 'VIEWING_SLOT_TIME' using errcode = 'P0001';
    end if;
    update public.viewing_requests
       set status = 'confirmed', confirmed_slot = p_slot, responded_by = v_uid, updated_at = now()
     where id = p_request returning * into v_req;
  elsif p_action = 'decline' then
    if v_req.status <> 'proposed' or v_req.created_by = v_uid then
      raise exception 'VIEWING_NOT_PENDING' using errcode = 'P0001';
    end if;
    update public.viewing_requests set status = 'declined', responded_by = v_uid, updated_at = now()
     where id = p_request returning * into v_req;
  elsif p_action = 'cancel' then
    if not (v_req.status = 'confirmed' or (v_req.status = 'proposed' and v_req.created_by = v_uid)) then
      raise exception 'VIEWING_NOT_PENDING' using errcode = 'P0001';
    end if;
    update public.viewing_requests set status = 'cancelled', responded_by = v_uid, updated_at = now()
     where id = p_request returning * into v_req;
  else
    raise exception 'VIEWING_ACTION' using errcode = 'P0001';
  end if;

  perform public.touch_conversation(v_req.conversation_id, v_uid, v_req.updated_at);
  perform public.notify(v_other, 'viewing_update', v_conv.auction_id, null, v_uid,
    jsonb_build_object('conversation_id', v_conv.id, 'request_id', v_req.id, 'status', v_req.status, 'slot', v_req.confirmed_slot));
  -- A confirmed viewing: both get a notification (the confirmer too, as a record).
  if v_req.status = 'confirmed' then
    perform public.notify(v_uid, 'viewing_update', v_conv.auction_id, null, null,
      jsonb_build_object('conversation_id', v_conv.id, 'request_id', v_req.id, 'status', 'confirmed', 'slot', v_req.confirmed_slot));
  end if;
  return v_req;
end $$;
revoke all on function public.respond_viewing(uuid, text, timestamptz) from public, anon;
grant execute on function public.respond_viewing(uuid, text, timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- Phone numbers, deliberately shared for a confirmed viewing (can't be taken back).
-- -----------------------------------------------------------------------------
create or replace function public.share_phone(p_conversation uuid)
returns public.shared_phones language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_conv public.conversations;
  v_row public.shared_phones;
begin
  v_conv := public.conversation_for_party(p_conversation, v_uid);
  perform public.require_writable(p_conversation, v_uid);
  if not exists (select 1 from public.viewing_requests where conversation_id = p_conversation and status = 'confirmed') then
    raise exception 'VIEWING_NOT_CONFIRMED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles where id = v_uid and nullif(btrim(phone), '') is not null) then
    raise exception 'PHONE_MISSING' using errcode = 'P0001';
  end if;
  insert into public.shared_phones (conversation_id, user_id) values (p_conversation, v_uid)
  on conflict (conversation_id, user_id) do nothing;
  select * into v_row from public.shared_phones where conversation_id = p_conversation and user_id = v_uid;
  perform public.notify(case when v_conv.buyer_id = v_uid then v_conv.seller_id else v_conv.buyer_id end,
    'viewing_update', v_conv.auction_id, null, v_uid,
    jsonb_build_object('conversation_id', p_conversation, 'status', 'phone_shared'));
  return v_row;
end $$;
revoke all on function public.share_phone(uuid) from public, anon;
grant execute on function public.share_phone(uuid) to authenticated;

-- The phone numbers shared in this conversation (for its two parties only).
create or replace function public.conversation_shared_phones(p_conversation uuid)
returns table (user_id uuid, phone text, shared_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  perform public.conversation_for_party(p_conversation, auth.uid());
  return query
    select s.user_id, p.phone, s.shared_at
      from public.shared_phones s join public.profiles p on p.id = s.user_id
     where s.conversation_id = p_conversation
     order by s.shared_at;
end $$;
revoke all on function public.conversation_shared_phones(uuid) from public, anon;
grant execute on function public.conversation_shared_phones(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Reports
-- -----------------------------------------------------------------------------
create or replace function public.report_conversation(p_conversation uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_conv public.conversations;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_id uuid;
  v_admin uuid;
begin
  v_conv := public.conversation_for_party(p_conversation, v_uid);
  if char_length(v_reason) < 10 then
    raise exception 'REPORT_REASON_SHORT' using errcode = 'P0001';
  end if;
  if char_length(v_reason) > 1000 then
    raise exception 'REPORT_REASON_LONG' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.conversation_reports
              where conversation_id = p_conversation and reporter_id = v_uid and resolved_at is null) then
    raise exception 'REPORT_ALREADY_OPEN' using errcode = 'P0001';
  end if;
  if (select count(*) from public.conversation_reports where reporter_id = v_uid and created_at > now() - interval '1 day') >= 5 then
    raise exception 'REPORT_RATE_LIMIT' using errcode = 'P0001';
  end if;
  insert into public.conversation_reports (conversation_id, reporter_id, reason)
  values (p_conversation, v_uid, v_reason)
  returning id into v_id;
  for v_admin in select id from public.profiles where role = 'admin' loop
    perform public.notify(v_admin, 'conversation_reported', v_conv.auction_id, null, v_uid,
      jsonb_build_object('conversation_id', p_conversation, 'report_id', v_id));
  end loop;
  return v_id;
end $$;
revoke all on function public.report_conversation(uuid, text) from public, anon;
grant execute on function public.report_conversation(uuid, text) to authenticated;

-- Reading the conversation also reads its viewing notifications.
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
   where user_id = v_uid and type in ('new_message', 'viewing_update') and read_at is null
     and data->>'conversation_id' = p_conversation::text;
end $$;
revoke all on function public.mark_conversation_read(uuid) from public, anon;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- After the sale: the buyer's conversation (if any) becomes the after-sale one.
-- -----------------------------------------------------------------------------
create or replace function public.conversation_on_paid()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'paid' then
    insert into public.conversations (auction_id, buyer_payment_id, buyer_id, seller_id, topic, sale_confirmed_at)
    values (new.auction_id, new.id, new.winner_id, new.seller_id, 'sale', now())
    on conflict (auction_id, buyer_id) do update
      set buyer_payment_id  = coalesce(public.conversations.buyer_payment_id, excluded.buyer_payment_id),
          sale_confirmed_at = coalesce(public.conversations.sale_confirmed_at, now());
  end if;
  return null;
end $$;
-- (The trigger on buyer_payments from 0026 already calls this function.)

-- Conversations are deleted 3 years after the sale; ones without a sale 3 years after
-- the auction ended.
create or replace function public.purge_old_conversations()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
  v_m integer;
begin
  delete from public.conversations c
   using public.buyer_payments p
   where p.id = c.buyer_payment_id
     and coalesce(p.paid_at, c.created_at) < now() - interval '3 years';
  get diagnostics v_n = row_count;
  delete from public.conversations c
   using public.auctions a
   where c.buyer_payment_id is null and a.id = c.auction_id
     and a.ends_at < now() - interval '3 years';
  get diagnostics v_m = row_count;
  return v_n + v_m;
end $$;
revoke all on function public.purge_old_conversations() from public, anon, authenticated;
grant execute on function public.purge_old_conversations() to service_role;

-- -----------------------------------------------------------------------------
-- Notifications. Widen-only, as in earlier migrations.
-- -----------------------------------------------------------------------------
do $$
declare
  v_def text;
  v_types text[] := array['question', 'answer', 'outbid', 'listing_approved', 'listing_rejected',
      'auction_live', 'auction_ended', 'auction_won', 'listing_submitted',
      'watch_ending_soon', 'watch_live', 'inspection_rejected',
      'withdrawal_approved', 'withdrawal_declined',
      'seller_decided', 'inspection_decision_reminder', 'inspection_decision_expired',
      'history_report_rejected', 'premium_due', 'premium_paid', 'premium_failed',
      'make_suggested', 'premium_reminder', 'premium_unpaid', 'buyer_did_not_pay',
      'second_chance_offer', 'second_chance_closed', 'bidding_unblocked',
      'new_message', 'report_opened', 'report_resolved', 'account_blocked', 'selling_unblocked',
      'viewing_update', 'conversation_reported', 'messaging_unblocked'];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.notifications'::regclass and conname = 'notifications_type_check';
  if v_def is null or exists (select 1 from unnest(v_types) as t(v) where position(quote_literal(t.v) in v_def) = 0) then
    alter table public.notifications drop constraint if exists notifications_type_check;
    -- Same "type in (...)" form as before, so earlier migrations re-run safely.
    execute format('alter table public.notifications add constraint notifications_type_check check (type in (%s))',
      (select string_agg(quote_literal(t), ', ') from unnest(v_types) t));
  end if;
end $$;
