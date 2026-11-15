-- =============================================================================
-- Dealer sellers who inspect their own car. An authorised dealer that is also
-- the seller may inspect the car; the badge still applies, but the listing says
-- "Inspected by the selling dealer" instead of implying an independent check.
-- The admin confirms this with a checkbox when accepting the report.
-- Idempotent: safe to run more than once. No tables, columns or data are dropped.
-- place_bid is not touched.
-- =============================================================================

-- What the admin confirmed (admin-only table).
alter table public.auction_private
  add column if not exists inspected_by_seller boolean not null default false;

-- What buyers see. Only the server (service role) sets it: sellers' column
-- grants on auctions don't include it.
alter table public.auctions
  add column if not exists inspected_by_seller boolean not null default false;
