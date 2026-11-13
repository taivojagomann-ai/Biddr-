-- =============================================================================
-- Bidder requirements: a complete profile and accepted bidding terms before
-- anyone can bid. Enforced with triggers, so place_bid (changed by earlier
-- migrations) is not redefined here.
-- Idempotent: safe to run more than once. Drops no tables, columns or data
-- (only this file's own triggers are dropped and re-created).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Columns. Written only by accept_bidding_terms(); browsers get no UPDATE grant.
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists bidding_terms_version     text,
  add column if not exists bidding_terms_accepted_at timestamptz,
  add column if not exists age_confirmed_at          timestamptz;

-- 0001 never granted these; revoke anyway so the rule holds even if grants change.
revoke update (bidding_terms_version, bidding_terms_accepted_at, age_confirmed_at)
  on public.profiles from anon, authenticated;

-- -----------------------------------------------------------------------------
-- The current terms version. Change the string to make everyone accept again.
-- -----------------------------------------------------------------------------
create or replace function public.current_bidding_terms_version()
returns text language sql stable as $$
  select '2026-11-draft-1'::text
$$;
grant execute on function public.current_bidding_terms_version() to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Internal checks (security definer: they read full_name and phone, which
-- browsers can't). Not callable from the browser.
-- -----------------------------------------------------------------------------
create or replace function public.bidder_profile_complete(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select nullif(btrim(username), '') is not null
       and nullif(btrim(full_name), '') is not null
       and country is not null
       and nullif(btrim(phone), '') is not null
      from public.profiles where id = p_user
  ), false)
$$;

create or replace function public.bidder_terms_accepted(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select bidding_terms_version = public.current_bidding_terms_version()
      from public.profiles where id = p_user
  ), false)
$$;

revoke all on function public.bidder_profile_complete(uuid) from public, anon, authenticated;
revoke all on function public.bidder_terms_accepted(uuid) from public, anon, authenticated;
grant execute on function public.bidder_profile_complete(uuid) to service_role;
grant execute on function public.bidder_terms_accepted(uuid) to service_role;

-- -----------------------------------------------------------------------------
-- bidder_status(): what the signed-in user still needs before bidding.
-- -----------------------------------------------------------------------------
create or replace function public.bidder_status()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'profile_complete', public.bidder_profile_complete(v_uid),
    'terms_accepted',   public.bidder_terms_accepted(v_uid),
    'current_version',  public.current_bidding_terms_version()
  );
end $$;

revoke all on function public.bidder_status() from public, anon;
grant execute on function public.bidder_status() to authenticated;

-- -----------------------------------------------------------------------------
-- accept_bidding_terms(): records acceptance (and the 18+ confirmation) for the
-- caller's own profile, only for the current version.
-- -----------------------------------------------------------------------------
create or replace function public.accept_bidding_terms(p_version text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = 'P0001';
  end if;
  if p_version is distinct from public.current_bidding_terms_version() then
    raise exception 'TERMS_VERSION_MISMATCH' using errcode = 'P0001';
  end if;

  update public.profiles
     set bidding_terms_version     = p_version,
         bidding_terms_accepted_at = now(),
         age_confirmed_at          = now()
   where id = v_uid;
  if not found then
    raise exception 'PROFILE_INCOMPLETE' using errcode = 'P0001';
  end if;

  return public.bidder_status();
end $$;

revoke all on function public.accept_bidding_terms(text) from public, anon;
grant execute on function public.accept_bidding_terms(text) to authenticated;

-- -----------------------------------------------------------------------------
-- Bids: a signed-in bidder needs a complete profile and the current terms.
-- Service-role inserts (auth.uid() is null, e.g. demo data) are not affected.
-- -----------------------------------------------------------------------------
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
  return new;
end $$;

drop trigger if exists bids_require_bidder on public.bids;
create trigger bids_require_bidder
  before insert on public.bids
  for each row execute function public.bids_require_bidder();

-- -----------------------------------------------------------------------------
-- Comments: a signed-in commenter needs a username and country (no terms needed).
-- -----------------------------------------------------------------------------
create or replace function public.comments_require_profile()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if not exists (
    select 1 from public.profiles
     where id = auth.uid() and nullif(btrim(username), '') is not null and country is not null
  ) then
    raise exception 'PROFILE_INCOMPLETE' using errcode = 'P0001';
  end if;
  return new;
end $$;

drop trigger if exists comments_require_profile on public.comments;
create trigger comments_require_profile
  before insert on public.comments
  for each row execute function public.comments_require_profile();
