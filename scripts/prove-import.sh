#!/usr/bin/env bash
# Load the price book, properties, and old history into a throwaway database.
# Proves the counts reconcile, a second run writes nothing, and a later
# property is picked up as a link without copying the calls onto the Board.
# Refuses a hosted Supabase URL.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
db_name="${LSP_IMPORT_DATABASE:-lsp_os_import}"

if [[ "${DATABASE_URL:-}" == *supabase.co* || "${DATABASE_URL:-}" == *supabase.com* || "${SUPABASE_DB_URL:-}" == *supabase.co* || "${SUPABASE_DB_URL:-}" == *supabase.com* ]]; then
  echo "Refusing to run the import proof against a hosted Supabase URL." >&2
  exit 1
fi

if [[ "$db_name" != lsp_os_import* ]]; then
  echo "Refusing to drop database '$db_name'. Use a name that starts with lsp_os_import." >&2
  exit 1
fi

if ! command -v psql >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
  echo "psql and node are required." >&2
  exit 1
fi

if command -v pg_ctlcluster >/dev/null 2>&1; then
  sudo pg_ctlcluster 16 main start >/dev/null 2>&1 || true
fi

echo "Recreating local database ${db_name}."
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -c "select pg_terminate_backend(pid) from pg_stat_activity where datname = '${db_name}' and pid <> pg_backend_pid();" >/dev/null
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -c "drop database if exists ${db_name};"
sudo -u postgres psql -d postgres -v ON_ERROR_STOP=1 -c "create database ${db_name};"

sudo -u postgres psql -d "$db_name" -v ON_ERROR_STOP=1 -f "$root/scripts/sql/auth_stub.sql" >/dev/null
for migration in "$root"/supabase/migrations/*.sql; do
  echo "Applying $(basename "$migration")"
  sudo -u postgres psql -d "$db_name" -v ON_ERROR_STOP=1 -f "$migration" >/dev/null
done

run_import() {
  sudo -u postgres env \
    PATH="$PATH" \
    HOME="${HOME}" \
    PGHOST=/var/run/postgresql \
    PGUSER=postgres \
    PGDATABASE="$db_name" \
    node "$root/scripts/import/run-all.mjs" "$@"
}

psql_db() {
  sudo -u postgres psql -d "$db_name" -v ON_ERROR_STOP=1 -c "$1"
}

echo "First load"
run_import --fresh

echo "Second load should change nothing"
run_import --fresh --expect-noop

echo "A rerun must not overwrite a price or a contract term Matt already edited"
psql_db "update public.customers set payment_terms_days = 45 where name = 'Wynnefield Properties';"
psql_db "update public.bundles set target_price_cents = 1 where code = 'AHU - Capacitor - Replace';"
run_import --expect-noop
terms="$(sudo -u postgres psql -d "$db_name" -tA -c "select payment_terms_days from public.customers where name = 'Wynnefield Properties';")"
price="$(sudo -u postgres psql -d "$db_name" -tA -c "select target_price_cents from public.bundles where code = 'AHU - Capacitor - Replace';")"
if [[ "$terms" != "45" || "$price" != "1" ]]; then
  echo "Rerun overwrote edited data (terms=${terms}, price=${price})." >&2
  exit 1
fi

echo "Adding a property that history already names should only relink"
psql_db "insert into public.properties (customer_id, name, address_line1, city, state, zip)
  select id, 'Forest Park Crossing', 'Address not on file', 'Unknown', 'NC', '27000'
  from public.customers where name = 'Wynnefield Properties';"
run_import
open_links="$(sudo -u postgres psql -d "$db_name" -tA -c "select count(*) from public.legacy_imports where property_name = 'Forest Park Crossing' and property_id is null;")"
if [[ "$open_links" != "0" ]]; then
  echo "Forest Park Crossing still has ${open_links} unlinked calls." >&2
  exit 1
fi

echo "After the relink, another run should change nothing"
run_import --expect-noop

echo "Crew can read history. A signed-in user cannot insert it."
sudo -u postgres psql -d "$db_name" -v ON_ERROR_STOP=1 <<'SQL'
begin;
insert into auth.users (id, email)
values ('11111111-1111-4111-8111-111111111111', 'tech@lsp.test');
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
do $proof$
declare
  n integer;
begin
  select count(*) into n from public.legacy_imports;
  if n < 1 then
    raise exception 'FAIL: a tech cannot read imported history';
  end if;
  begin
    insert into public.legacy_imports (
      source_key, source_file, source_row, customer_name, property_name, job_on
    ) values ('proof', 'proof', 1, 'Proof', 'Proof', '2020-01-01');
    raise exception 'FAIL: a signed-in user inserted history';
  exception
    when insufficient_privilege then
      null;
  end;
end
$proof$;
rollback;
SQL

echo "Clock time stays on the America/New_York calendar date"
when="$(sudo -u postgres psql -d "$db_name" -tA -c "select to_char(occurred_at at time zone 'America/New_York', 'YYYY-MM-DD HH24:MI') from public.legacy_imports where property_name = 'Abbey Crossing' and unit_label = '405/4D' and total_cents = 138081;")"
if [[ "$when" != "2025-06-06 13:19" ]]; then
  echo "Abbey Crossing 405/4D was stored as '${when}', expected 2025-06-06 13:19." >&2
  exit 1
fi

board="$(sudo -u postgres psql -d "$db_name" -tA -c "select count(*) from public.service_requests;")"
if [[ "$board" != "0" ]]; then
  echo "History created ${board} Board cards." >&2
  exit 1
fi

echo "Import proof passed."
