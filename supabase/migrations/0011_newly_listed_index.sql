-- =============================================================================
-- Home page "Newly listed" tab: live auctions by starts_at, newest first.
-- The existing (status, ends_at) index doesn't cover ordering by start time; this
-- one serves "Newly listed" (status = 'live', starts_at desc) and "Coming up"
-- (status = 'upcoming', starts_at asc, read backwards).
-- Idempotent: safe to run more than once. No data changes.
-- =============================================================================
create index if not exists auctions_status_starts_idx on public.auctions (status, starts_at desc);
