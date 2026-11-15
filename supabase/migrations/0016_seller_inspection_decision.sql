-- =============================================================================
-- After an admin rejects a dealer inspection report, the seller decides what
-- happens next: upload a new report, or list without an inspection (or withdraw
-- the listing). They have 30 days; a daily job reminds them 7 days before the
-- deadline and withdraws the listing once it has passed.
-- Idempotent: safe to run more than once. No tables, columns or data are dropped.
-- place_bid is not touched.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- auction_private (admin-only table): the pending decision and the outcome.
-- -----------------------------------------------------------------------------
alter table public.auction_private
  add column if not exists seller_decision_required boolean not null default false,
  add column if not exists seller_decision_deadline timestamptz,
  add column if not exists seller_decision          text,
  add column if not exists seller_decision_at       timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.auction_private'::regclass
                  and conname = 'seller_decision_check') then
    alter table public.auction_private add constraint seller_decision_check
      check (seller_decision is null or seller_decision in ('new_report', 'without_inspection'));
  end if;
end $$;

-- The daily job looks these up.
create index if not exists auction_private_decision_due_idx
  on public.auction_private (seller_decision_deadline)
  where seller_decision_required;

-- -----------------------------------------------------------------------------
-- Notifications: the seller's choice (to admins), the reminder and the
-- automatic withdrawal (to the seller).
-- -----------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'question', 'answer', 'outbid', 'listing_approved', 'listing_rejected',
  'auction_live', 'auction_ended', 'auction_won', 'listing_submitted',
  'watch_ending_soon', 'watch_live', 'inspection_rejected',
  'withdrawal_approved', 'withdrawal_declined',
  'seller_decided', 'inspection_decision_reminder', 'inspection_decision_expired'
));

-- -----------------------------------------------------------------------------
-- seller_inspection_decision: the seller chooses after a rejected report.
-- Only 'without_inspection' is decided here; 'new_report' needs the new files,
-- so the server saves it together with the upload.
-- Errors: NOT_AUTHENTICATED, AUCTION_NOT_FOUND, NOT_OWNER, NOT_DRAFT,
-- NO_DECISION_NEEDED, NEW_REPORT_NEEDS_UPLOAD, INVALID_DECISION.
-- -----------------------------------------------------------------------------
create or replace function public.seller_inspection_decision(p_auction_id uuid, p_decision text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid      uuid := auth.uid();
  v_seller   uuid;
  v_status   text;
  v_required boolean;
  v_admin    uuid;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;
  if p_decision = 'new_report' then
    raise exception 'NEW_REPORT_NEEDS_UPLOAD';
  end if;
  if p_decision is distinct from 'without_inspection' then
    raise exception 'INVALID_DECISION';
  end if;

  select seller_id, status::text into v_seller, v_status
    from public.auctions where id = p_auction_id
    for update;
  if not found then
    raise exception 'AUCTION_NOT_FOUND';
  end if;
  if v_seller <> v_uid then
    raise exception 'NOT_OWNER';
  end if;
  if v_status <> 'draft' then
    raise exception 'NOT_DRAFT';
  end if;

  select seller_decision_required into v_required
    from public.auction_private where auction_id = p_auction_id
    for update;
  if not coalesce(v_required, false) then
    raise exception 'NO_DECISION_NEEDED';
  end if;

  update public.auction_private
     set seller_decision = 'without_inspection',
         seller_decision_at = now(),
         seller_decision_required = false
   where auction_id = p_auction_id;

  -- Tell every admin (except the seller, if an admin sells).
  for v_admin in select id from public.profiles where role = 'admin' loop
    perform public.notify(v_admin, 'seller_decided', p_auction_id, null, v_uid,
                          jsonb_build_object('decision', 'without_inspection'));
  end loop;
end $$;

revoke all on function public.seller_inspection_decision(uuid, text) from public, anon, authenticated;
grant execute on function public.seller_inspection_decision(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Daily job: remind the seller 7 days before the deadline (once), and withdraw
-- the listing once the deadline has passed. Drafts only. Returns what it did.
-- -----------------------------------------------------------------------------
create or replace function public.inspection_decision_job()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_row       record;
  v_reminded  int := 0;
  v_withdrawn int := 0;
begin
  -- Reminders: deadline within 7 days, not passed, and not reminded yet.
  for v_row in
    select p.auction_id, a.seller_id, p.seller_decision_deadline
      from public.auction_private p
      join public.auctions a on a.id = p.auction_id
     where p.seller_decision_required
       and a.status::text = 'draft'
       and p.seller_decision_deadline > now()
       and p.seller_decision_deadline <= now() + interval '7 days'
       and not exists (
         select 1 from public.notifications n
          where n.user_id = a.seller_id and n.auction_id = p.auction_id
            and n.type = 'inspection_decision_reminder'
            and n.created_at >= p.seller_decision_deadline - interval '30 days')
  loop
    perform public.notify(v_row.seller_id, 'inspection_decision_reminder', v_row.auction_id, null, null,
                          jsonb_build_object('deadline', v_row.seller_decision_deadline));
    v_reminded := v_reminded + 1;
  end loop;

  -- Deadline passed: withdraw. A draft was never public, so it stays private.
  for v_row in
    select p.auction_id, a.seller_id
      from public.auction_private p
      join public.auctions a on a.id = p.auction_id
     where p.seller_decision_required
       and a.status::text = 'draft'
       and p.seller_decision_deadline <= now()
       for update of a, p
  loop
    update public.auctions
       set status = 'withdrawn', withdrawn_before_review = true
     where id = v_row.auction_id and status::text = 'draft';
    update public.auction_private
       set seller_decision_required = false,
           withdraw_reason = 'No response after the inspection report was rejected'
     where auction_id = v_row.auction_id;
    perform public.notify(v_row.seller_id, 'inspection_decision_expired', v_row.auction_id, null, null);
    v_withdrawn := v_withdrawn + 1;
  end loop;

  return jsonb_build_object('reminded', v_reminded, 'withdrawn', v_withdrawn);
end $$;

revoke all on function public.inspection_decision_job() from public, anon, authenticated;

-- Daily at 06:41 UTC (a job with this name is replaced, not duplicated).
select cron.schedule('inspection-decision-deadlines', '41 6 * * *', $$select public.inspection_decision_job()$$);
