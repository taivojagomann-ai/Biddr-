-- =============================================================================
-- Watchlist: members follow auctions; bidders follow automatically. Watchers get
-- "starts now" and "ends within the hour" notifications (reusing 0009).
-- Idempotent: safe to run more than once. Drops no tables, columns or data
-- (only this file's own policies, triggers and the notifications type check are
-- re-created). place_bid and existing triggers are not touched.
-- =============================================================================

create table if not exists public.watchlist (
  user_id    uuid not null references public.profiles (id) on delete cascade,
  auction_id uuid not null references public.auctions (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, auction_id)
);
create index if not exists watchlist_auction_idx on public.watchlist (auction_id);

-- -----------------------------------------------------------------------------
-- Access: own rows only. You can only watch auctions you can see (not someone
-- else's draft or rejected listing); the subquery runs under the auctions RLS.
-- -----------------------------------------------------------------------------
alter table public.watchlist enable row level security;
revoke all on public.watchlist from anon, authenticated;
grant select, insert, delete on public.watchlist to authenticated;
grant all on public.watchlist to service_role;

drop policy if exists "users read own watchlist" on public.watchlist;
create policy "users read own watchlist" on public.watchlist
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "users add to own watchlist" on public.watchlist;
create policy "users add to own watchlist" on public.watchlist
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.auctions a where a.id = auction_id and a.status::text not in ('draft', 'rejected'))
  );

drop policy if exists "users remove from own watchlist" on public.watchlist;
create policy "users remove from own watchlist" on public.watchlist
  for delete to authenticated using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- auctions.watch_count, kept in step by triggers (never below 0). Browsers can
-- read it (auctions has a table-wide SELECT grant) but not write it.
-- -----------------------------------------------------------------------------
alter table public.auctions add column if not exists watch_count integer not null default 0;

create or replace function public.watchlist_count()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.auctions set watch_count = watch_count + 1 where id = new.auction_id;
    return new;
  end if;
  -- On a cascade from a deleted auction the row is already gone: this updates nothing.
  update public.auctions set watch_count = greatest(0, watch_count - 1) where id = old.auction_id;
  return old;
end $$;

drop trigger if exists watchlist_count on public.watchlist;
create trigger watchlist_count
  after insert or delete on public.watchlist
  for each row execute function public.watchlist_count();

-- Backfill from the real watchlist. Demo rows keep their made-up counts.
update public.auctions a
   set watch_count = coalesce((select count(*) from public.watchlist w where w.auction_id = a.id), 0)
 where not a.is_demo
   and a.watch_count is distinct from coalesce((select count(*) from public.watchlist w where w.auction_id = a.id), 0);

-- -----------------------------------------------------------------------------
-- Auto-watch: bidding on a car adds it to the bidder's watchlist.
-- Only for signed-in bids (auth.uid() set); server-side inserts are skipped.
-- -----------------------------------------------------------------------------
create or replace function public.watchlist_on_bid()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return null;
  end if;
  insert into public.watchlist (user_id, auction_id) values (new.bidder_id, new.auction_id)
  on conflict do nothing;
  return null;
end $$;

drop trigger if exists watchlist_on_bid on public.bids;
create trigger watchlist_on_bid
  after insert on public.bids
  for each row execute function public.watchlist_on_bid();

-- -----------------------------------------------------------------------------
-- Notifications: two new types, each at most once per user and auction.
-- -----------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'question', 'answer', 'outbid', 'listing_approved', 'listing_rejected',
  'auction_live', 'auction_ended', 'auction_won', 'listing_submitted',
  'watch_ending_soon', 'watch_live'
));

create unique index if not exists notifications_watch_once_idx
  on public.notifications (user_id, auction_id, type)
  where type in ('watch_ending_soon', 'watch_live');

-- Upcoming -> live: tell the watchers (the seller gets auction_live from 0009 instead).
create or replace function public.notifications_on_watched_live()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.is_demo or old.status::text <> 'upcoming' or new.status::text <> 'live' then
    return null;
  end if;
  insert into public.notifications (user_id, type, auction_id)
  select w.user_id, 'watch_live', new.id
    from public.watchlist w
   where w.auction_id = new.id and w.user_id <> new.seller_id
  on conflict (user_id, auction_id, type) where type in ('watch_ending_soon', 'watch_live') do nothing;
  return null;
end $$;

drop trigger if exists notifications_on_watched_live on public.auctions;
create trigger notifications_on_watched_live
  after update of status on public.auctions
  for each row execute function public.notifications_on_watched_live();

-- Live auctions ending within 60 minutes: tell the watchers once (a late-bid
-- extension doesn't send a second one).
create or replace function public.notify_watch_ending_soon()
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_count integer;
begin
  insert into public.notifications (user_id, type, auction_id, data)
  select w.user_id, 'watch_ending_soon', a.id, jsonb_build_object('ends_at', a.ends_at)
    from public.auctions a
    join public.watchlist w on w.auction_id = a.id
   where a.status = 'live'
     and not a.is_demo
     and a.ends_at > now()
     and a.ends_at <= now() + interval '60 minutes'
     and w.user_id <> a.seller_id
  on conflict (user_id, auction_id, type) where type in ('watch_ending_soon', 'watch_live') do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.notify_watch_ending_soon() from public, anon, authenticated;
grant execute on function public.notify_watch_ending_soon() to service_role;

-- Every 5 minutes. Scheduling by name replaces the job on re-runs.
select cron.schedule('watch-ending-soon', '*/5 * * * *', $$select public.notify_watch_ending_soon()$$);
