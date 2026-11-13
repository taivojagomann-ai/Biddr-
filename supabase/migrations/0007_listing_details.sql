-- =============================================================================
-- Structured listing details: highlights, equipment, modifications, known flaws,
-- service history, items included, ownership, seller type, registration.
-- Idempotent: safe to run more than once. Drops no tables, columns or data
-- (only this file's own check constraints are dropped and re-created).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Validators. Check constraints can't use subqueries, so the per-item rules
-- live in immutable functions the constraints call.
-- -----------------------------------------------------------------------------

-- A JSON array of at most max_items strings, each at most max_len characters.
create or replace function public.biddr_text_list_ok(j jsonb, max_items integer, max_len integer)
returns boolean language sql immutable as $$
  select j is null or (
    jsonb_typeof(j) = 'array'
    and jsonb_array_length(j) <= max_items
    and not exists (
      select 1 from jsonb_array_elements(j) e
       where jsonb_typeof(e) <> 'string' or char_length(e #>> '{}') > max_len
    )
  )
$$;

-- A JSON array of at most 40 rows like
-- { "date": "2024-05", "mileage_km": 48500, "description": "...", "workshop": "..." }.
create or replace function public.biddr_service_history_ok(j jsonb)
returns boolean language sql immutable as $$
  select j is null or (
    jsonb_typeof(j) = 'array'
    and jsonb_array_length(j) <= 40
    and not exists (
      select 1 from jsonb_array_elements(j) e
       where jsonb_typeof(e) <> 'object'
          or coalesce(e ->> 'date', '') !~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
          or jsonb_typeof(e -> 'mileage_km') <> 'number'
          or (e ->> 'mileage_km')::numeric not between 0 and 2000000
          or jsonb_typeof(e -> 'description') <> 'string'
          or char_length(e ->> 'description') not between 1 and 300
          or (e ? 'workshop' and jsonb_typeof(e -> 'workshop') not in ('string', 'null'))
          or char_length(coalesce(e ->> 'workshop', '')) > 300
    )
  )
$$;

-- -----------------------------------------------------------------------------
-- Columns
-- -----------------------------------------------------------------------------
alter table public.auctions
  add column if not exists body_style            text,
  add column if not exists interior_color        text,
  add column if not exists seller_type           text not null default 'private',
  add column if not exists dealer_name           text,
  add column if not exists dealer_registry_code  text,
  add column if not exists registration_country  text,
  add column if not exists is_registered         boolean,
  add column if not exists owner_count           smallint,
  add column if not exists highlights            jsonb not null default '[]'::jsonb,
  add column if not exists equipment             jsonb not null default '[]'::jsonb,
  add column if not exists modifications         jsonb not null default '[]'::jsonb,
  add column if not exists known_flaws           jsonb not null default '[]'::jsonb,
  add column if not exists items_included        jsonb not null default '[]'::jsonb,
  add column if not exists no_known_flaws        boolean not null default false,
  add column if not exists no_modifications      boolean not null default false,
  add column if not exists service_history       jsonb not null default '[]'::jsonb,
  add column if not exists seller_notes          text,
  add column if not exists editor_take           text;

-- -----------------------------------------------------------------------------
-- Constraints (named, so re-running replaces them instead of duplicating)
-- -----------------------------------------------------------------------------
alter table public.auctions drop constraint if exists auctions_body_style_check;
alter table public.auctions add constraint auctions_body_style_check
  check (body_style is null or body_style in ('coupe', 'sedan', 'estate', 'hatchback', 'convertible', 'suv', 'other'));

alter table public.auctions drop constraint if exists auctions_interior_color_check;
alter table public.auctions add constraint auctions_interior_color_check
  check (interior_color is null or char_length(interior_color) <= 60);

alter table public.auctions drop constraint if exists auctions_seller_type_check;
alter table public.auctions add constraint auctions_seller_type_check
  check (seller_type in ('private', 'dealer'));

alter table public.auctions drop constraint if exists auctions_dealer_details_check;
alter table public.auctions add constraint auctions_dealer_details_check
  check (
    (dealer_name is null or char_length(dealer_name) <= 120)
    and (dealer_registry_code is null or char_length(dealer_registry_code) <= 40)
  );

alter table public.auctions drop constraint if exists auctions_registration_country_check;
alter table public.auctions add constraint auctions_registration_country_check
  check (registration_country is null or registration_country in ('EE', 'LV', 'LT', 'other_eu', 'non_eu'));

alter table public.auctions drop constraint if exists auctions_owner_count_check;
alter table public.auctions add constraint auctions_owner_count_check
  check (owner_count is null or owner_count between 1 and 30);

alter table public.auctions drop constraint if exists auctions_highlights_check;
alter table public.auctions add constraint auctions_highlights_check check (public.biddr_text_list_ok(highlights, 40, 300));

alter table public.auctions drop constraint if exists auctions_equipment_check;
alter table public.auctions add constraint auctions_equipment_check check (public.biddr_text_list_ok(equipment, 40, 300));

alter table public.auctions drop constraint if exists auctions_modifications_check;
alter table public.auctions add constraint auctions_modifications_check check (public.biddr_text_list_ok(modifications, 40, 300));

alter table public.auctions drop constraint if exists auctions_known_flaws_check;
alter table public.auctions add constraint auctions_known_flaws_check check (public.biddr_text_list_ok(known_flaws, 40, 300));

alter table public.auctions drop constraint if exists auctions_items_included_check;
alter table public.auctions add constraint auctions_items_included_check check (public.biddr_text_list_ok(items_included, 40, 300));

alter table public.auctions drop constraint if exists auctions_service_history_check;
alter table public.auctions add constraint auctions_service_history_check check (public.biddr_service_history_ok(service_history));

alter table public.auctions drop constraint if exists auctions_seller_notes_check;
alter table public.auctions add constraint auctions_seller_notes_check
  check (seller_notes is null or char_length(seller_notes) <= 2000);

alter table public.auctions drop constraint if exists auctions_editor_take_check;
alter table public.auctions add constraint auctions_editor_take_check
  check (editor_take is null or char_length(editor_take) <= 1500);

-- -----------------------------------------------------------------------------
-- Grants: sellers may write everything above except editor_take ("Biddr's take"),
-- which only admins write (through the service role). Column grants are additive.
-- -----------------------------------------------------------------------------
grant insert (body_style, interior_color, seller_type, dealer_name, dealer_registry_code, registration_country,
              is_registered, owner_count, highlights, equipment, modifications, known_flaws, items_included,
              no_known_flaws, no_modifications, service_history, seller_notes)
  on public.auctions to authenticated;
grant update (body_style, interior_color, seller_type, dealer_name, dealer_registry_code, registration_country,
              is_registered, owner_count, highlights, equipment, modifications, known_flaws, items_included,
              no_known_flaws, no_modifications, service_history, seller_notes)
  on public.auctions to authenticated;
