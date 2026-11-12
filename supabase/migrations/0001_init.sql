-- =============================================================================
-- Baltic enthusiast car auctions: initial schema
-- Money is stored as whole euros (integer). Stripe amounts = euros * 100.
-- All auction-critical logic lives here; the client is never trusted.
-- =============================================================================

create extension if not exists pgcrypto;
create extension if not exists pg_cron;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.user_role        as enum ('user', 'seller', 'admin');
create type public.baltic_country   as enum ('EE', 'LV', 'LT');
create type public.condition_type   as enum ('clean', 'restored_accident');
create type public.auction_status   as enum ('draft', 'upcoming', 'live', 'ended', 'sold', 'reserve_not_met');
create type public.hold_status      as enum ('pending', 'authorized', 'released', 'captured', 'failed');
create type public.inspection_city  as enum ('Tallinn', 'Riga', 'Vilnius');

-- -----------------------------------------------------------------------------
-- profiles
-- Sensitive columns (phone, stripe_customer_id) are hidden with column grants.
-- -----------------------------------------------------------------------------
create table public.profiles (
  id                  uuid primary key references auth.users (id) on delete cascade,
  full_name           text check (char_length(full_name) <= 120),
  username            text unique check (username ~ '^[a-zA-Z0-9_]{3,24}$'),
  country             public.baltic_country,
  phone               text check (char_length(phone) <= 32),
  stripe_customer_id  text unique,
  is_verified_bidder  boolean not null default false,
  role                public.user_role not null default 'user',
  created_at          timestamptz not null default now()
);

-- Create a profile automatically on sign-up.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- -----------------------------------------------------------------------------
-- auctions
-- reserve_price is NOT stored here: anything in this table is readable by
-- everyone (REST + Realtime). The public only sees has_reserve / reserve_met.
-- -----------------------------------------------------------------------------
create table public.auctions (
  id                      uuid primary key default gen_random_uuid(),
  seller_id               uuid not null references public.profiles (id),
  title                   text not null check (char_length(title) between 5 and 140),
  make                    text not null,
  model                   text not null,
  year                    smallint not null check (year between 1950 and 2100),
  vin                     text not null check (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),
  mileage_km              integer not null check (mileage_km >= 0),
  engine                  text,
  transmission            text,
  drivetrain              text,
  exterior_color          text,
  location_city           text not null,
  location_country        public.baltic_country not null,
  condition_type          public.condition_type not null default 'clean',
  damage_history_summary  text,
  inspection_partner_name text,
  inspection_report_url   text,
  inspection_date         date,
  inspection_highlights   jsonb not null default '[]'::jsonb,  -- string[]
  before_photos_urls      jsonb not null default '[]'::jsonb,  -- string[]
  gallery_urls            jsonb not null default '{"exterior":[],"interior":[],"mechanical":[]}'::jsonb,
  video_url               text,
  starting_bid            integer not null check (starting_bid > 0),
  has_reserve             boolean not null default false,
  reserve_met             boolean not null default false,
  current_bid             integer check (current_bid > 0),
  leading_bidder_id       uuid references public.profiles (id),
  bid_count               integer not null default 0,
  min_bid_increment       integer not null default 250 check (min_bid_increment > 0),
  starts_at               timestamptz,
  ends_at                 timestamptz,
  status                  public.auction_status not null default 'draft',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  constraint restored_needs_inspection check (
    condition_type = 'clean'
    or status in ('draft')
    or (inspection_partner_name is not null and inspection_report_url is not null)
  ),
  constraint schedule_valid check (
    status = 'draft' or (starts_at is not null and ends_at is not null and ends_at > starts_at)
  )
);

create index auctions_status_ends_idx on public.auctions (status, ends_at);
create index auctions_make_idx        on public.auctions (lower(make));
create index auctions_country_idx     on public.auctions (location_country);
create index auctions_seller_idx      on public.auctions (seller_id);

-- Private, admin-only data per auction.
create table public.auction_private (
  auction_id      uuid primary key references public.auctions (id) on delete cascade,
  reserve_price   integer check (reserve_price > 0),
  admin_notes     text,
  inspection_city public.inspection_city   -- requested partner inspection location
);

