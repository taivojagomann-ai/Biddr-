-- =============================================================================
-- Free-text search on the home page (replaces the Make filter).
-- Idempotent: safe to run more than once. Drops no tables, columns or data.
-- place_bid is not touched.
-- =============================================================================

-- Supabase keeps extensions in the "extensions" schema; this file looks there too.
create schema if not exists extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists unaccent with schema extensions;
set search_path = public, extensions;
-- Supabase already allows this; repeated so the search functions work for everyone.
grant usage on schema extensions to anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Normalising text. Both columns and queries use these, so they always agree.
-- -----------------------------------------------------------------------------

-- Lowercase, no accents, any punctuation (hyphens, dots, slashes...) turned
-- into a single space between words: "Mercedes-AMG C 63 S" -> "mercedes amg c 63 s".
create or replace function public.search_spaced(t text)
returns text language sql stable set search_path = public, extensions as $$
  select trim(regexp_replace(lower(unaccent(coalesce(t, ''))), '[^a-z0-9]+', ' ', 'g'))
$$;

-- Everything removed, used to spot exact model matches: "RS 6" -> "rs6".
create or replace function public.search_compact(t text)
returns text language sql stable set search_path = public, extensions as $$
  select replace(public.search_spaced(t), ' ', '')
$$;

-- A 4-digit word between 1950 and next year is a model year.
create or replace function public.search_is_year(w text)
returns boolean language sql stable as $$
  select w ~ '^[0-9]{4}$' and w::int between 1950 and extract(year from now())::int + 1
$$;

-- Joins words where a letter meets a digit: {rs,6,avant} -> {"rs 6",avant},
-- {c,63,s} -> {"c 63 s"}. Model years are never joined ("bmw 2019" stays two
-- words). Joined words keep a space between their parts here; callers remove
-- it. Used for both the stored text and the query, so they always agree.
create or replace function public.search_join_words(p_words text[])
returns text[] language plpgsql stable as $$
declare
  v_out  text[] := '{}';
  v_t    text;
  v_last text;
  n      int;
begin
  foreach v_t in array coalesce(p_words, '{}') loop
    continue when v_t is null or v_t = '';
    n := coalesce(array_length(v_out, 1), 0);
    v_last := case when n > 0 then v_out[n] end;
    if v_last is not null
       and not public.search_is_year(v_t)
       and not public.search_is_year(regexp_replace(v_last, '^.* ', ''))
       and ((right(v_last, 1) ~ '[a-z]' and left(v_t, 1) ~ '[0-9]')
         or (right(v_last, 1) ~ '[0-9]' and left(v_t, 1) ~ '[a-z]')) then
      v_out[n] := v_last || ' ' || v_t;
    else
      v_out := v_out || v_t;
    end if;
  end loop;
  return v_out;
end $$;

-- search_spaced, then the space between a letter and a digit removed, so
-- "RS 6", "RS-6" and "RS.6" all become "rs6" and "C 63 S" becomes "c63s".
-- Other word boundaries stay: "audi rs6 avant 2020".
create or replace function public.search_normalize(t text)
returns text language sql stable set search_path = public, extensions as $$
  select coalesce(string_agg(replace(w, ' ', ''), ' ' order by i), '')
    from unnest(public.search_join_words(
           regexp_split_to_array(public.search_spaced(t), ' '))) with ordinality as x(w, i)
$$;

-- -----------------------------------------------------------------------------
-- Aliases: vw -> volkswagen, beemer -> bmw ... Everyone may read; only the
-- service role may change them.
-- -----------------------------------------------------------------------------
create table if not exists public.search_aliases (
  alias     text primary key,
  canonical text not null
);
alter table public.search_aliases enable row level security;
revoke all on public.search_aliases from anon, authenticated;
grant select on public.search_aliases to anon, authenticated;
grant all on public.search_aliases to service_role;

drop policy if exists "search aliases are public" on public.search_aliases;
create policy "search aliases are public" on public.search_aliases for select using (true);

insert into public.search_aliases (alias, canonical) values
  ('vw', 'volkswagen'),
  ('merc', 'mercedes'),
  ('mercedes', 'mercedes'),
  ('amg', 'mercedes amg'),
  ('beemer', 'bmw'),
  ('bimmer', 'bmw'),
  ('chevy', 'chevrolet'),
  ('landy', 'land rover'),
  ('rr', 'range rover'),
  ('alfa', 'alfa romeo')
on conflict (alias) do nothing;

-- -----------------------------------------------------------------------------
-- Query -> words: split, expand aliases, then join a letter part and a number
-- part typed apart ("c 63 s" -> "c63s", "m 3" -> "m3"), exactly like
-- search_normalize; model years stay separate, so "bmw 2019" is two words.
-- A joined word keeps its parts separated by a space ("c63 amg") so a search
-- can also accept the parts on their own (see search_word_condition).
-- At most 8 words.
-- -----------------------------------------------------------------------------
create or replace function public.search_query_words(p_query text)
returns text[] language plpgsql stable set search_path = public, extensions as $$
declare
  v_expanded text[] := '{}';
  v_t        text;
  v_canon    text;
begin
  if p_query is null or btrim(p_query) = '' then
    return '{}';
  end if;

  foreach v_t in array regexp_split_to_array(public.search_spaced(left(p_query, 200)), ' ') loop
    continue when v_t = '';
    select a.canonical into v_canon from public.search_aliases a where a.alias = v_t;
    if found then
      v_expanded := v_expanded || regexp_split_to_array(public.search_spaced(v_canon), ' ');
    else
      v_expanded := v_expanded || v_t;
    end if;
  end loop;

  -- Join letters and digits, drop repeated words, keep at most 8.
  return coalesce((
    select (array_agg(w order by first_i))[1:8]
      from (select w, min(i) as first_i
              from unnest(public.search_join_words(v_expanded)) with ordinality as x(w, i)
             group by w) d), '{}');
