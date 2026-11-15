-- =============================================================================
-- Biddr: admins need two-step verification.
-- is_admin() (used by row-level security and the database functions) is true
-- only when the admin's session has passed two-step verification (the JWT's
-- "aal" claim is "aal2"). An admin signed in with only Google or email is
-- treated like any member until they enter the code from their authenticator.
-- Idempotent: safe to run more than once. Nothing is dropped. place_bid is not touched.
-- =============================================================================

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
     and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;
