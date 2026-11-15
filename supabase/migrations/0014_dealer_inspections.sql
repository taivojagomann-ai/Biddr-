-- =============================================================================
-- Authorised dealer inspections. The only inspection Biddr accepts is a pre-sale
-- inspection by an authorised dealer of the car's brand, in any EU country. The
-- seller arranges it and uploads the report; an admin checks it during review.
-- Inspections stay optional.
--
-- Idempotent: safe to run more than once. No tables, columns or data are dropped;
-- the old partner-booking columns (inspection_requested, inspection_city,
-- inspection_preferred_dates) are kept but no longer used. place_bid is not
-- touched. search_auctions is re-created because it now also returns
-- inspection_type (a function's result columns can't be changed in place).
-- =============================================================================

-- Inspections are optional for every car (also done in 0013; repeated in case).
alter table public.auctions drop constraint if exists restored_needs_inspection;

-- -----------------------------------------------------------------------------
-- auction_private: what the seller submitted and the admin's review
-- (admin-only table; sellers write it through the server).
-- -----------------------------------------------------------------------------
alter table public.auction_private
  add column if not exists dealer_inspection_provided   boolean,
  add column if not exists dealer_name                  text,
  add column if not exists dealer_city                  text,
  add column if not exists dealer_country               text,
  add column if not exists dealer_inspection_date       date,
  add column if not exists dealer_inspection_mileage_km integer,
  add column if not exists dealer_report_paths          jsonb not null default '[]'::jsonb,
  add column if not exists inspection_review_status     text,
  add column if not exists inspection_review_note       text,
  add column if not exists inspection_reviewed_by       uuid references auth.users (id) on delete set null,
  add column if not exists inspection_reviewed_at       timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.auction_private'::regclass
                  and conname = 'inspection_review_status_check') then
    alter table public.auction_private add constraint inspection_review_status_check
      check (inspection_review_status is null or inspection_review_status in ('pending', 'accepted', 'rejected'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.auction_private'::regclass
                  and conname = 'dealer_country_eu_check') then
    alter table public.auction_private add constraint dealer_country_eu_check
      check (dealer_country is null or dealer_country in (
        'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE',
        'IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE'));
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.auction_private'::regclass
                  and conname = 'dealer_inspection_mileage_check') then
    alter table public.auction_private add constraint dealer_inspection_mileage_check
      check (dealer_inspection_mileage_km is null or dealer_inspection_mileage_km between 0 and 2000000);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.auction_private'::regclass
                  and conname = 'dealer_report_paths_array_check') then
    alter table public.auction_private add constraint dealer_report_paths_array_check
      check (jsonb_typeof(dealer_report_paths) = 'array' and jsonb_array_length(dealer_report_paths) <= 10);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- auctions.inspection_type: 'authorised_dealer' once an admin accepted the
-- report; null otherwise. The public card reuses inspection_partner_name
-- (dealer name and city), inspection_date, inspection_highlights and
-- inspection_report_url (a redacted public copy only).
-- -----------------------------------------------------------------------------
alter table public.auctions add column if not exists inspection_type text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.auctions'::regclass
                  and conname = 'auctions_inspection_type_check') then
    alter table public.auctions add constraint auctions_inspection_type_check
      check (inspection_type is null or inspection_type in ('authorised_dealer'));
  end if;
end $$;

-- Only admins set it (through the server): sellers' column grants don't include it.

