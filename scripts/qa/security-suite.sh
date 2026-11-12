#!/usr/bin/env bash
# Security & integration regression suite on a FRESH disposable QA stack (CI, or a newly started
# local stack). Never run it against the commercial demo or a hosted project: every step below
# refuses anything other than the QA ports (55321 API / 55322 DB).
#
# Those ports and the project id (dq-rebuild) are also the ones of the PERSISTENT local QA stack, so
# step 0 refuses any database that is not new and empty (no migration tracker, no application
# table): the persistent QA, a stack the suite already ran on, or anything restored into one.
#
#   supabase start --workdir scripts/qa -x studio,imgproxy,vector,logflare,supavisor,edge-runtime,mailpit,storage-api,postgres-meta
#   bash scripts/qa/security-suite.sh
#
# Steps (any failure stops the suite with a non-zero exit, which blocks the merge in CI):
#   0. the target database is new and empty (see above)
#   1. apply every migration from zero with the same tool as production (drizzle-kit migrate)
#   2. journal/tracker/hash integrity and SQL-first policy (scripts/qa/check-migrations.mjs)
#   2b. the new database holds no organization at all: no fictional tenants (migration 0021)
#   3. SQL fixtures: prices/tax/stock/COGS/idempotence/reversal/RLS/store scope/anon,
#      movement idempotence/consent/auth, purchase receipts/transfer conservation,
#      0022 cross-organization store scope and organization features, 0024 recipes, 0025 store tax,
#      0026 menu category archive, 0028/0029 category deactivation through the save closed, 0029
#      category intents create/update/reactivate. Every fixture runs in one transaction that ends in
#      ROLLBACK; the operations fixture uses fresh ids on every run and refuses to run without the
#      opt-in this runner sets (dinequora.fixture_target=disposable)
#   3b. the operations fixture leaves nothing behind when it is interrupted by an error, when rows
#      with the literal ids of its former version already exist, when it is run without the opt-in
#      (refused) and when it is run again: every table of public and auth keeps its exact row count
#   4. seed the isolated QA tenant (two stores, six profiles, second tenant)
#   5. permission matrix: six profiles x store scope x tenant isolation x inventory costs
#   5b. 0022 equivalence on the seeded data: every member x permission x store gives the 0019
#      answer in its own organization and is refused for stores of another organization
#   5c. 0025 concurrency: a sale and a store rate change in two PostgreSQL sessions are serialized
#      (FOR SHARE / FOR UPDATE); no sale is recorded with a rate the server did not validate
#      (own isolated organization, store and synthetic members, removed at the end)
#   5d. 0027 concurrency: saving a menu product and archiving its category in two PostgreSQL
#      sessions are serialized in both orders, with COMMIT and ROLLBACK (FOR SHARE / FOR UPDATE);
#      never an active product in an archived category (own isolated organization, removed at the end)
#   5e. 0028/0029: deactivating a category through the save is refused at once (invalid_menu), and
#      saving a menu product while the category is edited ("update") serializes in both orders, with
#      COMMIT and ROLLBACK (own isolated organization, removed at the end)
#   5f. 0029 concurrency: category intents in two PostgreSQL sessions (create x create, create x
#      archive, update x archive, update x reactivate, reactivate x reactivate, archive x product
#      activation): no overwrite, no implicit re-activation, the audit trail holds exactly the
#      committed operations (own isolated organization, removed at the end)
#   6. demo reconstruction: seed-demo-orgs.sql twice, MARAO and Harbor match the demo, no duplicates
#   7. order history paging against the database: every order exactly once (ties, >200, 5,000 cap,
#      sales created mid-read), totals match the table; kitchen board: every open ticket once with
#      >100 newer orders, realtime events of the own organization only (each file in its own
#      isolated organization, fixed timestamps, run in parallel); menu categories archived through
#      PostgREST by signed-in members (0026)
set -euo pipefail
cd "$(dirname "$0")/../.."