-- -----------------------------------------------------------------------------
-- bid_holds: one Stripe manual-capture authorization per (auction, user)
-- -----------------------------------------------------------------------------
create table public.bid_holds (
  id                        uuid primary key default gen_random_uuid(),
  auction_id                uuid not null references public.auctions (id) on delete cascade,
  user_id                   uuid not null references public.profiles (id) on delete cascade,
  stripe_payment_intent_id  text not null unique,
  amount                    integer not null,           -- euros
  status                    public.hold_status not null default 'pending',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create unique index bid_holds_one_active
  on public.bid_holds (auction_id, user_id)
  where status in ('pending', 'authorized');

-- -----------------------------------------------------------------------------
-- bids (insert only through place_bid)
-- -----------------------------------------------------------------------------
create table public.bids (
  id                        uuid primary key default gen_random_uuid(),
  auction_id                uuid not null references public.auctions (id) on delete cascade,
  bidder_id                 uuid not null references public.profiles (id),
  amount                    integer not null check (amount > 0),
  stripe_payment_intent_id  text,   -- the hold that backed this bid
  created_at                timestamptz not null default now()
);

create index bids_auction_created_idx on public.bids (auction_id, created_at desc);
create index bids_bidder_idx          on public.bids (bidder_id);

-- -----------------------------------------------------------------------------
-- comments
-- -----------------------------------------------------------------------------
create table public.comments (
  id              uuid primary key default gen_random_uuid(),
  auction_id      uuid not null references public.auctions (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  parent_id       uuid references public.comments (id) on delete cascade,
  content         text not null check (char_length(btrim(content)) between 1 and 2000),
  is_seller_reply boolean not null default false,
  created_at      timestamptz not null default now()
);

create index comments_auction_idx on public.comments (auction_id, created_at);

-- is_seller_reply is decided by the database, never by the client.
create or replace function public.comments_set_flags()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.user_id := auth.uid();
  new.is_seller_reply := exists (
    select 1 from public.auctions a where a.id = new.auction_id and a.seller_id = new.user_id
  ) or public.is_admin();
  if new.parent_id is not null and not exists (
    select 1 from public.comments c where c.id = new.parent_id and c.auction_id = new.auction_id
  ) then
    raise exception 'INVALID_PARENT' using errcode = 'P0001';
  end if;
  new.created_at := now();
  return new;
end $$;

create trigger comments_before_insert
  before insert on public.comments
  for each row execute function public.comments_set_flags();

-- updated_at helper
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;

create trigger auctions_touch  before update on public.auctions  for each row execute function public.touch_updated_at();
create trigger bid_holds_touch before update on public.bid_holds for each row execute function public.touch_updated_at();

-- =============================================================================
-- Column-level privileges
-- =============================================================================
revoke all on public.profiles from anon, authenticated;
grant select (id, username, country, role, is_verified_bidder, created_at)
  on public.profiles to anon, authenticated;
grant update (full_name, username, country, phone) on public.profiles to authenticated;

revoke all on public.bids from anon, authenticated;
grant select (id, auction_id, bidder_id, amount, created_at) on public.bids to anon, authenticated;

revoke all on public.auction_private from anon, authenticated;
grant select, insert, update on public.auction_private to authenticated;  -- narrowed by RLS

revoke all on public.bid_holds from anon, authenticated;
grant select (id, auction_id, user_id, amount, status, created_at) on public.bid_holds to authenticated;

-- Sellers may only write descriptive columns; money/state columns are server-owned.
revoke all on public.auctions from anon, authenticated;
grant select on public.auctions to anon, authenticated;
grant insert (seller_id, title, make, model, year, vin, mileage_km, engine, transmission, drivetrain,
              exterior_color, location_city, location_country, condition_type, damage_history_summary,
              before_photos_urls, gallery_urls, video_url, starting_bid)
  on public.auctions to authenticated;
grant update (title, engine, transmission, drivetrain, exterior_color, damage_history_summary,
              before_photos_urls, gallery_urls, video_url)
  on public.auctions to authenticated;

grant select on public.comments to anon, authenticated;
grant insert (auction_id, parent_id, content) on public.comments to authenticated;

-- =============================================================================
-- Row Level Security
-- =============================================================================
alter table public.profiles        enable row level security;
alter table public.auctions        enable row level security;
alter table public.auction_private enable row level security;
alter table public.bid_holds       enable row level security;
alter table public.bids            enable row level security;
alter table public.comments        enable row level security;

-- profiles
create policy "profiles are public" on public.profiles for select using (true);
create policy "users update own profile" on public.profiles for update
  using (id = auth.uid()) with check (id = auth.uid());

-- auctions
create policy "public auctions are visible" on public.auctions for select
  using (status <> 'draft' or seller_id = auth.uid() or public.is_admin());
create policy "sellers submit drafts" on public.auctions for insert
  with check (seller_id = auth.uid() and status = 'draft');
create policy "sellers edit own drafts" on public.auctions for update
  using (seller_id = auth.uid() and status = 'draft')
  with check (seller_id = auth.uid() and status = 'draft');
create policy "admins manage auctions" on public.auctions for all
  using (public.is_admin()) with check (public.is_admin());

-- auction_private: admins only (sellers set their reserve via the admin flow)
create policy "admins manage private auction data" on public.auction_private for all
  using (public.is_admin()) with check (public.is_admin());

-- bid_holds: users see their own; writes only via service role (Stripe routes)
create policy "users read own holds" on public.bid_holds for select using (user_id = auth.uid());

-- bids: readable by all, no direct writes
create policy "bids are public" on public.bids for select using (
  exists (select 1 from public.auctions a where a.id = auction_id and a.status <> 'draft')
);

-- comments
create policy "comments are public" on public.comments for select using (true);
create policy "signed-in users comment" on public.comments for insert to authenticated
  with check (
    exists (select 1 from public.auctions a
            where a.id = auction_id and a.status in ('upcoming', 'live', 'ended', 'sold', 'reserve_not_met'))
  );
create policy "admins delete comments" on public.comments for delete using (public.is_admin());

-- =============================================================================
-- RPC: server clock (clients compute an offset; timers are display-only)
-- =============================================================================
create or replace function public.server_time()
returns timestamptz language sql stable as $$ select now() $$;
grant execute on function public.server_time() to anon, authenticated;

-- =============================================================================
-- Buyer's premium: 5%, min €350, max €3,500
-- =============================================================================
create or replace function public.buyers_premium(p_amount integer)
returns integer language sql immutable as $$
  select least(3500, greatest(350, round(p_amount * 0.05)::integer));
$$;
grant execute on function public.buyers_premium(integer) to anon, authenticated;

-- =============================================================================
-- RPC: place_bid
-- Atomic: the auction row is locked FOR UPDATE, so concurrent bids serialize.
-- Error messages are stable codes the client maps to copy.
-- =============================================================================
create or replace function public.place_bid(p_auction_id uuid, p_amount integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_profile   public.profiles%rowtype;
  v_auction   public.auctions%rowtype;
  v_hold      public.bid_holds%rowtype;
  v_min_next  integer;
  v_reserve   integer;
  v_extended  boolean := false;
  v_bid_id    uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount > 10000000 then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001';
  end if;

  select * into v_profile from public.profiles where id = v_uid;
  if not found or not v_profile.is_verified_bidder then
    raise exception 'NOT_VERIFIED' using errcode = 'P0001';
  end if;

  -- Lock the auction row. Every other bid on this auction waits here.
  select * into v_auction from public.auctions where id = p_auction_id for update;
  if not found then
    raise exception 'AUCTION_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_auction.status <> 'live' or now() < v_auction.starts_at then
    raise exception 'AUCTION_NOT_LIVE' using errcode = 'P0001';
  end if;

  if now() >= v_auction.ends_at then
    raise exception 'AUCTION_ENDED' using errcode = 'P0001';
  end if;

  if v_auction.seller_id = v_uid then
    raise exception 'OWN_AUCTION' using errcode = 'P0001';
  end if;

  if v_auction.leading_bidder_id = v_uid then
    raise exception 'ALREADY_LEADING' using errcode = 'P0001';
  end if;

  select * into v_hold from public.bid_holds
   where auction_id = p_auction_id and user_id = v_uid and status = 'authorized'
   limit 1;
  if not found then
    raise exception 'HOLD_REQUIRED' using errcode = 'P0001';
  end if;

  v_min_next := case
    when v_auction.current_bid is null then v_auction.starting_bid
    else v_auction.current_bid + v_auction.min_bid_increment
  end;

  if p_amount < v_min_next then
    raise exception 'BID_TOO_LOW' using errcode = 'P0001', detail = v_min_next::text;
  end if;

  -- Anti-sniping: a bid in the final 2 minutes extends the end by 2 minutes.
  if v_auction.ends_at - now() <= interval '2 minutes' then
    v_auction.ends_at := v_auction.ends_at + interval '2 minutes';
    v_extended := true;
  end if;

  select reserve_price into v_reserve from public.auction_private where auction_id = p_auction_id;

  insert into public.bids (auction_id, bidder_id, amount, stripe_payment_intent_id)
  values (p_auction_id, v_uid, p_amount, v_hold.stripe_payment_intent_id)
  returning id into v_bid_id;

  -- This UPDATE is what Realtime broadcasts to every connected client.
  update public.auctions
     set current_bid       = p_amount,
         leading_bidder_id = v_uid,
         bid_count         = bid_count + 1,
         ends_at           = v_auction.ends_at,
         reserve_met       = (v_reserve is null or p_amount >= v_reserve)
   where id = p_auction_id;

  return jsonb_build_object(
    'bid_id',      v_bid_id,
    'current_bid', p_amount,
    'bid_count',   v_auction.bid_count + 1,
    'ends_at',     v_auction.ends_at,
    'extended',    v_extended,
    'min_next',    p_amount + v_auction.min_bid_increment
  );
end $$;

revoke all on function public.place_bid(uuid, integer) from public;
grant execute on function public.place_bid(uuid, integer) to authenticated;

-- =============================================================================
-- RPC: public bid history (usernames, never payment data)
-- =============================================================================
create or replace function public.get_bid_history(p_auction_id uuid, p_limit integer default 50)
returns table (id uuid, amount integer, created_at timestamptz, bidder_id uuid, username text, country public.baltic_country)
language sql stable security definer set search_path = public as $$
  select b.id, b.amount, b.created_at, b.bidder_id, p.username, p.country
    from public.bids b
    join public.auctions a on a.id = b.auction_id and a.status <> 'draft'
    join public.profiles p on p.id = b.bidder_id
   where b.auction_id = p_auction_id
   order by b.created_at desc
   limit least(coalesce(p_limit, 50), 200);
$$;
grant execute on function public.get_bid_history(uuid, integer) to anon, authenticated;

-- =============================================================================
-- Scheduled state transitions (runs every minute via pg_cron).
-- place_bid already refuses bids after ends_at, so a late cron run is safe.
-- =============================================================================
create or replace function public.advance_auction_states()
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.auctions
     set status = 'live'
   where status = 'upcoming' and starts_at <= now();

  -- Lock each due row so a bid in flight finishes (and maybe extends) first.
  update public.auctions a
     set status = case
                    when a.bid_count = 0 then 'ended'::public.auction_status
                    when a.reserve_met   then 'sold'::public.auction_status
                    else 'reserve_not_met'::public.auction_status
                  end
    from (select id from public.auctions
           where status = 'live' and ends_at <= now()
           for update skip locked) due
   where a.id = due.id
     and a.ends_at <= now();
end $$;

select cron.schedule('advance-auction-states', '* * * * *', $$select public.advance_auction_states()$$);

-- =============================================================================
-- Realtime
-- auctions: bid/timer/status updates. comments: live Q&A.
-- bids is intentionally NOT published; clients refetch get_bid_history.
-- =============================================================================
alter publication supabase_realtime add table public.auctions;
alter publication supabase_realtime add table public.comments;
