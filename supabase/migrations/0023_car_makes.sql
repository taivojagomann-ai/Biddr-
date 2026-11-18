-- 0023: Complete car make list.
-- The list itself lives in the app (lib/data/car-makes.ts). The database only records
-- whether a seller entered a make that isn't in it ("Other"), so admins see the
-- suggestion on the listing and get a notification. Existing listings keep their make
-- text and count as listed makes (make_other = false).
-- Idempotent: safe to run more than once. Nothing is dropped except the notification
-- type check, which is replaced by a wider one.

-- -----------------------------------------------------------------------------
-- auctions.make_other: set by the server when the listing is submitted (not in the
-- seller's column grant), changed by admins in the listing editor.
-- -----------------------------------------------------------------------------
alter table public.auctions add column if not exists make_other boolean not null default false;

comment on column public.auctions.make_other is
  'True when the seller chose "Other" because the make is not in lib/data/car-makes.ts.';

-- -----------------------------------------------------------------------------
-- Notifications: "New make suggested: <name>" for admins. Widen-only, as in earlier
-- migrations.
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
      'make_suggested']) as t(v)
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
      'make_suggested'
    ));
  end if;
end $$;
