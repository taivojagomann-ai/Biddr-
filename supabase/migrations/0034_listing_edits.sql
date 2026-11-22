-- =============================================================================
-- 0034: The seller corrects their listing while it's in review (DECISIONS.md point 17).
--
-- - listing_edits (admin-only): every change a seller saves, field by field, with the
--   value before and after, so admins see what changed after the checks or a review.
-- - "listing_edited" notification for admins, when an edit undoes the content approval.
--
-- Photos aren't edited by sellers (they are what the listing is checked against).
-- Every write goes through the server (service role). Idempotent: safe to run more
-- than once. Nothing is dropped.
-- =============================================================================

create table if not exists public.listing_edits (
  id          uuid primary key default gen_random_uuid(),
  auction_id  uuid not null references public.auctions (id) on delete cascade,
  seller_id   uuid not null references public.profiles (id),
  -- { "<field>": { "from": ..., "to": ... }, ... }
  changes     jsonb not null,
  -- What the edit did: the checks ran again, the content approval was undone.
  rechecked   boolean not null default false,
  approval_undone boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists listing_edits_auction_idx on public.listing_edits (auction_id, created_at desc);

alter table public.listing_edits enable row level security;
revoke all on public.listing_edits from anon, authenticated;
grant all on public.listing_edits to service_role;

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
      'receipt_ready', 'listing_edited'];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.notifications'::regclass and conname = 'notifications_type_check';
  if v_def is null or exists (select 1 from unnest(v_types) as t(v) where position(quote_literal(t.v) in v_def) = 0) then
    alter table public.notifications drop constraint if exists notifications_type_check;
    execute format('alter table public.notifications add constraint notifications_type_check check (type in (%s))',
      (select string_agg(quote_literal(t), ', ') from unnest(v_types) t));
  end if;
end $$;
