#!/usr/bin/env bash
# Security & integration regression suite on a FRESH disposable QA stack (CI, or a newly started
# local stack). Never run it against the commercial demo or a hosted project: every step below
# refuses anything other than the QA ports (55321 API / 55322 DB).
#
#   supabase start --workdir scripts/qa -x studio,imgproxy,vector,logflare,supavisor,edge-runtime,mailpit,storage-api,postgres-meta
#   bash scripts/qa/security-suite.sh
#
# Steps (any failure stops the suite with a non-zero exit, which blocks the merge in CI):
#   1. apply every migration from zero with the same tool as production (drizzle-kit migrate)
#   2. journal/tracker/hash integrity and SQL-first policy (scripts/qa/check-migrations.mjs)
#   2b. the new database holds no organization at all: no fictional tenants (migration 0021)
#   3. SQL fixtures: prices/tax/stock/COGS/idempotence/reversal/RLS/store scope/anon,
#      movement idempotence/consent/auth, purchase receipts/transfer conservation,
#      0022 cross-organization store scope and organization features (rolled back)
#   4. seed the isolated QA tenant (two stores, six profiles, second tenant)
#   5. permission matrix: six profiles x store scope x tenant isolation x inventory costs
#   5b. 0022 equivalence on the seeded data: every member x permission x store gives the 0019
#      answer in its own organization and is refused for stores of another organization
#   5c. 0025 concurrency: a sale and a store rate change in two PostgreSQL sessions are serialized
#      (FOR SHARE / FOR UPDATE); no sale is recorded with a rate the server did not validate
#      (own isolated organization, store and synthetic members, removed at the end)
#   6. demo reconstruction: seed-demo-orgs.sql twice, MARAO and Harbor match the demo, no duplicates
#   7. order history paging against the database: every order exactly once (ties, >200, 5,000 cap,
#      sales created mid-read), totals match the table; kitchen board: every open ticket once with
#      >100 newer orders, realtime events of the own organization only (each file in its own
#      isolated organization, fixed timestamps, run in parallel)
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
run_sql() {
  if command -v psql >/dev/null; then psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$1"
  else docker exec -i "supabase_db_${QA_PROJECT}" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 < "$1"; fi
}
# Runs a check file and requires its PASS line.
run_check() {
  out=$(run_sql "$1" 2>&1) || { echo "$out" | tail -5; echo "FAIL $1"; exit 1; }
  echo "$out" | grep -E "PASS" || { echo "$out" | tail -5; echo "FAIL $1 (no PASS line)"; exit 1; }
}

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
for f in reconstructed_operations reconstructed_hardening reconstructed_purchases permission_scope_features recipe_product_and_metadata store_sales_tax; do
  run_check "scripts/security/$f.sql"
done
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

echo "::group::6. demo reconstruction"
for run in 1 2; do
  out=$(run_sql scripts/seeds/demo/seed-demo-orgs.sql 2>&1) || { echo "$out" | tail -5; echo "FAIL demo seed run $run"; exit 1; }
  echo "  seed run $run: $(echo "$out" | grep -o "demo organizations present: .*")"
done
run_check scripts/security/demo_seed_rebuild.sql
echo "::endgroup::"
echo "::group::7. order history and kitchen board against the database"
# Each file works only in organizations it creates and removes (scripts/qa/isolated-org.mjs), so
# the files run in parallel (vitest default) and nothing the earlier steps recorded can interfere.
QA_PAGING_DB=1 SB_URL="$API_URL" SB_ANON="$ANON_KEY" CREDS_FILE="$CREDS_FILE" QA_DB_URL="$DB_URL" \
  QA_PROJECT="$QA_PROJECT" npx --no-install vitest run \
  src/test/integration/orders-paging.db.test.ts src/test/integration/kds-board.db.test.ts
echo "::endgroup::"
rm -f "$CREDS_FILE"
echo "Security suite passed."
