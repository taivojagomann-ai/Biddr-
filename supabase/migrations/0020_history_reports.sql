-- =============================================================================
-- Biddr: vehicle history reports from carVertical.
-- Sellers can optionally add their own carVertical report (files in the private
-- inspection-uploads bucket and/or a carVertical share link). An admin checks it
-- during listing review with a checklist; once accepted, the listing shows a
-- "History report" badge and a short summary written by the admin. The report
-- link is public only if the seller allowed sharing.
--
-- Idempotent: safe to run more than once. No tables, columns or data are
-- dropped. place_bid is not touched.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- auction_private (admin-only): what the seller provided and the admin's review.
-- -----------------------------------------------------------------------------
alter table public.auction_private
  add column if not exists history_report_provided      boolean,
  add column if not exists history_report_paths         jsonb not null default '[]'::jsonb,
  add column if not exists history_report_link          text,
  add column if not exists history_report_share_allowed boolean not null default false,
  add column if not exists history_review_status        text,
  add column if not exists history_review_note          text,
  add column if not exists history_reviewed_by          uuid references auth.users (id) on delete set null,
  add column if not exists history_reviewed_at          timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.auction_private'::regclass
                  and conname = 'history_review_status_check') then
    alter table public.auction_private add constraint history_review_status_check
      check (history_review_status is null or history_review_status in ('pending', 'accepted', 'rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.auction_private'::regclass
                  and conname = 'history_report_paths_array_check') then
    alter table public.auction_private add constraint history_report_paths_array_check
      check (jsonb_typeof(history_report_paths) = 'array' and jsonb_array_length(history_report_paths) <= 10);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.auction_private'::regclass
                  and conname = 'history_report_link_check') then
    alter table public.auction_private add constraint history_report_link_check
      check (history_report_link is null
             or history_report_link ~* '^https://([a-z0-9-]+\.)*carvertical\.com(/[^\s]*)?$');
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- auctions (public): what buyers see. Only admins set these (through the
-- server); the sellers' column grants don't include them.
-- -----------------------------------------------------------------------------
alter table public.auctions
  add column if not exists history_report_verified    boolean not null default false,
  add column if not exists history_report_public_link text,
  add column if not exists history_summary            jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.auctions'::regclass
                  and conname = 'auctions_history_summary_check') then
    alter table public.auctions add constraint auctions_history_summary_check
      check (jsonb_typeof(history_summary) = 'array' and jsonb_array_length(history_summary) <= 8);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.auctions'::regclass
                  and conname = 'auctions_history_public_link_check') then
    alter table public.auctions add constraint auctions_history_public_link_check
      check (history_report_public_link is null
             or history_report_public_link ~* '^https://([a-z0-9-]+\.)*carvertical\.com(/[^\s]*)?$');
  end if;
end $$;

-- Each summary line is at most 200 characters (a check constraint can't use a
-- subquery, so a small immutable helper does the work).
create or replace function public.history_summary_valid(p jsonb)
returns boolean language sql immutable as $$
  select coalesce(bool_and(jsonb_typeof(e) = 'string' and char_length(e #>> '{}') between 1 and 200), true)
    from jsonb_array_elements(p) as e;
$$;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.auctions'::regclass
                  and conname = 'auctions_history_summary_lines_check') then
    alter table public.auctions add constraint auctions_history_summary_lines_check
      check (public.history_summary_valid(history_summary));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Notifications: tell the seller when their history report wasn't accepted.
-- Replaced only when the current check is missing or doesn't allow every type
-- below, so re-running this file never narrows a list a later migration widened.
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
      'history_report_rejected']) as t(v)
     where position(quote_literal(t.v) in v_def) = 0
  ) then
    alter table public.notifications drop constraint if exists notifications_type_check;
    alter table public.notifications add constraint notifications_type_check check (type in (
      'question', 'answer', 'outbid', 'listing_approved', 'listing_rejected',
      'auction_live', 'auction_ended', 'auction_won', 'listing_submitted',
      'watch_ending_soon', 'watch_live', 'inspection_rejected',
      'withdrawal_approved', 'withdrawal_declined',
      'seller_decided', 'inspection_decision_reminder', 'inspection_decision_expired',
      'history_report_rejected'
    ));
  end if;
end $$;
