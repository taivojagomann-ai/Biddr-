-- =============================================================================
-- In-app notifications (header bell, /account/notifications).
-- Rows store only the type and ids/data, never finished sentences, so the app
-- can word (and later translate) them. Created by triggers only.
-- Idempotent: safe to run more than once. Drops no tables, columns or data
-- (only this file's own policies, triggers and constraint are re-created).
-- place_bid and the existing comment triggers are not touched.
-- =============================================================================

create table if not exists public.notifications (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  type        text not null,
  auction_id  uuid references public.auctions (id) on delete cascade,
  comment_id  uuid references public.comments (id) on delete cascade,
  actor_id    uuid references public.profiles (id) on delete set null,
  data        jsonb not null default '{}'::jsonb,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'question', 'answer', 'outbid', 'listing_approved', 'listing_rejected',
  'auction_live', 'auction_ended', 'auction_won', 'listing_submitted'
));

create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx on public.notifications (user_id) where read_at is null;

-- -----------------------------------------------------------------------------
-- Access: users read their own rows and may only set read_at on them.
-- No browser INSERT or DELETE: rows come from the triggers below.
-- -----------------------------------------------------------------------------
alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.notifications to service_role;

drop policy if exists "users read own notifications" on public.notifications;
create policy "users read own notifications" on public.notifications
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "users mark own notifications read" on public.notifications;
create policy "users mark own notifications read" on public.notifications
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Live updates for the bell (Realtime applies the SELECT policy above).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Helper: one place for "never tell people about their own action".
-- -----------------------------------------------------------------------------
create or replace function public.notify(
  p_user uuid, p_type text, p_auction uuid, p_comment uuid, p_actor uuid, p_data jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = p_actor then
    return;
  end if;
  insert into public.notifications (user_id, type, auction_id, comment_id, actor_id, data)
  values (p_user, p_type, p_auction, p_comment, p_actor, coalesce(p_data, '{}'::jsonb));
end $$;
revoke all on function public.notify(uuid, text, uuid, uuid, uuid, jsonb) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Comments: a question to the seller, and the seller's answer to the asker.
-- Runs AFTER INSERT, so the existing BEFORE triggers have already set user_id.
-- -----------------------------------------------------------------------------
create or replace function public.notifications_on_comment()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_auction public.auctions%rowtype;
  v_parent_author uuid;
begin
  select * into v_auction from public.auctions where id = new.auction_id;
  if not found or v_auction.is_demo then
    return null;
  end if;

  if new.parent_id is null then
    if new.user_id <> v_auction.seller_id then
      perform public.notify(v_auction.seller_id, 'question', new.auction_id, new.id, new.user_id);
    end if;
  elsif new.user_id = v_auction.seller_id then
    select user_id into v_parent_author from public.comments where id = new.parent_id;
    perform public.notify(v_parent_author, 'answer', new.auction_id, new.id, new.user_id);
  end if;
  return null;
end $$;

drop trigger if exists notifications_on_comment on public.comments;
create trigger notifications_on_comment
  after insert on public.comments
  for each row execute function public.notifications_on_comment();

-- -----------------------------------------------------------------------------
-- Bids: tell the previous leader they were outbid. The previous leader is read
-- from the bid history (highest earlier bid), which is correct whatever order
-- place_bid inserts the bid and updates the auction in.
-- -----------------------------------------------------------------------------
create or replace function public.notifications_on_bid()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_demo boolean;
  v_previous uuid;
begin
  select is_demo into v_demo from public.auctions where id = new.auction_id;
  if v_demo is distinct from false then
    return null;
  end if;

  select bidder_id into v_previous
    from public.bids
   where auction_id = new.auction_id and id <> new.id
   order by amount desc, created_at desc
   limit 1;

  if v_previous is not null and v_previous <> new.bidder_id then
    perform public.notify(v_previous, 'outbid', new.auction_id, null, new.bidder_id,
                          jsonb_build_object('amount', new.amount));
  end if;
  return null;
end $$;

drop trigger if exists notifications_on_bid on public.bids;
create trigger notifications_on_bid
  after insert on public.bids
  for each row execute function public.notifications_on_bid();

-- -----------------------------------------------------------------------------
-- Auction status changes: seller (and the winner on a sale).
-- status is compared as text, so 'rejected' (added in 0004) is safe here.
-- -----------------------------------------------------------------------------
create or replace function public.notifications_on_auction_status()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_from text := old.status::text;
  v_to   text := new.status::text;
  v_actor uuid := auth.uid(); -- null for admin actions (service role) and the cron job
begin
  if new.is_demo or v_from = v_to then
    return null;
  end if;

  if v_from = 'draft' and v_to = 'upcoming' then
    perform public.notify(new.seller_id, 'listing_approved', new.id, null, v_actor,
                          jsonb_build_object('starts_at', new.starts_at));
  elsif v_to = 'rejected' then
    perform public.notify(new.seller_id, 'listing_rejected', new.id, null, v_actor);
  elsif v_from = 'upcoming' and v_to = 'live' then
    perform public.notify(new.seller_id, 'auction_live', new.id, null, v_actor);
  elsif v_from = 'live' and v_to in ('sold', 'reserve_not_met', 'ended') then
    perform public.notify(new.seller_id, 'auction_ended', new.id, null, v_actor,
                          jsonb_build_object('status', v_to, 'final_bid', new.current_bid));
    if v_to = 'sold' then
      perform public.notify(new.leading_bidder_id, 'auction_won', new.id, null, v_actor,
                            jsonb_build_object('final_bid', new.current_bid));
    end if;
  end if;
  return null;
end $$;

drop trigger if exists notifications_on_auction_status on public.auctions;
create trigger notifications_on_auction_status
  after update of status on public.auctions
  for each row execute function public.notifications_on_auction_status();

-- -----------------------------------------------------------------------------
-- New listing submitted: every admin (except the seller, if an admin sells).
-- -----------------------------------------------------------------------------
create or replace function public.notifications_on_auction_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid;
begin
  if new.is_demo or new.status::text <> 'draft' then
    return null;
  end if;
  for v_admin in select id from public.profiles where role = 'admin' loop
    perform public.notify(v_admin, 'listing_submitted', new.id, null, new.seller_id);
  end loop;
  return null;
end $$;

drop trigger if exists notifications_on_auction_insert on public.auctions;
create trigger notifications_on_auction_insert
  after insert on public.auctions
  for each row execute function public.notifications_on_auction_insert();

-- -----------------------------------------------------------------------------
-- Housekeeping: delete notifications older than 90 days, daily at 03:17 UTC.
-- cron.schedule with a job name replaces an existing job of that name.
-- -----------------------------------------------------------------------------
select cron.schedule(
  'purge-old-notifications',
  '17 3 * * *',
  $$delete from public.notifications where created_at < now() - interval '90 days'$$
);
