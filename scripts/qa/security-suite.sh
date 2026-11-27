#!/usr/bin/env bash
# Security & integration regression suite on a FRESH disposable stack (CI, or a newly started local
# stack from scripts/qa: project dq-ci, ports 6442x, its own identity). It never relies on ports or
# names: step 0 claims the database with the target guard (scripts/guard/target-guard.mjs), which
# accepts only a NEW, EMPTY local database of a cluster that is not protected, and every script below
# re-checks that marker through the channel it writes with. The persistent QA, the demo, a stack the
# suite already ran on, a restored copy and any hosted project are refused.
#
#   supabase start --workdir scripts/qa -x studio,imgproxy,vector,logflare,supavisor,edge-runtime,mailpit,storage-api,postgres-meta
#   bash scripts/qa/security-suite.sh
#
# Steps (any failure stops the suite with a non-zero exit, which blocks the merge in CI):
#   0a. direct runs on the still unmarked new database are refused and change nothing: QA seed,
#      permission matrix, a race script, an integration test, a fixture, the demo seed, and the
#      generic overrides that used to exist (ALLOW_DEMO_WRITES, the PR #22 fixture opt-in)
#   0b. claim: the new, empty database is marked disposable (bound to its cluster and database)
#   0c. target guard self-test on probe databases of this cluster: remote and closed targets, copied
#      and tampered markers, populated databases, adopt confirmations, concurrent claims
#   0d. privilege model (QA_PRIVILEGE_MODEL, default "hosted"): BEFORE the migrations, role postgres
#      gets the default privileges of the hosted projects (scripts/qa/hosted-default-privileges.sql:
#      nothing for anon, authenticated and service_role), so every table, function and sequence the
#      migrations create has only its explicit GRANTs (and, for functions, PUBLIC's built-in EXECUTE until
#      revoked), exactly as on the Client Preview and production.
#      QA_PRIVILEGE_MODEL=cli keeps the Supabase CLI defaults (the API roles get everything postgres
#      creates): the model of older projects and of the local demo/QA stacks. CI runs both. See
#      docs/operations/privilege-models.md
#   1. apply every migration from zero with the same tool as production (drizzle-kit migrate)
#   2. journal/tracker/hash integrity and SQL-first policy (scripts/qa/check-migrations.mjs)
#   2c. API privileges (scripts/security/api_privileges.mjs): hosted model: the effective privileges of
#      anon, authenticated and service_role are EXACTLY scripts/qa/api-privileges.hosted.json, plus
#      invariants (anon reads no table, the only direct write is the own profile, retired and trigger
#      functions executable by nobody); cli model: every privilege of the manifest is present and the
#      extra ones this model adds are counted. Run again at the very end (after the rehearsals)
#   2b. the new database holds no organization at all: no fictional tenants (migration 0021)
#   3. SQL fixtures: prices/tax/stock/COGS/idempotence/reversal/RLS/store scope/anon,
#      movement idempotence/consent/auth, purchase receipts/transfer conservation,
#      0022 cross-organization store scope and organization features, 0024 recipes, 0025 store tax,
#      0026 menu category archive, 0028/0029 category deactivation through the save closed, 0029
#      category intents create/update/reactivate, billing and entitlements (plan limits, subscription
#      states, suspended organizations, privileged billing tables, team limits). Every fixture runs in one transaction that ends in
#      ROLLBACK and starts with the target guard; the operations fixture uses fresh ids on every run
#   3b. the operations fixture leaves nothing behind when it is interrupted by an error, when rows
#      with the literal ids of its former version already exist, and when it is run again: every
#      table of public and auth keeps its exact row count
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
#   5g. 0032 concurrency: a POS sale and the manual resolution of a pending sale in two PostgreSQL
#      sessions, both orders, with COMMIT and ROLLBACK: the same advisory lock serializes them; a
#      recorded sale is recovered (nothing closed), a closed key refuses any later sale
#      (sale_key_voided), the audit trail holds exactly the committed closures (own isolated
#      organization, removed at the end); 0033: the API default is READ COMMITTED, the same
#      interleavings are correct in READ COMMITTED and refused (isolation_unsupported, nothing written)
#      in REPEATABLE READ and SERIALIZABLE, in both orders
#   5h. 0033 member grant integrity (direct RPC calls as each role): owners and managers grant only
#      what the tier can hold and, for managers, what they hold themselves (extras, profiles and
#      invitations); staff never hold orders.resolve_pending; managers never act on managers, on
#      themselves or outside their stores; other tenants and platform admins refused; a demotion
#      drops what the lower tier cannot hold (audited) so a promotion reactivates nothing
#   5i. 0034 platform owner assignment (direct RPC calls, two PostgreSQL sessions): only an
#      organization without an active owner, never the caller or a platform account, never touching
#      an existing owner; concurrent assignments (both orders, COMMIT and ROLLBACK) and an owner
#      invitation accepted meanwhile are serialized by the per-organization lock; isolation levels
#      above READ COMMITTED refused; the assigned owner sees nothing of another tenant; operators never
#      own customer organizations (a platform role is refused for an owner, and an account with a
#      platform role never becomes owner by any path: role change, transfer, invitation, new
#      organization; test restaurants exempt)
#   5j. 0035 justification privacy (every role, direct reads and RPC): the text only in the private
#      store, never through the API (closed keys, private store, audit); the reader answers the owner,
#      the organization admin and granted managers at their stores only; the activity log is scoped to
#      the reader's stores; staff, other tenants, platform admins and anon refused
#   5k. POS sale flow (0025/0032/0033/0036, direct RPC calls, real sessions): a sale and an open order;
#      a lost reply replayed is the same order; a closed key refused by every v2 entry point; two and ten
#      simultaneous sends are one order; the basis-point RPCs retired by 0036 refused for every API role
#      and, for their owner, still delegating to v2 (closed key refused, same idempotency); who may sell
#      where; no direct write of orders, payments, ledger, audit or closed keys
#   5l. 0037 dining room tables (direct RPC calls and reads as each role, two PostgreSQL sessions): the
#      table_service feature off by default (nothing readable or writable, owners included) and on for
#      one organization only; owner, manager with and without the store, cashier profile, staff with
#      and without a grant, a second store, another tenant, anon; no direct writes; labels, seats,
#      sections of another store, archive rules, status history, store-scoped audit, suspended
#      organization; two status changes from the same screen state (the second refused, never
#      overwritten) and section archive vs table save in both orders, with COMMIT and ROLLBACK
#   5m. 0038 dining sessions, checks and rounds (direct RPC calls, two PostgreSQL sessions): opening a
#      table (who, replay, one party per table, the table locked occupied), rounds at server prices and
#      store tax, ingredients consumed at once with no payment and no revenue, pos.sell required,
#      refusals write nothing, a voided round returns the stock, move and close-empty; two parties for
#      one table, a round vs closing the session in both orders, the same round sent twice at once
#   5n. 0039 dining check payments (direct RPC calls, two PostgreSQL sessions): partial and final
#      tenders, cash change, tips outside revenue, replay, refusals that write nothing, one allocation
#      row per round (method or mixed), revenue and COGS once, session and table closed with the last
#      check, voids blocked on paid checks, tender reversal, moving rounds; two payments for one
#      balance and a payment vs a void in both orders
#   5o. 0040 assistant usage (direct RPC calls as each role): the ai_assistant feature off by default
#      and on for one organization; owner/manager/staff with and without a grant, another tenant,
#      anon, invalid values, no direct writes; owner reads the organization's usage, a manager only
#      their own; the month total; the audit keeps the size, never the question
#   5p. 0041 check payment reversal reasons: no member reads reversal_reason through the API (the other
#      columns still read, SELECT * refused); list_check_reversal_reasons() answers owner and manager
#      (orders.refund at the store) with that check's reasons only; staff, another tenant, a store of
#      another tenant and anon refused
#   5q. 0042 menu item sales (SECURITY INVOKER read): units, sales and orders per product and store,
#      cancelled orders left out, the store's last N local days; another tenant and anon get nothing
#   5r. tenant isolation sweep, driven by the catalog: EVERY public table and view with an org_id
#      column (new ones included without editing the script), every organization with rows in it: the
#      owner of another organization reads none, and (rolled back) updates and deletes none; a view
#      that is not security_invoker shows up as a leak; tables with no rows are listed as not exercised
#   5s. 0043 platform-admin hardening (direct RPC calls, two PostgreSQL sessions): operators never
#      members of customer organizations in any role (both sides, demo allowed); platform role changes
#      serialized (a revocation race never leaves zero admins); audit only on real changes; the grace
#      window starts only on a status change; the suspension text changes only with a status
#   5t. 0044 inventory consumption (SECURITY INVOKER read): sales minus reversals of sales per item and
#      store, adjustments and other reversals left out, the store's last N local days; another tenant
#      and anon get nothing
#   5u. 0045 sales tax summary (SECURITY INVOKER read): orders, taxable sales, tax and total per store
#      and local month, cancelled and simulated orders left out, the last N months; another tenant and
#      anon get nothing
#   6. demo reconstruction: seed-demo-orgs.sql twice, MARAO and Harbor match the demo, no duplicates
#   7. order history paging against the database: every order exactly once (ties, >200, 5,000 cap,
#      sales created mid-read), totals match the table; kitchen board: every open ticket once with
#      >100 newer orders, realtime events of the own organization only (each file in its own
#      isolated organization, fixed timestamps, run in parallel); menu categories archived through
#      PostgREST by signed-in members (0026)
#   8. LAST (changes the schema, leaves it re-applied): M2 rollback and re-application
#      (docs/operations/m2-rollback): rollback in one transaction, nobody keeps the permission, custom
#      profiles stripped, revocations and closed keys kept; re-application restores functions,
#      policies and triggers exactly as after 0033 without reactivating custom profiles or individual
#      grants; idempotent
#   9. LAST (changes the schema, leaves it re-applied): 0034/0035/0036 rollback and re-application
#      (docs/operations/security-closure): previous bodies restored, private store and column
#      privilege kept; texts written the 0033 way during the window are moved exactly on
#      re-application (audited); schema identical afterwards; idempotent
set -euo pipefail
cd "$(dirname "$0")/../.."