end $$;

-- SQL condition for one query word (only [a-z0-9 ] reaches here). A model
-- year matches the year exactly; any other word must appear in search_text.
-- A joined word ("c63 amg") also matches when each part of 2+ characters
-- appears on its own, so "c63 amg" finds "C63 S AMG" too.
create or replace function public.search_word_condition(p_word text, p_col text)
returns text language plpgsql stable set search_path = public, extensions as $$
declare
  v_parts text[] := regexp_split_to_array(p_word, ' ');
  v_cond  text;
  v_alt   text := '';
  v_p     text;
begin
  if p_word !~ '^[a-z0-9 ]+$' or p_col !~ '^[a-z_.]+$' then
    raise exception 'bad search word';
  end if;
  if public.search_is_year(p_word) then
    return format('%s.year = %s', split_part(p_col, '.', 1), p_word::int);
  end if;
  v_cond := format('%s like %L', p_col, '%' || replace(p_word, ' ', '') || '%');
  if cardinality(v_parts) > 1 and not exists (select 1 from unnest(v_parts) x where length(x) < 2) then
    foreach v_p in array v_parts loop
      v_alt := v_alt || format(' and %s like %L', p_col, '%' || v_p || '%');
    end loop;
    v_cond := format('(%s or (%s))', v_cond, substr(v_alt, 6));
  end if;
  return v_cond;
end $$;

-- -----------------------------------------------------------------------------
-- auctions.search_text (search_normalize: "audi rs6 avant ...") and
-- auctions.search_words (every word boundary kept: "audi rs 6 avant ..."),
-- built from make, model, variant, title and year by a trigger (unaccent isn't
-- immutable, so a generated column isn't possible).
-- -----------------------------------------------------------------------------
alter table public.auctions
  add column if not exists search_text  text,
  add column if not exists search_words text;

create or replace function public.auctions_search_fields()
returns trigger language plpgsql set search_path = public, extensions as $$
declare
  v_source text := concat_ws(' ', new.make, new.model, new.variant, new.title, new.year::text);
begin
  new.search_words := public.search_spaced(v_source);
  new.search_text  := public.search_normalize(v_source);
  return new;
end $$;

drop trigger if exists auctions_search_fields on public.auctions;
create trigger auctions_search_fields
  before insert or update of make, model, variant, title, year on public.auctions
  for each row execute function public.auctions_search_fields();

-- Backfill (also fixes rows from before this migration; safe to repeat).
update public.auctions
   set search_words = public.search_spaced(concat_ws(' ', make, model, variant, title, year::text)),
       search_text  = public.search_normalize(concat_ws(' ', make, model, variant, title, year::text))
 where search_text is distinct from public.search_normalize(concat_ws(' ', make, model, variant, title, year::text))
    or search_words is null;

create index if not exists auctions_search_text_trgm on public.auctions using gin (search_text gin_trgm_ops);

-- -----------------------------------------------------------------------------
-- search_auctions: the home page search. Security invoker, so RLS still applies.
-- Every word must match (AND): a model year matches the year exactly, any other
-- word must appear in search_text. Ordered like the tab, exact model matches
-- first. Words are reduced to [a-z0-9] before they reach the SQL text below.
-- Returns the card columns, the row's position and the total number of matches.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- search_suggestions: makes and make/model/variant combinations in listings
-- people can see (not drafts or rejected), with counts. Every non-year word
-- must match. Security invoker.
-- -----------------------------------------------------------------------------
create or replace function public.search_suggestions(p_query text, p_limit int default 6)
returns table (label text, make text, model text, variant text, listing_count bigint)
language plpgsql stable set search_path = public, extensions as $$
#variable_conflict use_column
declare
  v_words text[] := public.search_query_words(p_query);
  v_where text := '';
  v_w     text;
begin
  if cardinality(v_words) = 0 or length(btrim(coalesce(p_query, ''))) < 2 then
    return;
  end if;
  foreach v_w in array v_words loop
    continue when public.search_is_year(v_w);
    v_where := v_where || ' and ' || public.search_word_condition(v_w, 'g.normalized');
  end loop;

  return query execute format(
    'with base as (
       select a.make, a.model, a.variant,
              public.search_compact(a.make) as k_make,
              public.search_compact(a.model) as k_model,
              public.search_compact(a.variant) as k_variant
         from public.auctions a
        where a.status::text not in (''draft'', ''rejected'')
     ),
     g as (
       -- "RS 6" and "RS6" count as one; the most used spelling is shown.
       select mode() within group (order by b.make) as label,
              mode() within group (order by b.make) as make,
              null::text as model, null::text as variant, count(*) as n, 0 as kind
         from base b group by b.k_make
       union all
       select mode() within group (order by concat_ws('' '', b.make, b.model, b.variant)),
              mode() within group (order by b.make),
              mode() within group (order by b.model),
              mode() within group (order by b.variant),
              count(*), 1
         from base b group by b.k_make, b.k_model, b.k_variant
     )
     select g.label, g.make, g.model, g.variant, g.n
       from (select g.*, public.search_normalize(g.label) as normalized from g) g
      where true %1$s
      order by g.kind, g.n desc, g.label
      limit %2$s',
    v_where, least(greatest(coalesce(p_limit, 6), 1), 10));
end $$;

grant execute on function public.search_suggestions(text, int) to anon, authenticated;
