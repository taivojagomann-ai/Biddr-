-- =============================================================================
-- Sellers withdraw their own listings.
-- - Waiting for review (draft) or Scheduled (upcoming): the seller withdraws directly.
-- - Live: the seller can only ask; an admin approves or declines the request.
-- Idempotent: safe to run more than once. No tables, columns or data are dropped.
-- place_bid is not touched.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- auction_private (admin-only table): the reason and the request state.
-- -----------------------------------------------------------------------------
alter table public.auction_private
  add column if not exists withdraw_reason          text,
  add column if not exists withdraw_requested_at    timestamptz,
  add column if not exists withdraw_request_status  text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.auction_private'::regclass
                  and conname = 'withdraw_request_status_check') then
    alter table public.auction_private add constraint withdraw_request_status_check
      check (withdraw_request_status is null or withdraw_request_status in ('pending', 'approved', 'declined'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.auction_private'::regclass
                  and conname = 'withdraw_reason_length_check') then
    alter table public.auction_private add constraint withdraw_reason_length_check
      check (withdraw_reason is null or char_length(withdraw_reason) <= 1000);
  end if;
end $$;

-- A draft has no start and end time yet. Let a withdrawn listing keep that
-- (before, only drafts and rejected listings could be unscheduled). This
-- replaces the rule, it doesn't remove it: every existing row still passes.
alter table public.auctions drop constraint if exists schedule_valid;
alter table public.auctions add constraint schedule_valid check (
  status::text in ('draft', 'rejected', 'withdrawn')
  or (starts_at is not null and ends_at is not null and ends_at > starts_at)
);

-- A draft withdrawn before review was never public and must stay private:
-- like drafts, only the seller and admins can see it.
alter table public.auctions
  add column if not exists withdrawn_before_review boolean not null default false;

drop policy if exists "public auctions are visible" on public.auctions;
create policy "public auctions are visible" on public.auctions for select
  using (
    (status::text not in ('draft', 'rejected') and not withdrawn_before_review)
    or seller_id = auth.uid()
    or public.is_admin()
  );

-- Admins find pending requests quickly.
create index if not exists auction_private_withdraw_pending_idx
  on public.auction_private (withdraw_requested_at)
  where withdraw_request_status = 'pending';

-- -----------------------------------------------------------------------------
-- seller_withdraw: the seller withdraws a listing that isn't live yet.
-- Errors: NOT_AUTHENTICATED, AUCTION_NOT_FOUND, NOT_OWNER, NOT_WITHDRAWABLE,
-- REASON_TOO_LONG.
-- -----------------------------------------------------------------------------
create or replace function public.seller_withdraw(p_auction_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid    uuid := auth.uid();
  v_seller uuid;
  v_status text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  -- Lock the row so the schedule job or an admin can't change it at the same time.
  select seller_id, status::text into v_seller, v_status
    from public.auctions where id = p_auction_id
    for update;
  if not found then
    raise exception 'AUCTION_NOT_FOUND';
  end if;
  if v_seller <> v_uid then
    raise exception 'NOT_OWNER';
  end if;
  if v_status not in ('draft', 'upcoming') then
    raise exception 'NOT_WITHDRAWABLE';
  end if;
  if char_length(v_reason) > 1000 then
    raise exception 'REASON_TOO_LONG';
  end if;

  update public.auctions
     set status = 'withdrawn',
         withdrawn_before_review = (v_status = 'draft')
   where id = p_auction_id;

  insert into public.auction_private (auction_id, withdraw_reason)
  values (p_auction_id, v_reason)
  on conflict (auction_id) do update set withdraw_reason = excluded.withdraw_reason;
end $$;

revoke all on function public.seller_withdraw(uuid, text) from public, anon, authenticated;
grant execute on function public.seller_withdraw(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- seller_request_withdrawal: the seller asks to withdraw a live auction.
-- Errors: NOT_AUTHENTICATED, AUCTION_NOT_FOUND, NOT_OWNER, NOT_LIVE,
-- REASON_LENGTH (20 to 1000 characters), ALREADY_REQUESTED.
-- -----------------------------------------------------------------------------
create or replace function public.seller_request_withdrawal(p_auction_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_uid     uuid := auth.uid();
  v_seller  uuid;
  v_status  text;
  v_reason  text := btrim(coalesce(p_reason, ''));
  v_pending boolean;
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED';
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
  if v_status <> 'live' then
    raise exception 'NOT_LIVE';
  end if;
  if char_length(v_reason) not between 20 and 1000 then
    raise exception 'REASON_LENGTH';
  end if;

  select coalesce(withdraw_request_status = 'pending', false) into v_pending
    from public.auction_private where auction_id = p_auction_id;
  if coalesce(v_pending, false) then
    raise exception 'ALREADY_REQUESTED';
  end if;

  insert into public.auction_private (auction_id, withdraw_reason, withdraw_requested_at, withdraw_request_status)
  values (p_auction_id, v_reason, now(), 'pending')
  on conflict (auction_id) do update
    set withdraw_reason = excluded.withdraw_reason,
        withdraw_requested_at = excluded.withdraw_requested_at,
        withdraw_request_status = 'pending';
end $$;

revoke all on function public.seller_request_withdrawal(uuid, text) from public, anon, authenticated;
grant execute on function public.seller_request_withdrawal(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Notifications: tell the seller what an admin decided about their request.
-- -----------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'question', 'answer', 'outbid', 'listing_approved', 'listing_rejected',
  'auction_live', 'auction_ended', 'auction_won', 'listing_submitted',
  'watch_ending_soon', 'watch_live', 'inspection_rejected',
  'withdrawal_approved', 'withdrawal_declined'
));
