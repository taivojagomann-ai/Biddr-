#!/usr/bin/env bash
# Proves the migrations are idempotent, against the LOCAL test database only:
#   1. the local Supabase stack has already applied every migration once (supabase start);
#   2. this script applies every migration a second time, stopping at the first error;
#   3. the schema after the second pass must be identical to the schema after the first.
# It refuses to run against anything but 127.0.0.1 / localhost.
set -euo pipefail

DB_URL="${E2E_DB_URL:-postgresql://postgres:postgres@127.0.0.1:54322/postgres}"
case "$DB_URL" in
  *@127.0.0.1:*|*@localhost:*) ;;
  *) echo "Refusing to run: $DB_URL is not a local database." >&2; exit 1 ;;
esac

# psql and pg_dump from the database container, so the versions always match.
DB_CONTAINER="${E2E_DB_CONTAINER:-$(docker ps --format '{{.Names}}' | grep -E '^supabase_db_' | head -1)}"
if [ -z "$DB_CONTAINER" ]; then
  echo "The local Supabase database isn't running. Start it with: npx supabase start" >&2
  exit 1
fi
psql_local() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q "$@"; }
dump_schema() {
  docker exec "$DB_CONTAINER" pg_dump -U postgres -d postgres --schema-only --no-owner --no-privileges \
    --schema=public --schema=storage | grep -v '^--' | grep -v '^$' | grep -v '^\\\(un\)\?restrict '
}

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

dump_schema > "$work/first.sql"
echo "Applying every migration a second time…"
for f in supabase/migrations/*.sql; do
  echo "  $f"
  if ! psql_local < "$f" > "$work/out.log" 2>&1; then
    cat "$work/out.log" >&2
    echo "FAILED: $f can't be run twice." >&2
    exit 1
  fi
done
dump_schema > "$work/second.sql"

if ! diff -u "$work/first.sql" "$work/second.sql" > "$work/diff.txt"; then
  head -80 "$work/diff.txt" >&2
  echo "FAILED: running the migrations twice changed the schema." >&2
  exit 1
fi
echo "OK: every migration ran twice without errors and the schema didn't change."
