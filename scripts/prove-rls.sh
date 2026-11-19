#!/usr/bin/env bash
# Apply the migrations to a throwaway local database and prove the role rules.
# Refuses hosted Supabase URLs. Does not touch a database you are using for the app.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
db_name="${LSP_RLS_DATABASE:-lsp_os_rls}"

if [[ "${DATABASE_URL:-}" == *supabase.co* || "${DATABASE_URL:-}" == *supabase.com* ]]; then
  echo "Refusing to run the RLS proof against a hosted Supabase URL." >&2
  exit 1
fi

if [[ "$db_name" != lsp_os_rls* ]]; then
  echo "Refusing to drop database '$db_name'. Use a name that starts with lsp_os_rls." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required. Install PostgreSQL and run this again." >&2
  exit 1
fi

psql_as_postgres() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    psql "$DATABASE_URL" "$@"
    return
  fi
  sudo -u postgres psql "$@"
}

if [[ -z "${DATABASE_URL:-}" ]]; then
  if command -v pg_lsclusters >/dev/null 2>&1; then
    sudo pg_ctlcluster 16 main start >/dev/null 2>&1 || true
  fi
  echo "Recreating local database ${db_name}."
  psql_as_postgres -d postgres -v ON_ERROR_STOP=1 -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '${db_name}' and pid <> pg_backend_pid();" >/dev/null
  psql_as_postgres -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists ${db_name};"
  psql_as_postgres -d postgres -v ON_ERROR_STOP=1 -c "create database ${db_name};"
  target=(-d "$db_name")
else
  echo "Using DATABASE_URL. This script will apply migrations there."
  target=()
fi

run_sql() {
  psql_as_postgres "${target[@]}" -v ON_ERROR_STOP=1 -f "$1"
}

run_sql "$root/scripts/sql/auth_stub.sql"
for migration in "$root"/supabase/migrations/*.sql; do
  echo "Applying $(basename "$migration")"
  run_sql "$migration"
done

echo "Running RLS proof"
run_sql "$root/supabase/tests/rls_proof.sql"
echo "RLS proof passed."

echo "Running Board proof"
run_sql "$root/supabase/tests/board_proof.sql"
echo "Board proof passed."

echo "Running feedback proof"
run_sql "$root/supabase/tests/feedback_proof.sql"
echo "Feedback proof passed."

echo "Running visit proof"
run_sql "$root/supabase/tests/visit_proof.sql"
echo "Visit proof passed."

echo "Running v1 foundation proof"
run_sql "$root/supabase/tests/v1_foundation_proof.sql"
echo "v1 foundation proof passed."

echo "Running SMS consent proof"
run_sql "$root/supabase/tests/sms_consent_proof.sql"
echo "SMS consent proof passed."

echo "Running Setup people proof"
run_sql "$root/supabase/tests/setup_people_proof.sql"
echo "Setup people proof passed."

echo "Running multi-repair proof"
run_sql "$root/supabase/tests/multi_repair_proof.sql"
echo "Multi-repair proof passed."