eval "$(supabase status --workdir scripts/qa -o env 2>/dev/null | grep -E '^(API_URL|DB_URL|ANON_KEY|SERVICE_ROLE_KEY)=')"
[[ -n "${API_URL:-}" && -n "${DB_URL:-}" && -n "${SERVICE_ROLE_KEY:-}" ]] || { echo "Refusing: the scripts/qa stack is not running (supabase start --workdir scripts/qa)"; exit 2; }
GUARD="node scripts/guard/target-guard.mjs"
PRIVILEGE_MODEL="${QA_PRIVILEGE_MODEL:-hosted}"
[[ "$PRIVILEGE_MODEL" == "hosted" || "$PRIVILEGE_MODEL" == "cli" ]] || { echo "Refusing: QA_PRIVILEGE_MODEL must be hosted or cli"; exit 2; }

ARTIFACTS="${QA_ARTIFACTS:-$(mktemp -d)}"
mkdir -p "$ARTIFACTS"
CREDS_FILE="$ARTIFACTS/qa-credentials.json"   # generated passwords; never printed, never committed
[[ -e "$CREDS_FILE" ]] && { echo "Refusing: $CREDS_FILE exists (suite needs a fresh stack)"; exit 2; }

# psql on the runner; locally (no psql installed) the one inside the QA db container.
QA_PROJECT=$(sed -n 's/^project_id = "\(.*\)"/\1/p' scripts/qa/supabase/config.toml)
# One psql session on the QA database, reading stdin. The SQL files check the target guard
# themselves (dq_guard.attest), whatever channel reaches the database.
psql_target() {
  if command -v psql >/dev/null; then psql "$DB_URL" -X -q -v ON_ERROR_STOP=1 "$@"
  else docker exec -i -e PGOPTIONS="${PGOPTIONS:-}" "supabase_db_${QA_PROJECT}" psql -U postgres -d postgres -X -q -v ON_ERROR_STOP=1 "$@"; fi
}
run_sql() { # file [psql args...]
  local f="$1"; shift
  psql_target "$@" < "$f"
}
sql_value() { PGOPTIONS="" psql_target -At -c "$1"; }
with_opts() { local o="$1"; shift; PGOPTIONS="$o" "$@"; } # session options for one call
# A direct run that the guard must refuse (output kept in the artifacts).
must_refuse() { # label, command...
  local label="$1"; shift; local log="$ARTIFACTS/refused-${label// /-}.txt"
  if "$@" > "$log" 2>&1; then echo "FAIL $label ran on an unmarked database"; exit 1; fi
  grep -q "refused by the target guard" "$log" || { tail -5 "$log"; echo "FAIL $label failed for another reason"; exit 1; }
  echo "  refused: $label"
}
# Exact row count of every table of public and auth, on one line: the "nothing changed" baseline.
TABLE_COUNTS_SQL="select string_agg(format('%s.%s=%s', table_schema, table_name, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', table_schema, table_name), false, true, '')))[1]::text), ',' order by table_schema, table_name) from information_schema.tables where table_schema in ('public', 'auth') and table_type = 'BASE TABLE'"
table_counts() { sql_value "$TABLE_COUNTS_SQL"; }
# Runs a check file and requires its PASS line.
run_check() {
  out=$(run_sql "$1" 2>&1) || { echo "$out" | tail -5; echo "FAIL $1"; exit 1; }
  echo "$out" | grep -E "PASS" || { echo "$out" | tail -5; echo "FAIL $1 (no PASS line)"; exit 1; }
}