eval "$(supabase status --workdir scripts/qa -o env 2>/dev/null | grep -E '^(API_URL|DB_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
[[ "${API_URL:-}" =~ ^http://(127\.0\.0\.1|localhost):55321$ ]] || { echo "Refusing: QA API must be on 55321 (got '${API_URL:-}')"; exit 2; }
[[ "${DB_URL:-}" =~ @(127\.0\.0\.1|localhost):55322/postgres$ ]] || { echo "Refusing: QA DB must be on 55322"; exit 2; }

ARTIFACTS="${QA_ARTIFACTS:-$(mktemp -d)}"
mkdir -p "$ARTIFACTS"
CREDS_FILE="$ARTIFACTS/qa-credentials.json"   # generated passwords; never printed, never committed
[[ -e "$CREDS_FILE" ]] && { echo "Refusing: $CREDS_FILE exists (suite needs a fresh stack)"; exit 2; }

# psql on the runner; locally (no psql installed) the one inside the QA db container.
QA_PROJECT=$(sed -n 's/^project_id = "\(.*\)"/\1/p' scripts/qa/supabase/config.toml)
# One psql session on the QA database, reading stdin; PGOPTIONS is passed through.
psql_target() {
  if command -v psql >/dev/null; then psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"
  else docker exec -i -e PGOPTIONS="${PGOPTIONS:-}" "supabase_db_${QA_PROJECT}" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; fi
}
# The SQL fixtures refuse to run without this opt-in; it is only used after the step 0 check.
FIXTURE_OPT_IN="-c dinequora.fixture_target=disposable"
run_sql() { # file [psql args...]
  local f="$1"; shift
  PGOPTIONS="$FIXTURE_OPT_IN" psql_target "$@" < "$f"
}
sql_value() { PGOPTIONS="" psql_target -At -c "$1"; }
# Exact row count of every table of public and auth, on one line: the "nothing changed" baseline.
TABLE_COUNTS_SQL="select string_agg(format('%s.%s=%s', table_schema, table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text), ',' order by table_schema, table_name) from information_schema.tables where table_schema in ('public', 'auth') and table_type = 'BASE TABLE'"
table_counts() { sql_value "$TABLE_COUNTS_SQL"; }
# Runs a check file and requires its PASS line.
run_check() {
  out=$(run_sql "$1" 2>&1) || { echo "$out" | tail -5; echo "FAIL $1"; exit 1; }
  echo "$out" | grep -E "PASS" || { echo "$out" | tail -5; echo "FAIL $1 (no PASS line)"; exit 1; }
}

echo "::group::0. target is a new, empty database"
state=$(sql_value "select coalesce(to_regclass('drizzle.__drizzle_migrations')::text, '-') || ' ' || coalesce(to_regclass('public.organizations')::text, '-')")
[[ "$state" == "- -" ]] || {
  echo "Refusing: this database is not new and empty (found: $state). The suite applies every migration"
  echo "and writes test data: it runs only on a freshly started disposable stack, never on the persistent QA."
  exit 2
}
echo "  new and empty"
echo "::endgroup::"

echo "::group::1. migrations from zero"
LOVABLE_DB_MIGRATION_URL="$DB_URL" npx --no-install drizzle-kit migrate 2>&1 | grep -E "applied|error|Error" || true
echo "::endgroup::"

echo "::group::2. migration integrity"
DB_URL="$DB_URL" node scripts/qa/check-migrations.mjs
echo "::endgroup::"

echo "::group::2b. new database without fictional organizations"
run_check scripts/security/fresh_database_no_demo.sql
echo "::endgroup::"

echo "::group::3. SQL security fixtures"
for f in reconstructed_operations permission_scope_features recipe_product_and_metadata store_sales_tax menu_archive menu_category_deactivate menu_category_intent; do
  run_check "scripts/security/$f.sql"
done
echo "::endgroup::"

echo "::group::3b. an interrupted, colliding, refused or repeated fixture run leaves nothing behind"
before=$(table_counts)
same_counts() { [[ "$(table_counts)" == "$before" ]] || { echo "FAIL $1 changed rows"; exit 1; }; }
# a) it fails on purpose after every one of its writes
if run_sql scripts/security/reconstructed_operations.sql -v fixture_interrupt=1 > "$ARTIFACTS/fixture-interrupted.txt" 2>&1; then
  echo "FAIL the interrupted fixture run did not fail"; exit 1
fi
grep -q "fixture interrupted on purpose" "$ARTIFACTS/fixture-interrupted.txt" \
  || { tail -5 "$ARTIFACTS/fixture-interrupted.txt"; echo "FAIL interrupted run failed for another reason"; exit 1; }
same_counts "the interrupted fixture run"
echo "  interrupted run: failed as asked, no row left"
# b) rows with the former literal ids exist (same transaction): it still passes, nothing is left
cat scripts/security/fixture_legacy_ids.sql scripts/security/reconstructed_operations.sql > "$ARTIFACTS/fixture-over-legacy-ids.sql"
run_check "$ARTIFACTS/fixture-over-legacy-ids.sql"
same_counts "the fixture run over the former literal ids"
echo "  run over the former literal ids: PASS, no row left"
# c) without the opt-in it refuses before writing anything
if PGOPTIONS="" psql_target < scripts/security/reconstructed_operations.sql > "$ARTIFACTS/fixture-no-opt-in.txt" 2>&1; then
  echo "FAIL the fixture ran without the opt-in"; exit 1
fi
grep -q "refused: this fixture runs only through" "$ARTIFACTS/fixture-no-opt-in.txt" \
  || { tail -5 "$ARTIFACTS/fixture-no-opt-in.txt"; echo "FAIL no-opt-in run failed for another reason"; exit 1; }
same_counts "the refused fixture run"
echo "  run without the opt-in: refused, no row changed"
# d) a second full run passes again (fresh ids on every run)
run_check scripts/security/reconstructed_operations.sql
same_counts "the repeated fixture run"
echo "  repeated run: PASS, no row left"
echo "::endgroup::"

echo "::group::4. QA tenant"
SB_URL="$API_URL" SB_ANON="$ANON_KEY" SB_SERVICE="$SERVICE_ROLE_KEY" CREDS_FILE="$CREDS_FILE" \
  node scripts/qa/seed-qa-org.mjs
echo "::endgroup::"

echo "::group::5. permission matrix"
SB_URL="$API_URL" SB_ANON="$ANON_KEY" SB_SERVICE="$SERVICE_ROLE_KEY" CREDS_FILE="$CREDS_FILE" \
  node scripts/security/permission_matrix.mjs | tee "$ARTIFACTS/permission-matrix.txt" | grep -v "^PASS"
echo "::endgroup::"

echo "::group::5b. permission equivalence (0022)"
run_check scripts/security/permission_equivalence.sql
echo "::endgroup::"

echo "::group::5c. sale vs rate change concurrency (0025, two PostgreSQL sessions)"
QA_DB_URL="$DB_URL" node scripts/security/tax_rate_concurrency.mjs | tee "$ARTIFACTS/tax-rate-concurrency.txt" | grep -v "^PASS"
echo "::endgroup::"

echo "::group::5d. menu product save vs category archive concurrency (0027, two PostgreSQL sessions)"
QA_DB_URL="$DB_URL" node scripts/security/menu_category_race.mjs | tee "$ARTIFACTS/menu-category-race.txt" | grep -v "^PASS"
echo "::endgroup::"

echo "::group::5e. category deactivation through the save closed; product save vs category edit (0028/0029, two PostgreSQL sessions)"
QA_DB_URL="$DB_URL" node scripts/security/menu_category_deactivate_race.mjs | tee "$ARTIFACTS/menu-category-deactivate-race.txt" | grep -v "^PASS"
echo "::endgroup::"

echo "::group::5f. category intents concurrency (0029, two PostgreSQL sessions)"
QA_DB_URL="$DB_URL" node scripts/security/menu_category_intent_race.mjs | tee "$ARTIFACTS/menu-category-intent-race.txt" | grep -v "^PASS"
echo "::endgroup::"

echo "::group::6. demo reconstruction"
for run in 1 2; do
  out=$(run_sql scripts/seeds/demo/seed-demo-orgs.sql 2>&1) || { echo "$out" | tail -5; echo "FAIL demo seed run $run"; exit 1; }
  echo "  seed run $run: $(echo "$out" | grep -o "demo organizations present: .*")"
done
run_check scripts/security/demo_seed_rebuild.sql
echo "::endgroup::"
echo "::group::7. order history, kitchen board and menu archive against the database"
# Each file works only in organizations it creates and removes (scripts/qa/isolated-org.mjs), so
# the files run in parallel (vitest default) and nothing the earlier steps recorded can interfere.
QA_PAGING_DB=1 SB_URL="$API_URL" SB_ANON="$ANON_KEY" CREDS_FILE="$CREDS_FILE" QA_DB_URL="$DB_URL" \
  QA_PROJECT="$QA_PROJECT" npx --no-install vitest run \
  src/test/integration/orders-paging.db.test.ts src/test/integration/kds-board.db.test.ts \
  src/test/integration/menu-archive.db.test.ts
echo "::endgroup::"
rm -f "$CREDS_FILE"
echo "Security suite passed."
