-- =============================================================================
-- service_role privileges
-- Server code (getAdminSupabase) uses the service role. Make sure it can reach
-- every table, sequence and function in public, now and for objects created by
-- later migrations. Safe to run more than once.
-- (Already applied manually in production.)
-- =============================================================================

grant usage on schema public to service_role;

grant all     on all tables    in schema public to service_role;
grant all     on all sequences in schema public to service_role;
grant execute on all functions in schema public to service_role;

alter default privileges in schema public grant all     on tables    to service_role;
alter default privileges in schema public grant all     on sequences to service_role;
alter default privileges in schema public grant execute on functions to service_role;
