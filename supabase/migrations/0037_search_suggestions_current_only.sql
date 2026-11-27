-- 0037: past results are no longer shown publicly (DECISIONS.md point 9), so search
-- suggestions only offer makes and models of upcoming and live listings; a suggestion
-- never leads to "no results" because the only matching car has ended.
-- Safe to run more than once (create or replace); no data changes.

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
        where a.status::text in (''upcoming'', ''live'')
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
