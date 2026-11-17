-- =============================================================================
-- Biddr: payments plumbing for Stripe.
-- 1. stripe_events: every Stripe webhook event, stored by id, so each is handled
--    once (Stripe retries and may send duplicates) and failures are visible.
-- 2. call_app_job(): lets pg_cron call the site's protected job routes through
--    pg_net, with the CRON_SECRET bearer header. The site URL and the secret are
--    read from Supabase Vault (secrets "biddr_site_url" and "biddr_cron_secret");
--    until both exist the job does nothing. Vercel's plan may only allow a daily
--    cron, so this runs the card-hold release every 5 minutes instead.
--
-- Idempotent: safe to run more than once. Nothing is dropped. place_bid is not touched.
-- =============================================================================

create extension if not exists pg_net with schema extensions;

-- -----------------------------------------------------------------------------
-- Stripe webhook events (service role only).
-- -----------------------------------------------------------------------------
create table if not exists public.stripe_events (
  id                text primary key,             -- Stripe's event id (evt_…)
  type              text not null,
  payment_intent_id text,
  auction_id        uuid,
  status            text not null default 'processing',
  error             text,
  received_at       timestamptz not null default now(),
  processed_at      timestamptz
);

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.stripe_events'::regclass
                  and conname = 'stripe_events_status_check') then
    alter table public.stripe_events add constraint stripe_events_status_check
      check (status in ('processing', 'processed', 'failed'));
  end if;
end $$;

create index if not exists stripe_events_auction_idx on public.stripe_events (auction_id, received_at desc);
create index if not exists stripe_events_pi_idx on public.stripe_events (payment_intent_id);

alter table public.stripe_events enable row level security;
revoke all on public.stripe_events from anon, authenticated;
grant all on public.stripe_events to service_role;

-- -----------------------------------------------------------------------------
-- call_app_job(path): GET <site URL><path> with "Authorization: Bearer <CRON_SECRET>".
-- -----------------------------------------------------------------------------
create or replace function public.call_app_job(p_path text)
returns bigint language plpgsql security definer set search_path = public, extensions as $$
declare
  v_url    text;
  v_secret text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'biddr_site_url' limit 1;
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'biddr_cron_secret' limit 1;
  if v_url is null or v_secret is null or p_path !~ '^/api/[a-z0-9/_-]+$' then
    return null; -- not configured yet (or a bad path): do nothing
  end if;
  return net.http_get(
    url := rtrim(v_url, '/') || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 30000
  );
end $$;

revoke all on function public.call_app_job(text) from public, anon, authenticated;

-- Every 5 minutes: release card holds on closed and withdrawn auctions
-- (a job with this name is replaced, not duplicated).
select cron.schedule('release-card-holds', '*/5 * * * *', $$select public.call_app_job('/api/stripe/release')$$);
