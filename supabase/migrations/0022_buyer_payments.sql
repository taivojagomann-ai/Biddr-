-- =============================================================================
-- Biddr: the winner pays the buyer's premium (5% of the winning bid, at least
-- €350, at most €3,500: buyers_premium()). The car itself is paid directly to the
-- seller, outside Biddr.
--
-- buyer_payments: one row per sold auction, created when the auction becomes
-- 'sold'. The server's settlement job (/api/stripe/settle, called right away and
-- every 5 minutes by pg_cron through call_app_job) captures up to €500 from the
-- winner's card hold and charges any remainder to the saved card.
-- Winner and seller can read their own row; nobody writes from the browser.
--
-- Idempotent: safe to run more than once. Nothing is dropped. place_bid is not touched.
-- =============================================================================

create table if not exists public.buyer_payments (
  id                          uuid primary key default gen_random_uuid(),
  auction_id                  uuid not null unique references public.auctions (id) on delete cascade,
  winner_id                   uuid not null references public.profiles (id),
  seller_id                   uuid not null references public.profiles (id),
  winning_bid                 integer not null check (winning_bid > 0),
  premium_amount              integer not null check (premium_amount > 0),
  hold_payment_intent_id      text,
  captured_from_hold          integer,               -- euros; null until the hold was tried
  remainder_payment_intent_id text,
  status                      text not null default 'pending',
  due_at                      timestamptz,
  paid_at                     timestamptz,
  failure_reason              text,
  receipt_url                 text,
  attempts                    integer not null default 0,
  last_attempt_at             timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.buyer_payments'::regclass
                  and conname = 'buyer_payments_status_check') then
    alter table public.buyer_payments add constraint buyer_payments_status_check
      check (status in ('pending', 'paid', 'action_required', 'failed', 'refunded', 'cancelled'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.buyer_payments'::regclass
                  and conname = 'buyer_payments_captured_check') then
    alter table public.buyer_payments add constraint buyer_payments_captured_check
      check (captured_from_hold is null or (captured_from_hold >= 0 and captured_from_hold <= premium_amount));
  end if;
end $$;

create index if not exists buyer_payments_status_idx on public.buyer_payments (status, created_at);
create index if not exists buyer_payments_winner_idx on public.buyer_payments (winner_id);
create index if not exists buyer_payments_seller_idx on public.buyer_payments (seller_id);

drop trigger if exists buyer_payments_touch on public.buyer_payments;
create trigger buyer_payments_touch before update on public.buyer_payments
  for each row execute function public.touch_updated_at();

alter table public.buyer_payments enable row level security;
revoke all on public.buyer_payments from anon, authenticated;
grant select on public.buyer_payments to authenticated;
grant all on public.buyer_payments to service_role;

drop policy if exists "winner and seller read their payment" on public.buyer_payments;
create policy "winner and seller read their payment" on public.buyer_payments
  for select to authenticated using (winner_id = auth.uid() or seller_id = auth.uid());

-- -----------------------------------------------------------------------------
-- A sold auction gets its payment row (not demo listings: no real card is ever
-- asked for). Then the settlement job is called straight away; pg_cron retries it.
-- -----------------------------------------------------------------------------
create or replace function public.buyer_payment_on_sold()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_hold text;
begin
  if new.is_demo or new.status::text <> 'sold' or old.status::text = 'sold'
     or new.leading_bidder_id is null or coalesce(new.current_bid, 0) <= 0 then
    return null;
  end if;
  select stripe_payment_intent_id into v_hold
    from public.bid_holds
   where auction_id = new.id and user_id = new.leading_bidder_id and status::text in ('authorized', 'captured')
   order by created_at desc limit 1;
  insert into public.buyer_payments (auction_id, winner_id, seller_id, winning_bid, premium_amount, hold_payment_intent_id)
  values (new.id, new.leading_bidder_id, new.seller_id, new.current_bid, public.buyers_premium(new.current_bid), v_hold)
  on conflict (auction_id) do nothing;
  perform public.call_app_job('/api/stripe/settle');
  return null;
end $$;

drop trigger if exists buyer_payment_on_sold on public.auctions;
create trigger buyer_payment_on_sold
  after update of status on public.auctions
  for each row execute function public.buyer_payment_on_sold();

-- Retry pending settlements every 5 minutes (a job with this name is replaced, not duplicated).
select cron.schedule('settle-buyer-payments', '2-59/5 * * * *', $$select public.call_app_job('/api/stripe/settle')$$);

-- -----------------------------------------------------------------------------
-- Notifications: premium due (winner), premium paid (winner and seller),
-- premium charge failed (admins). Widen-only, as in earlier migrations.
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
      'history_report_rejected', 'premium_due', 'premium_paid', 'premium_failed']) as t(v)
     where position(quote_literal(t.v) in v_def) = 0
  ) then
    alter table public.notifications drop constraint if exists notifications_type_check;
    alter table public.notifications add constraint notifications_type_check check (type in (
      'question', 'answer', 'outbid', 'listing_approved', 'listing_rejected',
      'auction_live', 'auction_ended', 'auction_won', 'listing_submitted',
      'watch_ending_soon', 'watch_live', 'inspection_rejected',
      'withdrawal_approved', 'withdrawal_declined',
      'seller_decided', 'inspection_decision_reminder', 'inspection_decision_expired',
      'history_report_rejected', 'premium_due', 'premium_paid', 'premium_failed'
    ));
  end if;
end $$;