echo "::group::0a. direct runs on the unmarked new database are refused"
# Nothing is claimed yet: an existing (claimed) database means the suite already ran here.
if $GUARD check --db-url "$DB_URL" --operation suite:start > /dev/null 2>&1; then
  echo "Refusing: this database is already marked; the suite needs a freshly started stack"; exit 2
fi
before0=$(table_counts)
must_refuse "QA seed" env SB_URL="$API_URL" SB_ANON="$ANON_KEY" SB_SERVICE="$SERVICE_ROLE_KEY" CREDS_FILE="$ARTIFACTS/refused-seed.json" node scripts/qa/seed-qa-org.mjs
must_refuse "permission matrix with ALLOW_DEMO_WRITES" env ALLOW_DEMO_WRITES=1 SB_URL="$API_URL" SB_ANON="$ANON_KEY" SB_SERVICE="$SERVICE_ROLE_KEY" CREDS_FILE="$ARTIFACTS/refused-seed.json" node scripts/security/permission_matrix.mjs
must_refuse "API check with the anon key" env SB_SERVICE="$ANON_KEY" $GUARD check-api --api-url "$API_URL" --operation test:x
must_refuse "race script" env QA_DB_URL="$DB_URL" node scripts/security/tax_rate_concurrency.mjs
must_refuse "member grant integrity" env QA_DB_URL="$DB_URL" node scripts/security/member_grant_integrity.mjs
must_refuse "M2 rollback rehearsal" env QA_DB_URL="$DB_URL" node scripts/security/m2_rollback_reapply.mjs
must_refuse "platform owner assignment" env QA_DB_URL="$DB_URL" node scripts/security/admin_assign_owner_integrity.mjs
must_refuse "justification privacy" env QA_DB_URL="$DB_URL" node scripts/security/pending_reason_privacy.mjs
must_refuse "security closure rollback rehearsal" env QA_DB_URL="$DB_URL" node scripts/security/security_closure_rollback.mjs
must_refuse "POS sale flow" env QA_DB_URL="$DB_URL" node scripts/security/pos_sale_flow_integrity.mjs
must_refuse "dining room tables" env QA_DB_URL="$DB_URL" node scripts/security/dining_tables_integrity.mjs
must_refuse "dining room checks" env QA_DB_URL="$DB_URL" node scripts/security/dining_checks_integrity.mjs
must_refuse "dining room payments" env QA_DB_URL="$DB_URL" node scripts/security/dining_payments_integrity.mjs
must_refuse "assistant usage" env QA_DB_URL="$DB_URL" node scripts/security/assistant_usage_integrity.mjs
must_refuse "reversal reasons" env QA_DB_URL="$DB_URL" node scripts/security/check_reversal_reason_privacy.mjs
must_refuse "menu item sales" env QA_DB_URL="$DB_URL" node scripts/security/menu_item_sales_integrity.mjs
must_refuse "tenant isolation sweep" env QA_DB_URL="$DB_URL" node scripts/security/tenant_isolation_sweep.mjs
must_refuse "platform admin hardening" env QA_DB_URL="$DB_URL" node scripts/security/platform_admin_hardening.mjs
must_refuse "inventory consumption" env QA_DB_URL="$DB_URL" node scripts/security/inventory_consumption_integrity.mjs
must_refuse "sales tax summary" env QA_DB_URL="$DB_URL" node scripts/security/sales_tax_integrity.mjs
must_refuse "API privileges" env QA_DB_URL="$DB_URL" node scripts/security/api_privileges.mjs
must_refuse "privilege model" run_sql scripts/qa/hosted-default-privileges.sql
must_refuse "integration test" env QA_PAGING_DB=1 SB_URL="$API_URL" SB_ANON="$ANON_KEY" SB_SERVICE="$SERVICE_ROLE_KEY" CREDS_FILE="$ARTIFACTS/refused-seed.json" QA_DB_URL="$DB_URL" QA_PROJECT="$QA_PROJECT" npx --no-install vitest run src/test/integration/menu-archive.db.test.ts
must_refuse "fixture with the PR #22 opt-in" with_opts "-c dinequora.fixture_target=disposable" run_sql scripts/security/reconstructed_operations.sql
must_refuse "demo seed" run_sql scripts/seeds/demo/seed-demo-orgs.sql
[[ "$(table_counts)" == "$before0" ]] || { echo "FAIL a refused run changed rows"; exit 1; }
[[ ! -e "$ARTIFACTS/refused-seed.json" ]] || { echo "FAIL the refused seed wrote its credentials file"; exit 1; }
echo "  nothing changed"
echo "::endgroup::"

