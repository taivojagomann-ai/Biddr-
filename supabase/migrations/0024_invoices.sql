-- 0024: Invoices for the buyer's premium.
-- One invoice per paid premium, and one credit note if it is refunded. Numbers run
-- BID-<year>-00001, BID-<year>-00002, ... per calendar year (Tallinn time), in one
-- series shared by invoices and credit notes, with no gaps: a number is taken in the
-- same transaction that saves the invoice. Each invoice keeps a snapshot of what was
-- printed on it (Biddr's details, the buyer, the car, the amounts and VAT), and can't
-- be changed or deleted afterwards; a refund gets a credit note instead.
-- The winner reads their own invoices; everything else is server-side (service role).
-- Idempotent: safe to run more than once. Nothing is dropped.

create table if not exists public.invoice_counters (
  year        int primary key,
  last_number int not null default 0
);
alter table public.invoice_counters enable row level security;
revoke all on public.invoice_counters from anon, authenticated;

create table if not exists public.invoices (
  id                  uuid primary key default gen_random_uuid(),
  number              text not null unique,
  kind                text not null check (kind in ('invoice', 'credit_note')),
  -- No foreign keys to payments, auctions or users: an invoice must outlive them.
  buyer_payment_id    uuid not null,
  auction_id          uuid not null,
  buyer_id            uuid not null,
  credited_invoice_id uuid references public.invoices (id),
  issued_at           timestamptz not null default now(),
  currency            text not null default 'EUR' check (currency = 'EUR'),
  -- Cents. The premium includes VAT: net + vat = total. Credit notes are negative.
  total_cents         bigint not null,
  net_cents           bigint not null,
  vat_cents           bigint not null,
  vat_rate            numeric(5, 2) not null check (vat_rate >= 0 and vat_rate < 100),
  -- The country whose VAT applies (where the car is), ISO code.
  vat_country         text not null check (vat_country ~ '^[A-Z]{2}$'),
  -- What the document shows: issuer, buyer, line, payments, references.
  details             jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  constraint invoices_amounts_add_up check (net_cents + vat_cents = total_cents),
  constraint invoices_sign check (
    (kind = 'invoice' and total_cents > 0 and credited_invoice_id is null)
    or (kind = 'credit_note' and total_cents < 0 and credited_invoice_id is not null)
  )
);

create unique index if not exists invoices_one_per_payment on public.invoices (buyer_payment_id, kind);
create index if not exists invoices_buyer_idx on public.invoices (buyer_id, issued_at desc);
create index if not exists invoices_issued_idx on public.invoices (issued_at desc);

alter table public.invoices enable row level security;
revoke all on public.invoices from anon, authenticated;
grant select on public.invoices to authenticated;

drop policy if exists "buyers read their invoices" on public.invoices;
create policy "buyers read their invoices" on public.invoices
  for select to authenticated using (buyer_id = auth.uid());

-- Issued invoices are final.
create or replace function public.invoices_immutable()
returns trigger language plpgsql set search_path = public as $$
begin
  raise exception 'Invoices can''t be changed or deleted. Issue a credit note instead.';
end $$;

drop trigger if exists invoices_immutable on public.invoices;
create trigger invoices_immutable
  before update or delete on public.invoices
  for each row execute function public.invoices_immutable();

-- -----------------------------------------------------------------------------
-- issue_invoice: takes the next number and saves the invoice in one transaction.
-- Idempotent per (payment, kind): a second call returns the invoice already issued.
-- -----------------------------------------------------------------------------
create or replace function public.issue_invoice(
  p_kind text,
  p_buyer_payment_id uuid,
  p_auction_id uuid,
  p_buyer_id uuid,
  p_credited_invoice_id uuid,
  p_total_cents bigint,
  p_net_cents bigint,
  p_vat_cents bigint,
  p_vat_rate numeric,
  p_vat_country text,
  p_details jsonb
) returns public.invoices
language plpgsql security definer set search_path = public as $$
declare
  v_invoice public.invoices;
  v_year int := extract(year from (now() at time zone 'Europe/Tallinn'))::int;
  v_n int;
begin
  -- One caller at a time per payment and kind.
  perform pg_advisory_xact_lock(hashtextextended(p_buyer_payment_id::text || ':' || p_kind, 0));

  select * into v_invoice from public.invoices
   where buyer_payment_id = p_buyer_payment_id and kind = p_kind;
  if found then
    return v_invoice;
  end if;

  insert into public.invoice_counters (year, last_number) values (v_year, 1)
  on conflict (year) do update set last_number = public.invoice_counters.last_number + 1
  returning last_number into v_n;

  insert into public.invoices (
    number, kind, buyer_payment_id, auction_id, buyer_id, credited_invoice_id,
    total_cents, net_cents, vat_cents, vat_rate, vat_country, details
  ) values (
    'BID-' || v_year || '-' || lpad(v_n::text, 5, '0'), p_kind, p_buyer_payment_id, p_auction_id,
    p_buyer_id, p_credited_invoice_id, p_total_cents, p_net_cents, p_vat_cents, p_vat_rate,
    p_vat_country, coalesce(p_details, '{}'::jsonb)
  ) returning * into v_invoice;

  return v_invoice;
end $$;

revoke all on function public.issue_invoice(text, uuid, uuid, uuid, uuid, bigint, bigint, bigint, numeric, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.issue_invoice(text, uuid, uuid, uuid, uuid, bigint, bigint, bigint, numeric, text, jsonb)
  to service_role;
