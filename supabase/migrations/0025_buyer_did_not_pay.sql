-- =============================================================================
-- 0025: When the winner doesn't pay the buyer's premium (DECISIONS.md point 12).
--
-- - buyer_payments: status 'unpaid' ("Buyer didn't pay": 72 hours passed), a
--   reminder 24 hours before the deadline, and sale_completed_at (the seller
--   confirms the car was paid and handed over). An auction can now have more than
--   one payment row, but only one active one: the first winner's 'unpaid' row
--   stays, and a second-chance buyer gets a new row.
-- - profiles.bidding_blocked_at / bidding_block_reason: a winner who didn't pay
--   can't bid (no new card holds, no new bids). Only admins lift it. Members can't
--   read or change these columns (no column grant); bidder_status() tells the
--   member themselves.
-- - second_chance_offers: the seller offers the car to the next bidder at that
--   bidder's last bid; 48 hours to accept and pay.
-- - auctions.relisted_from: a new draft listing made from an unpaid sale.
--
-- Idempotent: safe to run more than once. No tables, columns or data are dropped.
-- One constraint is replaced: buyer_payments.auction_id was unique; it becomes
-- "one active payment per auction" (a partial unique index). place_bid is not touched.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- buyer_payments
-- -----------------------------------------------------------------------------
alter table public.buyer_payments add column if not exists reminder_sent_at timestamptz;
alter table public.buyer_payments add column if not exists unpaid_at timestamptz;
alter table public.buyer_payments add column if not exists sale_completed_at timestamptz;
alter table public.buyer_payments add column if not exists second_chance_offer_id uuid;

do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.buyer_payments'::regclass and conname = 'buyer_payments_status_check';
  if v_def is null or position('''unpaid''' in v_def) = 0 then
    alter table public.buyer_payments drop constraint if exists buyer_payments_status_check;
    alter table public.buyer_payments add constraint buyer_payments_status_check
      check (status in ('pending', 'paid', 'action_required', 'failed', 'refunded', 'cancelled', 'unpaid'));
  end if;
end $$;

-- One active payment per auction (was: one payment per auction).
alter table public.buyer_payments drop constraint if exists buyer_payments_auction_id_key;
create unique index if not exists buyer_payments_one_active
  on public.buyer_payments (auction_id) where status not in ('unpaid', 'cancelled');
create index if not exists buyer_payments_auction_idx on public.buyer_payments (auction_id, created_at desc);
create index if not exists buyer_payments_due_idx on public.buyer_payments (due_at) where status in ('action_required', 'failed');

-- The sold-auction trigger: "on conflict (auction_id)" needed the old constraint.
create or replace function public.buyer_payment_on_sold()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_hold text;
begin
  if new.is_demo or new.status::text <> 'sold' or old.status::text = 'sold'
     or new.leading_bidder_id is null or coalesce(new.current_bid, 0) <= 0 then
    return null;
  end if;
  if exists (select 1 from public.buyer_payments where auction_id = new.id) then
    return null;
  end if;
  select stripe_payment_intent_id into v_hold
    from public.bid_holds
   where auction_id = new.id and user_id = new.leading_bidder_id and status::text in ('authorized', 'captured')
   order by created_at desc limit 1;
  insert into public.buyer_payments (auction_id, winner_id, seller_id, winning_bid, premium_amount, hold_payment_intent_id)
  values (new.id, new.leading_bidder_id, new.seller_id, new.current_bid, public.buyers_premium(new.current_bid), v_hold);
  perform public.call_app_job('/api/stripe/settle');
  return null;
end $$;

