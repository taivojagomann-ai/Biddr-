-- =============================================================================
-- 0035: Premium seats in the home page's featured carousel (DECISIONS.md point 9).
--
-- A live auction with a premium seat (premium_seat_until in the future) is shown in
-- the featured carousel, always labelled "Featured". For now admins set it by hand
-- (source 'admin', logged in admin_actions); paid seats ('paid') come later.
-- Both columns are public like the rest of the auction row (the label is public);
-- only the server (service role) writes them: they aren't in the sellers' column grants.
--
-- Idempotent: safe to run more than once. Nothing is dropped.
-- =============================================================================

alter table public.auctions add column if not exists premium_seat_until timestamptz;
alter table public.auctions add column if not exists premium_seat_source text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.auctions'::regclass and conname = 'auctions_premium_seat_source_check') then
    alter table public.auctions add constraint auctions_premium_seat_source_check
      check (premium_seat_source is null or premium_seat_source in ('paid', 'admin'));
  end if;
end $$;

create index if not exists auctions_premium_seat_idx on public.auctions (premium_seat_until) where premium_seat_until is not null;
