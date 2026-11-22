-- =============================================================================
-- 0033: The code the challenge photos were taken with (DECISIONS.md point 16).
--
-- The registration certificate can be added any time, before or after the photos.
-- The checks compare the code on the photos with the code they were taken with,
-- not with the latest code, so asking for a new code later doesn't make the photos
-- already sent fail. Older rows keep null and fall back to the latest code.
--
-- Idempotent: safe to run more than once. Nothing is dropped.
-- =============================================================================

alter table public.listing_verifications add column if not exists photos_code text;
