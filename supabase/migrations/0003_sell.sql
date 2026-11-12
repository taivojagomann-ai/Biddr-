-- =============================================================================
-- Sell-your-car flow (/sell)
-- Idempotent: every statement can be run again in the SQL Editor without errors.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- auction_private: what the seller asked for. Stays admin-only (existing RLS);
-- the app writes it with the service role after the seller's own insert succeeds.
-- -----------------------------------------------------------------------------
alter table public.auction_private
  add column if not exists requested_reserve         integer check (requested_reserve > 0),
  add column if not exists inspection_preferred_dates text,
  add column if not exists contact_notes             text;

-- -----------------------------------------------------------------------------
-- auctions.variant, e.g. "Competition", "Touring"
-- -----------------------------------------------------------------------------
alter table public.auctions
  add column if not exists variant text check (char_length(variant) <= 60);

-- Column grants are additive and re-runnable.
grant insert (variant) on public.auctions to authenticated;
grant update (variant) on public.auctions to authenticated;

-- One open listing per VIN (drafts, scheduled and live auctions).
create unique index if not exists auctions_vin_open_uidx
  on public.auctions (upper(vin))
  where status in ('draft', 'upcoming', 'live');

-- -----------------------------------------------------------------------------
-- Storage: auction-photos bucket (public read)
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('auction-photos', 'auction-photos', true, 10485760, array['image/jpeg', 'image/webp', 'image/png'])
on conflict (id) do nothing;

-- Members write only inside their own folder: <user id>/<draft id>/<section>/<file>.
drop policy if exists "auction photos: owners upload" on storage.objects;
create policy "auction photos: owners upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'auction-photos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "auction photos: owners delete" on storage.objects;
create policy "auction photos: owners delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'auction-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- The Storage API's remove() looks the object up before deleting it, so owners
-- also need SELECT on their own folder. Public read goes through the public
-- bucket URL and needs no policy.
drop policy if exists "auction photos: owners read own folder" on storage.objects;
create policy "auction photos: owners read own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'auction-photos' and (storage.foldername(name))[1] = auth.uid()::text);
