-- =============================================================================
-- 0036: Sellers buy a premium seat (DECISIONS.md points 9 and 11).
--
-- - site_settings: admin-editable settings; here the premium seat's price (EUR, VAT
--   included, default 29) and how many paid seats may be active at once (default 5).
-- - premium_seat_purchases: one row per purchase attempt (one-time Stripe
--   PaymentIntent, automatic capture): pending → paid → maybe refunded. The invoice and
--   receipt use the purchase's id where the buyer's premium uses the payment's id.
-- - premium_seat_waitlist: sellers who asked to be told when a featured place frees up.
-- - Notifications: premium_seat_paid, premium_seat_refunded, premium_seat_available.
--
-- Everything is server-side (service role); members have no access. Idempotent: safe
-- to run more than once. Nothing is dropped.
-- =============================================================================

create table if not exists public.site_settings (
  key         text primary key,
  value       jsonb not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id)
);
alter table public.site_settings enable row level security;
revoke all on public.site_settings from anon, authenticated;
grant all on public.site_settings to service_role;

insert into public.site_settings (key, value) values
  ('premium_seat_price_eur', '29'::jsonb),
  ('premium_seat_limit', '5'::jsonb)
on conflict (key) do nothing;

create table if not exists public.premium_seat_purchases (
  id                 uuid primary key default gen_random_uuid(),
  auction_id         uuid not null references public.auctions (id) on delete cascade,
  seller_id          uuid not null references public.profiles (id),
  -- Cents, VAT included (the rate of the country the car is in, as for the buyer's premium).
  amount_cents       integer not null check (amount_cents > 0),
  status             text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'refunded', 'canceled')),
  payment_intent_id  text unique,
  paid_at            timestamptz,
  refunded_at        timestamptz,
  refund_id          text,
  refund_reason      text,
  refunded_by        uuid references public.profiles (id),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists premium_seat_purchases_auction_idx on public.premium_seat_purchases (auction_id, created_at desc);
create index if not exists premium_seat_purchases_status_idx on public.premium_seat_purchases (status, paid_at desc);
-- One paid seat per auction.
create unique index if not exists premium_seat_purchases_one_paid on public.premium_seat_purchases (auction_id) where status = 'paid';

drop trigger if exists premium_seat_purchases_touch on public.premium_seat_purchases;
create trigger premium_seat_purchases_touch before update on public.premium_seat_purchases
  for each row execute function public.touch_updated_at();

alter table public.premium_seat_purchases enable row level security;
revoke all on public.premium_seat_purchases from anon, authenticated;
grant all on public.premium_seat_purchases to service_role;

create table if not exists public.premium_seat_waitlist (
  auction_id   uuid primary key references public.auctions (id) on delete cascade,
  seller_id    uuid not null references public.profiles (id),
  created_at   timestamptz not null default now(),
  notified_at  timestamptz
);
alter table public.premium_seat_waitlist enable row level security;
revoke all on public.premium_seat_waitlist from anon, authenticated;
grant all on public.premium_seat_waitlist to service_role;

-- Notifications. Widen-only, as in earlier migrations.
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
      'viewing_update', 'conversation_reported', 'messaging_unblocked',
      'identity_required', 'identity_verified', 'listing_on_hold', 'listing_needs_check',
      'receipt_ready', 'listing_edited',
      'premium_seat_paid', 'premium_seat_refunded', 'premium_seat_available'];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.notifications'::regclass and conname = 'notifications_type_check';
  if v_def is null or exists (select 1 from unnest(v_types) as t(v) where position(quote_literal(t.v) in v_def) = 0) then
    alter table public.notifications drop constraint if exists notifications_type_check;
    execute format('alter table public.notifications add constraint notifications_type_check check (type in (%s))',
      (select string_agg(quote_literal(t), ', ') from unnest(v_types) t));
  end if;
end $$;