echo "::group::0b. claim the new, empty database"
$GUARD claim --db-url "$DB_URL"
echo "::endgroup::"

echo "::group::0c. target guard self-test (probe databases of this cluster)"
DB_URL="$DB_URL" QA_PROJECT="$QA_PROJECT" bash scripts/guard/selftest.sh
echo "::endgroup::"

echo "::group::0d. privilege model: $PRIVILEGE_MODEL"
if [[ "$PRIVILEGE_MODEL" == "hosted" ]]; then
  run_check scripts/qa/hosted-default-privileges.sql
else
  echo "  Supabase CLI default privileges kept (the API roles get every privilege on what postgres creates)"
fi
echo "::endgroup::"

echo "::group::1. migrations from zero"
$GUARD check --db-url "$DB_URL" --operation suite:migrate --new-empty
LOVABLE_DB_MIGRATION_URL="$DB_URL" npx --no-install drizzle-kit migrate 2>&1 | grep -E "applied|error|Error" || true
echo "::endgroup::"

echo "::group::2. migration integrity"
DB_URL="$DB_URL" node scripts/qa/check-migrations.mjs
echo "::endgroup::"

echo "::group::2c. API privileges ($PRIVILEGE_MODEL model)"
QA_DB_URL="$DB_URL" node scripts/security/api_privileges.mjs --expect "$PRIVILEGE_MODEL" | tee "$ARTIFACTS/api-privileges.txt" | grep -v "^PASS"
echo "::endgroup::"