-- -----------------------------------------------------------------------------
-- Storage: private bucket for the seller's original reports.
-- PDF, JPEG, PNG or WebP, at most 20 MB each. Not public: admins open files
-- through short-lived signed URLs made on the server.
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('inspection-uploads', 'inspection-uploads', false, 20971520,
        array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Signed-in members write and delete only inside their own folder: <user id>/<draft id>/<file>.
drop policy if exists "inspection uploads: owners upload" on storage.objects;
create policy "inspection uploads: owners upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'inspection-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "inspection uploads: owners delete" on storage.objects;
create policy "inspection uploads: owners delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'inspection-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

-- The Storage API's remove() looks the object up before deleting it, so owners can
-- see the files in their own folder (and nothing else). There is no public read.
drop policy if exists "inspection uploads: owners read own folder" on storage.objects;
create policy "inspection uploads: owners read own folder" on storage.objects
  for select to authenticated
  using (bucket_id = 'inspection-uploads' and (storage.foldername(name))[1] = auth.uid()::text);

-- -----------------------------------------------------------------------------
-- Notifications: tell the seller when their report wasn't accepted.
-- -----------------------------------------------------------------------------
-- Replaced only when the current check is missing or doesn't allow every type
-- below, so re-running this file never narrows a list a later migration widened.
do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def from pg_constraint
   where conrelid = 'public.notifications'::regclass and conname = 'notifications_type_check';
  if v_def is null or exists (
    select 1 from unnest(array['question', 'answer', 'outbid', 'listing_approved', 'listing_rejected',
  'auction_live', 'auction_ended', 'auction_won', 'listing_submitted',
  'watch_ending_soon', 'watch_live', 'inspection_rejected']) as t(v)
     where position(quote_literal(t.v) in v_def) = 0
  ) then
    alter table public.notifications drop constraint if exists notifications_type_check;
    alter table public.notifications add constraint notifications_type_check check (type in (
      'question', 'answer', 'outbid', 'listing_approved', 'listing_rejected',
      'auction_live', 'auction_ended', 'auction_won', 'listing_submitted',
      'watch_ending_soon', 'watch_live', 'inspection_rejected'
    ));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Home page search: "Restored, dealer inspected" now means inspection_type =
-- 'authorised_dealer', and results carry inspection_type for the badge.
-- Same function as 0013 otherwise.
-- -----------------------------------------------------------------------------
set search_path = public, extensions;

drop function if exists public.search_auctions(text, text, text, text, int, int);

create or replace function public.search_auctions(
  p_query     text,
  p_tab       text default 'live',
  p_country   text default null,
  p_condition text default null,
  p_limit     int  default 48,
  p_offset    int  default 0
) returns table (
  id uuid, title text, make text, model text, year smallint, mileage_km integer, location_city text,
  location_country public.baltic_country, condition_type public.condition_type, inspection_partner_name text,
  gallery_urls jsonb, starting_bid integer, has_reserve boolean, reserve_met boolean, current_bid integer,
  bid_count integer, ends_at timestamptz, starts_at timestamptz, status public.auction_status, is_demo boolean,
  watch_count integer, inspection_type text, sort_rank bigint, total_count bigint
) language plpgsql stable set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_words text[] := public.search_query_words(p_query);
  v_where text := '';
  v_order text;
  v_rank  text;
  v_w     text;
begin
  if cardinality(v_words) = 0 then
    return;
  end if;

  foreach v_w in array v_words loop
    v_where := v_where || ' and ' || public.search_word_condition(v_w, 'a.search_text');
  end loop;

  case coalesce(p_tab, 'live')
    when 'newest' then
      v_where := v_where || ' and a.status = ''live''';
      v_order := 'a.starts_at desc nulls last';
    when 'ending' then
      v_where := v_where || ' and a.status = ''live'' and a.ends_at <= now() + interval ''24 hours''';
      v_order := 'a.ends_at asc nulls last';
    when 'upcoming' then
      v_where := v_where || ' and a.status = ''upcoming''';
      v_order := 'a.starts_at asc nulls last';
    when 'past' then
      v_where := v_where || ' and a.status::text in (''ended'', ''sold'', ''reserve_not_met'')';
      v_order := 'a.ends_at desc nulls last';
    else
      v_where := v_where || ' and a.status = ''live''';
      v_order := 'a.ends_at asc nulls last';
  end case;

  if p_country ~ '^[A-Z]{2}$' then
    v_where := v_where || format(' and a.location_country::text = %L', p_country);
  end if;
  if p_condition = 'clean' then
    v_where := v_where || ' and a.condition_type = ''clean''';
  elsif p_condition = 'restored' then
    v_where := v_where || ' and a.condition_type = ''restored_accident'' and a.inspection_type = ''authorised_dealer''';
  elsif p_condition = 'restored_any' then
    v_where := v_where || ' and a.condition_type = ''restored_accident''';
  end if;

  -- Exact model (or model + variant) matches first: "m3" puts BMW M3s before
  -- an M340i. A joined word counts with its parts too ("porsche 911" -> 911).
  v_rank := format(
    'case when public.search_compact(a.model) = any(%1$L::text[])
               or public.search_compact(concat_ws('' '', a.model, a.variant)) = any(%1$L::text[]) then 0 else 1 end',
    (select array_agg(distinct x)
       from unnest(v_words) w,
            unnest(array[replace(w, ' ', '')] || regexp_split_to_array(w, ' ')) x));

  return query execute format(
    'select a.id, a.title, a.make, a.model, a.year, a.mileage_km, a.location_city, a.location_country,
            a.condition_type, a.inspection_partner_name, a.gallery_urls, a.starting_bid, a.has_reserve,
            a.reserve_met, a.current_bid, a.bid_count, a.ends_at, a.starts_at, a.status, a.is_demo,
            a.watch_count, a.inspection_type,
            row_number() over (order by %1$s, %2$s, a.id) as sort_rank,
            count(*) over () as total_count
       from public.auctions a
      where true %3$s
      order by %1$s, %2$s, a.id
      limit %4$s offset %5$s',
    v_rank, v_order, v_where,
    least(greatest(coalesce(p_limit, 48), 1), 100),
    greatest(coalesce(p_offset, 0), 0));
end $$;

grant execute on function public.search_auctions(text, text, text, text, int, int) to anon, authenticated;
