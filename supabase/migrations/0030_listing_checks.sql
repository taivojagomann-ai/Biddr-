-- =============================================================================
-- 0030: Automated fake-listing checks and seller identity (DECISIONS.md point 16).
--
-- - profiles: Stripe Identity status for sellers (one verification per member, reused
--   for later listings). Only the status, the verified name, the document's country,
--   when it was verified and the Stripe session id are kept; never document images or
--   numbers. is_verified_seller is public (the "Verified seller" text on the seller
--   card); everything else is hidden by the column grants.
-- - listing_verifications (one per listing, admin-only): the registration certificate
--   and owner authorisation files, the live challenge (a 6-character code valid for 15
--   minutes, and the two camera photos), the values read from them, the outcome
--   (green / yellow / red), hold and retry state, the admin's content approval and
--   override, and when the files were deleted.
-- - listing_checks (admin-only): one row per check per run: status pass / warn / fail,
--   the extracted values, confidence, reason.
-- - listing_check_costs (admin-only): an estimate per API call (model, tokens, images).
-- - Files are deleted 30 days after the auction ends (daily job, /api/listing-checks/purge).
--
-- Every write goes through the server (service role); members have no access to these
-- tables. Idempotent: safe to run more than once. Nothing is dropped.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Seller identity (Stripe Identity)
-- -----------------------------------------------------------------------------
alter table public.profiles add column if not exists identity_status text not null default 'none';
alter table public.profiles add column if not exists identity_verified_name text;
alter table public.profiles add column if not exists identity_document_country text;
alter table public.profiles add column if not exists identity_verified_at timestamptz;
alter table public.profiles add column if not exists identity_session_id text;
alter table public.profiles add column if not exists is_verified_seller boolean
  generated always as (identity_status = 'verified') stored;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.profiles'::regclass and conname = 'profiles_identity_status_check') then
    alter table public.profiles add constraint profiles_identity_status_check
      check (identity_status in ('none', 'pending', 'requires_input', 'verified', 'canceled'));
  end if;
end $$;

-- Public: only whether the seller is verified (the other identity columns stay hidden).
grant select (is_verified_seller) on public.profiles to anon, authenticated;

-- -----------------------------------------------------------------------------
-- One verification record per listing
-- -----------------------------------------------------------------------------
create table if not exists public.listing_verifications (
  auction_id            uuid primary key references public.auctions (id) on delete cascade,
  seller_id             uuid not null references public.profiles (id),
  -- Documents in the private inspection-uploads bucket (<seller id>/<auction id>/...).
  registration_paths    text[] not null default '{}',
  seller_is_owner       boolean not null default true,
  authorisation_paths   text[] not null default '{}',
  documents_uploaded_at timestamptz,
  -- The live challenge.
  challenge_code        text,
  challenge_issued_at   timestamptz,
  challenge_expires_at  timestamptz,
  challenge_issue_log   timestamptz[] not null default '{}',
  vin_photo_path        text,
  odometer_photo_path   text,
  photos_taken_at       timestamptz,
  -- What the automated checks found (extracted values only, never raw API responses).
  extracted             jsonb,
  outcome               text not null default 'pending',
  outcome_reasons       text[] not null default '{}',
  waiting_for_identity  boolean not null default false,
  checked_at            timestamptz,
  run_count             integer not null default 0,
  red_count             integer not null default 0,
  on_hold               boolean not null default false,
  needs_admin           boolean not null default false,
  -- The admin's decisions.
  content_approved_at   timestamptz,
  content_approved_by   uuid references public.profiles (id),
  override_at           timestamptz,
  override_by           uuid references public.profiles (id),
  override_reason       text,
  override_outcome      text,
  -- Retention.
  files_purged_at       timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.listing_verifications'::regclass and conname = 'listing_verifications_outcome_check') then
    alter table public.listing_verifications add constraint listing_verifications_outcome_check
      check (outcome in ('pending', 'green', 'yellow', 'red'));
  end if;
end $$;
create index if not exists listing_verifications_queue_idx on public.listing_verifications (needs_admin, outcome);
create index if not exists listing_verifications_seller_idx on public.listing_verifications (seller_id);

drop trigger if exists listing_verifications_touch on public.listing_verifications;
create trigger listing_verifications_touch before update on public.listing_verifications
  for each row execute function public.touch_updated_at();

alter table public.listing_verifications enable row level security;
revoke all on public.listing_verifications from anon, authenticated;
grant all on public.listing_verifications to service_role;

-- -----------------------------------------------------------------------------
-- Check results and cost estimates (admin-only)
-- -----------------------------------------------------------------------------
create table if not exists public.listing_checks (
  id          uuid primary key default gen_random_uuid(),
  auction_id  uuid not null references public.auctions (id) on delete cascade,
  run_id      uuid not null,
  check_name  text not null check (check_name in ('code', 'vin', 'mileage', 'owner', 'appearance', 'images')),
  status      text not null check (status in ('pass', 'warn', 'fail')),
  hard        boolean not null default false,
  extracted   jsonb not null default '{}'::jsonb,
  confidence  text check (confidence is null or confidence in ('high', 'medium', 'low')),
  reason      text,
  checked_at  timestamptz not null default now()
);
create index if not exists listing_checks_auction_idx on public.listing_checks (auction_id, checked_at desc);
alter table public.listing_checks enable row level security;
revoke all on public.listing_checks from anon, authenticated;
grant all on public.listing_checks to service_role;

create table if not exists public.listing_check_costs (
  id            uuid primary key default gen_random_uuid(),
  auction_id    uuid references public.auctions (id) on delete set null,
  provider      text not null check (provider in ('anthropic', 'google_vision')),
  model         text,
  purpose       text not null,
  input_tokens  integer not null default 0,
  output_tokens integer not null default 0,
  units         integer not null default 0,
  cost_usd      numeric(10, 5) not null default 0,
  created_at    timestamptz not null default now()
);
create index if not exists listing_check_costs_created_idx on public.listing_check_costs (created_at desc);
create index if not exists listing_check_costs_auction_idx on public.listing_check_costs (auction_id);
alter table public.listing_check_costs enable row level security;
revoke all on public.listing_check_costs from anon, authenticated;
grant all on public.listing_check_costs to service_role;

-- -----------------------------------------------------------------------------
-- Notifications. Widen-only, as in earlier migrations.
-- -----------------------------------------------------------------------------
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
      'identity_required', 'identity_verified', 'listing_on_hold', 'listing_needs_check'];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.notifications'::regclass and conname = 'notifications_type_check';
  if v_def is null or exists (select 1 from unnest(v_types) as t(v) where position(quote_literal(t.v) in v_def) = 0) then
    alter table public.notifications drop constraint if exists notifications_type_check;
    execute format('alter table public.notifications add constraint notifications_type_check check (type in (%s))',
      (select string_agg(quote_literal(t), ', ') from unnest(v_types) t));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Delete challenge photos and documents 30 days after the auction ends (the app
-- deletes the files; a job with this name is replaced, not duplicated).
-- -----------------------------------------------------------------------------
select cron.schedule('purge-listing-check-files', '41 4 * * *', $$select public.call_app_job('/api/listing-checks/purge')$$);