echo "::group::2b. new database without fictional organizations"
run_check scripts/security/fresh_database_no_demo.sql
echo "::endgroup::"

echo "::group::3. SQL security fixtures"
for f in reconstructed_operations permission_scope_features recipe_product_and_metadata store_sales_tax menu_archive menu_category_deactivate menu_category_intent billing_entitlements; do
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
# (an unmarked or copied database: refused before writing, see 0a and 0c)
# c) a second full run passes again (fresh ids on every run)
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

echo "::group::5g. pending POS sale resolution concurrency (0032/0033, two PostgreSQL sessions, isolation levels)"
QA_DB_URL="$DB_URL" node scripts/security/pos_pending_resolution_race.mjs | tee "$ARTIFACTS/pos-pending-resolution-race.txt" | grep -v "^PASS"
echo "::endgroup::"

echo "::group::5h. member grant integrity (0033, direct RPC calls as each role)"
QA_DB_URL="$DB_URL" node scripts/security/member_grant_integrity.mjs | tee "$ARTIFACTS/member-grant-integrity.txt" | grep -v "^PASS"
echo "::endgroup::"

echo "::group::5i. platform owner assignment (0034, direct RPC calls, two PostgreSQL sessions)"
QA_DB_URL="$DB_URL" node scripts/security/admin_assign_owner_integrity.mjs | tee "$ARTIFACTS/admin-assign-owner.txt" | grep -v "^PASS"
echo "::endgroup::"

