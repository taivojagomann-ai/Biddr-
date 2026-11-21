-- =============================================================================
-- 0031: Receipts for the buyer's premium (DECISIONS.md point 12).
--
-- A payment receipt when a premium is paid in full (one per buyer payment), and a
-- refund receipt for each refund (partial refunds too), referencing the original
-- receipt and the invoice. Numbers run R-<year>-0001, R-<year>-0002, ... per calendar
-- year (Tallinn time), in their own series (not the invoices'), with no gaps: taken in
-- the same transaction that saves the receipt. Each receipt keeps a snapshot of what it
-- shows and can't be changed or deleted, except that its stored PDF's path is filled
-- in once. The PDF is in the private "receipts" bucket; the winner and admins open it
-- through a short-lived signed link made by the server.
-- The winner reads their own receipts; everything else is server-side (service role).
-- Idempotent: safe to run more than once. Nothing is dropped.
-- =============================================================================

create table if not exists public.receipt_counters (
  year        int primary key,
  last_number int not null default 0
);
alter table public.receipt_counters enable row level security;
revoke all on public.receipt_counters from anon, authenticated;

create table if not exists public.receipts (
  id                  uuid primary key default gen_random_uuid(),
  number              text not null unique,
  type                text not null check (type in ('payment', 'refund')),
  -- No foreign keys to payments, auctions or users: a receipt must outlive them.
  buyer_payment_id    uuid not null,
  auction_id          uuid not null,
  buyer_id            uuid not null,
  invoice_id          uuid references public.invoices (id),
  -- Refund receipts: the payment receipt they refer to.
  refunds_receipt_id  uuid references public.receipts (id),
  -- Refund receipts: the Stripe refunds they cover (each refund is receipted once).
  stripe_refund_ids   text[] not null default '{}',
  -- Cents, positive for both types (the type says which way the money went).
  amount              bigint not null check (amount > 0),
  currency            text not null default 'EUR' check (currency = 'EUR'),
  net_cents           bigint not null,
  vat_cents           bigint not null,
  vat_rate            numeric(5, 2) not null check (vat_rate >= 0 and vat_rate < 100),
  vat_country         text not null check (vat_country ~ '^[A-Z]{2}$'),
  -- Each card charge (or refund): kind, amount, Stripe references, card brand and last 4.
  charges             jsonb not null default '[]'::jsonb,
  -- What the document shows: payer, payee, references, the line.
  details             jsonb not null default '{}'::jsonb,
  pdf_path            text,
  -- When the money moved (the payment's paid_at, or the refund's time).
  issued_at           timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  constraint receipts_amounts_add_up check (net_cents + vat_cents = amount),
  constraint receipts_refund_refers check ((type = 'payment' and refunds_receipt_id is null) or (type = 'refund' and refunds_receipt_id is not null))
);

create unique index if not exists receipts_one_payment_receipt on public.receipts (buyer_payment_id) where type = 'payment';
create index if not exists receipts_payment_idx on public.receipts (buyer_payment_id, issued_at);
create index if not exists receipts_buyer_idx on public.receipts (buyer_id, issued_at desc);

alter table public.receipts enable row level security;
revoke all on public.receipts from anon, authenticated;
grant select on public.receipts to authenticated;
grant all on public.receipts to service_role;

drop policy if exists "buyers read their receipts" on public.receipts;
create policy "buyers read their receipts" on public.receipts
  for select to authenticated using (buyer_id = auth.uid());

-- Issued receipts are final; only the stored PDF's path is filled in, once.
create or replace function public.receipts_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' and old.pdf_path is null and new.pdf_path is not null
     and (to_jsonb(new) - 'pdf_path') = (to_jsonb(old) - 'pdf_path') then
    return new;
  end if;
  raise exception 'Receipts can''t be changed or deleted. Issue a refund receipt instead.';
end $$;

drop trigger if exists receipts_immutable on public.receipts;
create trigger receipts_immutable
  before update or delete on public.receipts
  for each row execute function public.receipts_immutable();

-- -----------------------------------------------------------------------------
-- issue_receipt: takes the next number and saves the receipt in one transaction.
-- Payment receipts: a second call returns the receipt already issued. Refund
-- receipts: refunds that already have a receipt are left out; if none is left,
-- nothing is issued (null).
-- -----------------------------------------------------------------------------
create or replace function public.issue_receipt(
  p_type text,
  p_buyer_payment_id uuid,
  p_auction_id uuid,
  p_buyer_id uuid,
  p_invoice_id uuid,
  p_refunds_receipt_id uuid,
  p_stripe_refund_ids text[],
  p_amount bigint,
  p_net_cents bigint,
  p_vat_cents bigint,
  p_vat_rate numeric,
  p_vat_country text,
  p_charges jsonb,
  p_details jsonb,
  p_issued_at timestamptz
) returns public.receipts
language plpgsql security definer set search_path = public as $$
declare
  v_receipt public.receipts;
  v_year int := extract(year from (now() at time zone 'Europe/Tallinn'))::int;
  v_n int;
begin
  -- One caller at a time per payment.
  perform pg_advisory_xact_lock(hashtextextended('receipt:' || p_buyer_payment_id::text, 0));

  if p_type = 'payment' then
    select * into v_receipt from public.receipts where buyer_payment_id = p_buyer_payment_id and type = 'payment';
    if found then
      return v_receipt;
    end if;
  elsif exists (
    select 1 from public.receipts
     where buyer_payment_id = p_buyer_payment_id and type = 'refund' and stripe_refund_ids && coalesce(p_stripe_refund_ids, '{}')
  ) then
    -- These refunds (or some of them) already have a receipt: the caller leaves them out.
    return null;
  end if;

  insert into public.receipt_counters (year, last_number) values (v_year, 1)
  on conflict (year) do update set last_number = public.receipt_counters.last_number + 1
  returning last_number into v_n;

  insert into public.receipts (
    number, type, buyer_payment_id, auction_id, buyer_id, invoice_id, refunds_receipt_id, stripe_refund_ids,
    amount, net_cents, vat_cents, vat_rate, vat_country, charges, details, issued_at
  ) values (
    'R-' || v_year || '-' || lpad(v_n::text, 4, '0'), p_type, p_buyer_payment_id, p_auction_id, p_buyer_id,
    p_invoice_id, p_refunds_receipt_id, coalesce(p_stripe_refund_ids, '{}'), p_amount, p_net_cents, p_vat_cents,
    p_vat_rate, p_vat_country, coalesce(p_charges, '[]'::jsonb), coalesce(p_details, '{}'::jsonb), coalesce(p_issued_at, now())
  ) returning * into v_receipt;

  return v_receipt;
end $$;

revoke all on function public.issue_receipt(text, uuid, uuid, uuid, uuid, uuid, text[], bigint, bigint, bigint, numeric, text, jsonb, jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.issue_receipt(text, uuid, uuid, uuid, uuid, uuid, text[], bigint, bigint, bigint, numeric, text, jsonb, jsonb, timestamptz)
  to service_role;

-- -----------------------------------------------------------------------------
-- Storage: the PDFs, private (no member access; the server makes signed links).
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- -----------------------------------------------------------------------------
-- Notifications ("receipt_ready", emailed when email is set up). Widen-only.
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
      'identity_required', 'identity_verified', 'listing_on_hold', 'listing_needs_check',
      'receipt_ready'];
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.notifications'::regclass and conname = 'notifications_type_check';
  if v_def is null or exists (select 1 from unnest(v_types) as t(v) where position(quote_literal(t.v) in v_def) = 0) then
    alter table public.notifications drop constraint if exists notifications_type_check;
    execute format('alter table public.notifications add constraint notifications_type_check check (type in (%s))',
      (select string_agg(quote_literal(t), ', ') from unnest(v_types) t));
  end if;
end $$;

-- Emailed types (0028): receipts too.
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
    when 'receipt_ready' then true
    else false
  end;
$$;
