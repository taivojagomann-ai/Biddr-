-- =============================================================================
-- Optional inspections: the seller decides whether to book an independent
-- inspection, for every car, clean or restored.
-- Idempotent: safe to run more than once. The only thing dropped is the check
-- constraint restored_needs_inspection; no tables, columns or data are dropped.
-- place_bid is not touched.
-- =============================================================================

-- Restored cars may now be approved without an inspection.
alter table public.auctions drop constraint if exists restored_needs_inspection;

-- The seller's choice: true = book an inspection, false = list without one,
-- null = not answered yet (listings submitted before this migration).
alter table public.auction_private add column if not exists inspection_requested boolean;

-- Inspection city is only needed when an inspection was requested.
-- (inspection_city and inspection_preferred_dates are kept as they are.)
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.auction_private'::regclass and conname = 'inspection_city_when_requested'
  ) then
    alter table public.auction_private add constraint inspection_city_when_requested
      check (inspection_requested is not true or inspection_city is not null);
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Home page search: the History filter gains "Restored" (any restored car)
-- next to "Restored, partner verified". Same function as 0012 plus that one
-- branch; needs 0012 to have been run.
-- -----------------------------------------------------------------------------
set search_path = public, extensions;

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
  watch_count integer, sort_rank bigint, total_count bigint
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
    v_where := v_where || ' and a.condition_type = ''restored_accident'' and a.inspection_partner_name is not null';
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
            a.watch_count,
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
