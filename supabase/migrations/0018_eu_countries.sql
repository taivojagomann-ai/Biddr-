-- =============================================================================
-- Market: all 27 EU countries (DECISIONS.md, point 2). Until now the country
-- type only allowed Estonia, Latvia and Lithuania, so sellers and bidders from
-- other EU countries couldn't complete a profile or list a car.
-- Idempotent: safe to run more than once. Nothing is dropped except the
-- registration_country check, which is replaced straight away by a wider one
-- (every existing row still passes). place_bid is not touched.
--
-- The type keeps its old name (baltic_country): renaming it isn't needed and
-- would touch every function that mentions it.
-- =============================================================================

alter type public.baltic_country add value if not exists 'AT';
alter type public.baltic_country add value if not exists 'BE';
alter type public.baltic_country add value if not exists 'BG';
alter type public.baltic_country add value if not exists 'HR';
alter type public.baltic_country add value if not exists 'CY';
alter type public.baltic_country add value if not exists 'CZ';
alter type public.baltic_country add value if not exists 'DK';
alter type public.baltic_country add value if not exists 'FI';
alter type public.baltic_country add value if not exists 'FR';
alter type public.baltic_country add value if not exists 'DE';
alter type public.baltic_country add value if not exists 'GR';
alter type public.baltic_country add value if not exists 'HU';
alter type public.baltic_country add value if not exists 'IE';
alter type public.baltic_country add value if not exists 'IT';
alter type public.baltic_country add value if not exists 'LU';
alter type public.baltic_country add value if not exists 'MT';
alter type public.baltic_country add value if not exists 'NL';
alter type public.baltic_country add value if not exists 'PL';
alter type public.baltic_country add value if not exists 'PT';
alter type public.baltic_country add value if not exists 'RO';
alter type public.baltic_country add value if not exists 'SK';
alter type public.baltic_country add value if not exists 'SI';
alter type public.baltic_country add value if not exists 'ES';
alter type public.baltic_country add value if not exists 'SE';

-- Where the car is registered: any EU country or outside the EU. 'other_eu'
-- stays valid for listings saved before this migration.
alter table public.auctions drop constraint if exists auctions_registration_country_check;
alter table public.auctions add constraint auctions_registration_country_check
  check (registration_country is null or registration_country in (
    'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE',
    'IT','LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE',
    'other_eu', 'non_eu'));
