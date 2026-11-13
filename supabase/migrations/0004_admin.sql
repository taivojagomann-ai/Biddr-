-- =============================================================================
-- Admin panel (/admin)
-- Idempotent: safe to run more than once in the SQL Editor. Drops no tables,
-- columns or data.
--
-- The SQL Editor runs this whole file in one transaction, and Postgres won't let
-- a transaction use an enum value it just added. Everything below that mentions
-- 'rejected' or 'withdrawn' therefore compares status::text, or sits inside a
-- plpgsql body (checked only when the function runs).
-- =============================================================================

alter type public.auction_status add value if not exists 'rejected';
alter type public.auction_status add value if not exists 'withdrawn';

-- -----------------------------------------------------------------------------
-- auction_private: why a listing was not accepted (shown to the seller)
-- -----------------------------------------------------------------------------
alter table public.auction_private add column if not exists rejection_reason text
  check (char_length(rejection_reason) <= 1000);

-- -----------------------------------------------------------------------------
-- Constraints: a rejected listing may lack a schedule and an inspection, like a draft.
-- -----------------------------------------------------------------------------
alter table public.auctions drop constraint if exists restored_needs_inspection;
alter table public.auctions add constraint restored_needs_inspection check (
  condition_type = 'clean'
  or status::text in ('draft', 'rejected')
  or (inspection_partner_name is not null and inspection_report_url is not null)
);

alter table public.auctions drop constraint if exists schedule_valid;
alter table public.auctions add constraint schedule_valid check (
  status::text in ('draft', 'rejected')
  or (starts_at is not null and ends_at is not null and ends_at > starts_at)
);

-- -----------------------------------------------------------------------------
-- Visibility: drafts and rejected listings only for the seller and admins.
-- -----------------------------------------------------------------------------
drop policy if exists "public auctions are visible" on public.auctions;
create policy "public auctions are visible" on public.auctions for select
  using (
    status::text not in ('draft', 'rejected')
    or seller_id = auth.uid()
    or public.is_admin()
  );

-- -----------------------------------------------------------------------------
-- Audit log of every admin write. Service role only.
-- -----------------------------------------------------------------------------
create table if not exists public.admin_actions (
  id          uuid primary key default gen_random_uuid(),
  admin_id    uuid references public.profiles (id),
  auction_id  uuid references public.auctions (id) on delete set null,
  action      text not null,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists admin_actions_auction_idx on public.admin_actions (auction_id, created_at desc);

alter table public.admin_actions enable row level security;
revoke all on public.admin_actions from anon, authenticated;
grant all on public.admin_actions to service_role;

-- -----------------------------------------------------------------------------
-- Storage: inspection-reports bucket (public read, PDFs only).
-- No browser policies: uploads use signed upload URLs created by an admin route.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inspection-reports', 'inspection-reports', true, 20971520, array['application/pdf'])
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- admin_set_reserve: set or remove the reserve, keep has_reserve / reserve_met in step.
-- Locks the auction row like place_bid, so a bid can't slip in between.
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_reserve(p_auction_id uuid, p_reserve integer)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.auctions%rowtype;
  v_current integer;
begin
  if p_reserve is not null and (p_reserve <= 0 or p_reserve > 10000000) then
    raise exception 'INVALID_RESERVE' using errcode = 'P0001';
  end if;

  select * into v_auction from public.auctions where id = p_auction_id for update;
  if not found then
    raise exception 'AUCTION_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_auction.status::text not in ('draft', 'upcoming', 'live') then
    raise exception 'AUCTION_CLOSED' using errcode = 'P0001';
  end if;

  -- While bidding is open the reserve may only go down or be removed.
  if v_auction.status = 'live' then
    select reserve_price into v_current from public.auction_private where auction_id = p_auction_id;
    if p_reserve is not null and (v_current is null or p_reserve > v_current) then
      raise exception 'RESERVE_RAISE_WHILE_LIVE' using errcode = 'P0001';
    end if;
  end if;

  insert into public.auction_private (auction_id, reserve_price)
  values (p_auction_id, p_reserve)
  on conflict (auction_id) do update set reserve_price = excluded.reserve_price;

  update public.auctions
     set has_reserve = p_reserve is not null,
         reserve_met = (p_reserve is null or coalesce(current_bid, 0) >= p_reserve)
   where id = p_auction_id;

  return jsonb_build_object('has_reserve', p_reserve is not null, 'reserve', p_reserve);
end $$;

revoke all on function public.admin_set_reserve(uuid, integer) from public, anon, authenticated;
grant execute on function public.admin_set_reserve(uuid, integer) to service_role;

-- -----------------------------------------------------------------------------
-- admin_set_schedule: set start and end. A live auction's start stays fixed and
-- its end may only move later.
-- -----------------------------------------------------------------------------
create or replace function public.admin_set_schedule(p_auction_id uuid, p_starts_at timestamptz, p_ends_at timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_auction public.auctions%rowtype;
begin
  if p_starts_at is null or p_ends_at is null then
    raise exception 'SCHEDULE_REQUIRED' using errcode = 'P0001';
  end if;
  if p_ends_at <= p_starts_at then
    raise exception 'END_BEFORE_START' using errcode = 'P0001';
  end if;
  if p_ends_at <= now() then
    raise exception 'END_IN_PAST' using errcode = 'P0001';
  end if;

  select * into v_auction from public.auctions where id = p_auction_id for update;
  if not found then
    raise exception 'AUCTION_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_auction.status = 'live' then
    if p_ends_at <= v_auction.ends_at then
      raise exception 'END_EARLIER_WHILE_LIVE' using errcode = 'P0001';
    end if;
    update public.auctions set ends_at = p_ends_at where id = p_auction_id;
    return jsonb_build_object('starts_at', v_auction.starts_at, 'ends_at', p_ends_at);
  end if;

  if v_auction.status::text not in ('draft', 'upcoming') then
    raise exception 'AUCTION_CLOSED' using errcode = 'P0001';
  end if;

  update public.auctions set starts_at = p_starts_at, ends_at = p_ends_at where id = p_auction_id;
  return jsonb_build_object('starts_at', p_starts_at, 'ends_at', p_ends_at);
end $$;

revoke all on function public.admin_set_schedule(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.admin_set_schedule(uuid, timestamptz, timestamptz) to service_role;

-- advance_auction_states() is unchanged: it only moves 'upcoming' and 'live'
-- rows, so 'rejected' and 'withdrawn' auctions are never touched.