echo "::group::5j. justification privacy (0035, every role, direct reads and RPC)"
QA_DB_URL="$DB_URL" node scripts/security/pending_reason_privacy.mjs | tee "$ARTIFACTS/pending-reason-privacy.txt" | grep -v "^PASS"
echo "::endgroup::"

echo "::group::5k. POS sale flow (0025/0032/0033/0036, direct RPC calls, real sessions)"
QA_DB_URL="$DB_URL" node scripts/security/pos_sale_flow_integrity.mjs | tee "$ARTIFACTS/pos-sale-flow.txt" | grep -v "^PASS"
echo "::endgroup::"

echo "::group::5l. dining room tables (0037, direct RPC calls as each role, two PostgreSQL sessions)"
QA_DB_URL="$DB_URL" node scripts/security/dining_tables_integrity.mjs | tee "$ARTIFACTS/dining-tables.txt" | grep -v "^PASS"
echo "::endgroup::"

echo "::group::5m. dining sessions, checks and rounds (0038, direct RPC calls, two PostgreSQL sessions)"
QA_DB_URL="$DB_URL" node scripts/security/dining_checks_integrity.mjs | tee "$ARTIFACTS/dining-checks.txt" | grep -v "^PASS"
echo "::endgroup::"

echo "::group::5n. dining check payments (0039, direct RPC calls, two PostgreSQL sessions)"
QA_DB_URL="$DB_URL" node scripts/security/dining_payments_integrity.mjs | tee "$ARTIFACTS/dining-payments.txt" | grep -v "^PASS"
echo "::endgroup::"

echo "::group::5o. assistant usage (0040, direct RPC calls as each role)"
QA_DB_URL="$DB_URL" node scripts/security/assistant_usage_integrity.mjs | tee "$ARTIFACTS/assistant-usage.txt" | grep -v "^PASS"
echo "::endgroup::"

echo "::group::5p. check payment reversal reasons (0041, reads and RPC calls as each role)"
QA_DB_URL="$DB_URL" node scripts/security/check_reversal_reason_privacy.mjs | tee "$ARTIFACTS/reversal-reasons.txt" | grep -v "^PASS"
echo "::endgroup::"