-- -----------------------------------------------------------------------------
-- Second-chance offers
-- -----------------------------------------------------------------------------
create table if not exists public.second_chance_offers (
  id                  uuid primary key default gen_random_uuid(),
  auction_id          uuid not null references public.auctions (id) on delete cascade,
  original_payment_id uuid not null references public.buyer_payments (id) on delete cascade,
  bidder_id           uuid not null references public.profiles (id),
  seller_id           uuid not null references public.profiles (id),
  amount              integer not null check (amount > 0),        -- euros: the bidder's last bid
  premium_amount      integer not null check (premium_amount > 0),
  status              text not null default 'pending'
                      check (status in ('pending', 'accepted', 'declined', 'expired', 'paid')),
  expires_at          timestamptz not null,
  responded_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists second_chance_one_open
  on public.second_chance_offers (auction_id) where status in ('pending', 'accepted');
create unique index if not exists second_chance_once_per_bidder
  on public.second_chance_offers (auction_id, bidder_id);
create index if not exists second_chance_bidder_idx on public.second_chance_offers (bidder_id, status);
create index if not exists second_chance_expiry_idx on public.second_chance_offers (expires_at) where status = 'pending';

drop trigger if exists second_chance_offers_touch on public.second_chance_offers;
create trigger second_chance_offers_touch before update on public.second_chance_offers
  for each row execute function public.touch_updated_at();

alter table public.second_chance_offers enable row level security;
revoke all on public.second_chance_offers from anon, authenticated;
grant select on public.second_chance_offers to authenticated;
grant all on public.second_chance_offers to service_role;

drop policy if exists "bidder and seller read their offer" on public.second_chance_offers;
create policy "bidder and seller read their offer" on public.second_chance_offers
  for select to authenticated using (bidder_id = auth.uid() or seller_id = auth.uid());

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.buyer_payments'::regclass
                  and conname = 'buyer_payments_second_chance_fkey') then
    alter table public.buyer_payments add constraint buyer_payments_second_chance_fkey
      foreign key (second_chance_offer_id) references public.second_chance_offers (id) on delete set null;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Relisting: a new draft made from a sale the buyer didn't pay for (one per sale).
-- -----------------------------------------------------------------------------
alter table public.auctions add column if not exists relisted_from uuid references public.auctions (id) on delete set null;
create unique index if not exists auctions_relisted_from_uidx on public.auctions (relisted_from) where relisted_from is not null;

-- -----------------------------------------------------------------------------
-- Blocked bidders
-- -----------------------------------------------------------------------------
alter table public.profiles add column if not exists bidding_blocked_at timestamptz;
alter table public.profiles add column if not exists bidding_block_reason text;
create index if not exists profiles_blocked_idx on public.profiles (bidding_blocked_at) where bidding_blocked_at is not null;

create or replace function public.bidder_blocked(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select bidding_blocked_at is not null from public.profiles where id = p_user), false);
$$;
revoke all on function public.bidder_blocked(uuid) from public, anon, authenticated;
grant execute on function public.bidder_blocked(uuid) to service_role;

-- What the signed-in user still needs before bidding; now also whether they're blocked.
create or replace function public.bidder_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_reason text;
  v_blocked timestamptz;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  select bidding_blocked_at, bidding_block_reason into v_blocked, v_reason from public.profiles where id = v_uid;
  return jsonb_build_object(
    'profile_complete', public.bidder_profile_complete(v_uid),
    'terms_accepted',   public.bidder_terms_accepted(v_uid),
    'current_version',  public.current_bidding_terms_version(),
    'blocked',          v_blocked is not null,
    'blocked_reason',   case when v_blocked is not null then v_reason end
  );
end $$;
revoke all on function public.bidder_status() from public, anon;
grant execute on function public.bidder_status() to authenticated;

-- Bids: also refused for a blocked bidder (the bids trigger, not place_bid).
create or replace function public.bids_require_bidder()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if not public.bidder_profile_complete(new.bidder_id) then
    raise exception 'PROFILE_INCOMPLETE' using errcode = 'P0001';
  end if;
  if not public.bidder_terms_accepted(new.bidder_id) then
    raise exception 'TERMS_NOT_ACCEPTED' using errcode = 'P0001';
  end if;
  if public.bidder_blocked(new.bidder_id) then
    raise exception 'BIDDING_BLOCKED' using errcode = 'P0001';
  end if;
  return new;
end $$;

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
      'second_chance_offer', 'second_chance_closed', 'bidding_unblocked']) as t(v)
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
      'second_chance_offer', 'second_chance_closed', 'bidding_unblocked'
    ));
  end if;
end $$;
