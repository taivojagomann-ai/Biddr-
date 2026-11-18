-- =============================================================================
-- 0028: Emails to the winner and the seller (DECISIONS.md point 15).
--
-- Emails follow notifications: a notification of an emailed type (a sale, payment
-- needed, the reminder, premium paid, buyer didn't pay, a second-chance offer) is
-- also sent by email by the app (/api/email/send), at most once. The app sends only
-- when SMTP is configured (SMTP_HOST and friends in Vercel); until then nothing is
-- sent and these columns stay empty.
--
-- - notifications.emailed_at / email_attempts / email_error: what happened.
-- - A trigger asks the app to send right away; pg_cron retries every 5 minutes.
--
-- Idempotent: safe to run more than once. Nothing is dropped.
-- =============================================================================

alter table public.notifications add column if not exists emailed_at timestamptz;
alter table public.notifications add column if not exists email_attempts integer not null default 0;
alter table public.notifications add column if not exists email_error text;

create index if not exists notifications_email_pending_idx
  on public.notifications (created_at)
  where emailed_at is null;

-- The types that are emailed (lib/email/templates.ts has the texts).
create or replace function public.notification_is_emailed(p_type text, p_data jsonb)
returns boolean language sql immutable as $$
  select case p_type
    when 'auction_won' then true
    when 'auction_ended' then coalesce(p_data->>'status', '') = 'sold'
    when 'premium_due' then true
    when 'premium_reminder' then true
    when 'premium_paid' then true
    when 'premium_unpaid' then true
    when 'buyer_did_not_pay' then coalesce(p_data->>'role', '') = 'seller'
    when 'second_chance_offer' then true
    else false
  end;
$$;

-- Send right away (the app does nothing when SMTP isn't configured).
create or replace function public.notifications_email_now()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.notification_is_emailed(new.type, new.data) then
    perform public.call_app_job('/api/email/send');
  end if;
  return null;
end $$;

drop trigger if exists notifications_email_now on public.notifications;
create trigger notifications_email_now
  after insert on public.notifications
  for each row execute function public.notifications_email_now();

-- Retries (a job with this name is replaced, not duplicated).
select cron.schedule('send-emails', '*/5 * * * *', $$select public.call_app_job('/api/email/send')$$);