echo "::group::5q. menu item sales (0042, SECURITY INVOKER read as each role)"
QA_DB_URL="$DB_URL" node scripts/security/menu_item_sales_integrity.mjs | tee "$ARTIFACTS/menu-item-sales.txt" | grep -v "^PASS"
echo "::endgroup::"

echo "::group::5r. tenant isolation sweep (every table and view with org_id, as another tenant's owner)"
QA_DB_URL="$DB_URL" node scripts/security/tenant_isolation_sweep.mjs | tee "$ARTIFACTS/tenant-isolation-sweep.txt" | grep -v "^PASS"
echo "::endgroup::"

echo "::group::5s. platform admin hardening (0043, direct RPC calls, two PostgreSQL sessions)"
QA_DB_URL="$DB_URL" node scripts/security/platform_admin_hardening.mjs | tee "$ARTIFACTS/platform-admin-hardening.txt" | grep -v "^PASS"
echo "::endgroup::"

echo "::group::5t. inventory consumption (0044, SECURITY INVOKER read as each role)"
QA_DB_URL="$DB_URL" node scripts/security/inventory_consumption_integrity.mjs | tee "$ARTIFACTS/inventory-consumption.txt" | grep -v "^PASS"
echo "::endgroup::"

echo "::group::5u. sales tax summary (0045, SECURITY INVOKER read as each role)"
QA_DB_URL="$DB_URL" node scripts/security/sales_tax_integrity.mjs | tee "$ARTIFACTS/sales-tax.txt" | grep -v "^PASS"
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
QA_PAGING_DB=1 SB_URL="$API_URL" SB_ANON="$ANON_KEY" SB_SERVICE="$SERVICE_ROLE_KEY" CREDS_FILE="$CREDS_FILE" QA_DB_URL="$DB_URL" \
  QA_PROJECT="$QA_PROJECT" npx --no-install vitest run \
  src/test/integration/orders-paging.db.test.ts src/test/integration/kds-board.db.test.ts \
  src/test/integration/menu-archive.db.test.ts
# pending-sale resolution through PostgREST as signed-in members (0032/0033/0035)
QA_PENDING_DB=1 SB_URL="$API_URL" SB_ANON="$ANON_KEY" SB_SERVICE="$SERVICE_ROLE_KEY" CREDS_FILE="$CREDS_FILE" QA_DB_URL="$DB_URL"   QA_PROJECT="$QA_PROJECT" npx --no-install vitest run src/test/integration/pos-pending-resolution.db.test.ts
echo "::endgroup::"

echo "::group::8. M2 rollback and re-application (LAST: changes the schema, leaves it re-applied)"
QA_DB_URL="$DB_URL" node scripts/security/m2_rollback_reapply.mjs | tee "$ARTIFACTS/m2-rollback-reapply.txt" | grep -v "^PASS"
DB_URL="$DB_URL" node scripts/qa/check-migrations.mjs
echo "::endgroup::"

echo "::group::9. 0034/0035/0036 rollback and re-application (LAST: changes the schema, leaves it re-applied)"
QA_DB_URL="$DB_URL" node scripts/security/security_closure_rollback.mjs | tee "$ARTIFACTS/security-closure-rollback.txt" | grep -v "^PASS"
DB_URL="$DB_URL" node scripts/qa/check-migrations.mjs
echo "::endgroup::"
echo "::group::9b. API privileges after the rehearsals (unchanged)"
QA_DB_URL="$DB_URL" node scripts/security/api_privileges.mjs --expect "$PRIVILEGE_MODEL" | tee "$ARTIFACTS/api-privileges-final.txt" | grep -v "^PASS"
echo "::endgroup::"
rm -f "$CREDS_FILE"
echo "Security suite passed (privilege model: $PRIVILEGE_MODEL)."
