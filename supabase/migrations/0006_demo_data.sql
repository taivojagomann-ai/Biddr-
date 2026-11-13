-- =============================================================================
-- Demo data (admin "Demo data" panel, only when ENABLE_DEMO_DATA=true)
-- Idempotent: safe to run more than once. Drops no tables, columns or data.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Flags. Demo rows are created and removed only by the app's service role.
-- Browser clients can't set them: is_demo is not in any insert or update grant.
-- -----------------------------------------------------------------------------
alter table public.auctions add column if not exists is_demo boolean not null default false;
alter table public.profiles add column if not exists is_demo boolean not null default false;

create index if not exists auctions_is_demo_idx on public.auctions (is_demo) where is_demo;
create index if not exists profiles_is_demo_idx on public.profiles (is_demo) where is_demo;

-- -----------------------------------------------------------------------------
-- comments_set_flags: browser users are still forced to be the author and to
-- post "now". Server-side inserts with the service role (auth.uid() is null) may
-- set user_id and created_at, so demo comments can have an author and an age.
-- Browser users can't choose user_id or created_at either way: neither is in
-- their insert column grant.
-- -----------------------------------------------------------------------------
create or replace function public.comments_set_flags()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null then
    new.user_id := auth.uid();
    new.created_at := now();
  end if;
  if new.user_id is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  new.created_at := coalesce(new.created_at, now());

  -- A seller reply is a comment by the car's seller or by an admin.
  new.is_seller_reply := exists (
    select 1 from public.auctions a where a.id = new.auction_id and a.seller_id = new.user_id
  ) or exists (
    select 1 from public.profiles p where p.id = new.user_id and p.role = 'admin'
  );

  if new.parent_id is not null and not exists (
    select 1 from public.comments c where c.id = new.parent_id and c.auction_id = new.auction_id
  ) then
    raise exception 'INVALID_PARENT' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- Make the comments insert grant match what 0001 intended. Supabase grants every
-- new table full INSERT to authenticated by default and 0001 never revoked it for
-- comments, so until now only the trigger above stopped a browser user from
-- choosing user_id. Revoking table-level INSERT also clears column grants, so the
-- three allowed columns are granted again right after.
revoke insert on public.comments from anon, authenticated;
grant insert (auction_id, parent_id, content) on public.comments to authenticated;

-- -----------------------------------------------------------------------------
-- place_bid: same as 0001, plus demo listings refuse every bid (DEMO_AUCTION).
-- create or replace keeps the existing grants (execute for authenticated only).
-- -----------------------------------------------------------------------------
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

  -- Demo listings (0006) never take real bids.
  if v_auction.is_demo then
    raise exception 'DEMO_AUCTION' using errcode = 'P0001';
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

revoke all on function public.place_bid(uuid, integer) from public, anon;
grant execute on function public.place_bid(uuid, integer) to authenticated;
