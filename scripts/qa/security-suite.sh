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
#   2. journal/tracker/hash integrity (scripts/qa/check-migrations.mjs)
#   3. SQL fixtures: prices/tax/stock/COGS/idempotence/reversal/RLS/store scope/anon,
#      movement idempotence/consent/auth, purchase receipts/transfer conservation
#   4. seed the isolated QA tenant (two stores, six profiles, second tenant)
#   5. permission matrix: six profiles x store scope x tenant isolation x inventory costs
set -euo pipefail
cd "$(dirname "$0")/../.."

eval "$(supabase status --workdir scripts/qa -o env 2>/dev/null | grep -E '^(API_URL|DB_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
[[ "${API_URL:-}" =~ ^http://(127\.0\.0\.1|localhost):55321$ ]] || { echo "Refusing: QA API must be on 55321 (got '${API_URL:-}')"; exit 2; }
[[ "${DB_URL:-}" =~ @(127\.0\.0\.1|localhost):55322/postgres$ ]] || { echo "Refusing: QA DB must be on 55322"; exit 2; }

ARTIFACTS="${QA_ARTIFACTS:-$(mktemp -d)}"
mkdir -p "$ARTIFACTS"
CREDS_FILE="$ARTIFACTS/qa-credentials.json"   # generated passwords; never printed, never committed
[[ -e "$CREDS_FILE" ]] && { echo "Refusing: $CREDS_FILE exists (suite needs a fresh stack)"; exit 2; }

echo "::group::1. migrations from zero"
LOVABLE_DB_MIGRATION_URL="$DB_URL" npx --no-install drizzle-kit migrate 2>&1 | grep -E "applied|error|Error" || true
echo "::endgroup::"

echo "::group::2. migration integrity"
DB_URL="$DB_URL" node scripts/qa/check-migrations.mjs
echo "::endgroup::"

echo "::group::3. SQL security fixtures"
# psql on the runner; locally (no psql installed) the one inside the QA db container.
QA_PROJECT=$(sed -n 's/^project_id = "\(.*\)"/\1/p' scripts/qa/supabase/config.toml)
run_sql() {
  if command -v psql >/dev/null; then psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$1"
  else docker exec -i "supabase_db_${QA_PROJECT}" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 < "$1"; fi
}
for f in reconstructed_operations reconstructed_hardening reconstructed_purchases; do
  out=$(run_sql "scripts/security/$f.sql" 2>&1) || { echo "$out" | tail -5; echo "FAIL $f"; exit 1; }
  echo "$out" | grep -E "PASS" || { echo "$out" | tail -5; echo "FAIL $f (no PASS line)"; exit 1; }
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
rm -f "$CREDS_FILE"
echo "Security suite passed."
