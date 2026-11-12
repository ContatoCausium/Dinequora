#!/usr/bin/env bash
# Self-test of the target guard (run by scripts/qa/security-suite.sh step 0c, after the claim).
# Works ONLY inside the disposable cluster the suite claimed: it creates probe databases there
# (dq_guard_probe_<run>_*), tries every bypass it knows of and drops the probes at the end. Every
# refusal is checked twice: the refusal itself, and that the probe is unchanged afterwards.
#
#   DB_URL=… [QA_PROJECT=…] bash scripts/guard/selftest.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
G="node scripts/guard/target-guard.mjs"
: "${DB_URL:?DB_URL is required}"
# the database the suite claimed must itself be disposable before any probe is created
$G check --db-url "$DB_URL" --operation guard:selftest > /dev/null

RUN="dq_guard_probe_$$"
BASE_URL="${DB_URL%/*}"
url_of() { echo "$BASE_URL/$1"; }
psql_db() { # db [psql args...]: one psql session on database $1 of the claimed cluster (stdin)
  local db="$1"; shift
  if command -v psql >/dev/null; then psql "$(url_of "$db")" -X -q -v ON_ERROR_STOP=1 "$@"
  else docker exec -i -e PGOPTIONS="${PGOPTIONS:-}" "supabase_db_${QA_PROJECT:?QA_PROJECT is required without psql}" psql -U postgres -d "$db" -X -q -v ON_ERROR_STOP=1 "$@"; fi
}
val() { PGOPTIONS="" psql_db "$1" -At -c "$2"; }
with_opts() { local o="$1"; shift; PGOPTIONS="$o" "$@"; } # session options for a function call
probes=()
make_db() { val postgres "create database $1${2:+ template $2}" > /dev/null; probes+=("$1"); }
cleanup() { for p in "${probes[@]:-}"; do [ -n "$p" ] && val postgres "drop database if exists $p with (force)" > /dev/null 2>&1 || true; done; }
trap cleanup EXIT
# Objects and rows of a probe: what a refused operation must leave exactly as it was.
state() { val "$1" "select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname not in ('pg_catalog','information_schema','pg_toast')) || ':' || (select count(*) from pg_namespace) || ':' || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname not in ('pg_catalog','information_schema')) || ':' || coalesce((select string_agg(system_identifier || '/' || database_oid || '/' || purpose, ',') from dq_guard.marker), '-')" 2>/dev/null \
  || val "$1" "select (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname not in ('pg_catalog','information_schema','pg_toast')) || ':' || (select count(*) from pg_namespace) || ':' || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname not in ('pg_catalog','information_schema')) || ':-'"; }
pass() { echo "  PASS $*"; }
fail() { echo "  FAIL $*"; exit 1; }
# expects a refusal (exit 3 / psql error) whose message contains "refused by the target guard"
refused() { # label, command...
  local label="$1"; shift; local out
  if out=$("$@" 2>&1); then fail "$label: was ALLOWED"; fi
  grep -q "refused by the target guard" <<<"$out" || fail "$label: failed for another reason: $(tail -2 <<<"$out" | tr '\n' ' ' | cut -c1-200)"
}
allowed() { local label="$1"; shift; "$@" > /dev/null 2>&1 || fail "$label: was refused"; }

# ------------------------------------------------------------------ URLs and connection
t0=$(date +%s)
refused "remote host" $G check --db-url "postgresql://postgres:x@db.example.supabase.co:5432/postgres" --operation test:x
refused "remote API" env SB_SERVICE=x $G check-api --api-url "https://example.supabase.co" --operation test:x
[ $(( $(date +%s) - t0 )) -le 5 ] || fail "remote targets were not refused before connecting"
pass "remote database and API hosts refused before any connection"
refused "closed port" $G check --db-url "postgresql://postgres:postgres@127.0.0.1:1/postgres" --operation test:x
refused "no URL" $G check --operation test:x
refused "not a postgres URL" $G check --db-url "http://127.0.0.1:5432/postgres" --operation test:x
refused "invalid operation" $G check --db-url "$DB_URL" --operation "X; drop"
pass "connection failure, missing/invalid URL and invalid operation refused"
# servers that accept and then reset, or accept and never answer (as a broken port forward does)
fake() { node -e "const s=require(\"net\").createServer(c=>{ if (process.argv[1]===\"reset\") c.destroy(); }).listen(0,\"127.0.0.1\",()=>{console.log(s.address().port)}); setTimeout(()=>process.exit(0),60000)" "$1"; }
fake reset > "/tmp/${RUN}_reset" & fr=$!; fake hang > "/tmp/${RUN}_hang" & fh=$!
for i in $(seq 1 50); do [ -s "/tmp/${RUN}_reset" ] && [ -s "/tmp/${RUN}_hang" ] && break; sleep 0.1; done
t0=$(date +%s)
refused "server that resets the connection" $G check --db-url "postgresql://postgres:postgres@127.0.0.1:$(cat /tmp/${RUN}_reset)/postgres" --operation test:x
refused "server that never answers" $G check --db-url "postgresql://postgres:postgres@127.0.0.1:$(cat /tmp/${RUN}_hang)/postgres" --operation test:x
[ $(( $(date +%s) - t0 )) -le 50 ] || fail "a silent server was not refused in time"
kill $fr $fh 2>/dev/null || true; rm -f "/tmp/${RUN}_reset" "/tmp/${RUN}_hang"
pass "servers that reset or never answer are refused within the deadline (no hang)"

# ------------------------------------------------------------------ new empty database, claim
make_db "${RUN}_a"
s=$(state "${RUN}_a")
refused "unmarked new database" $G check --db-url "$(url_of "${RUN}_a")" --operation test:x
refused "unmarked, generic env overrides" env DQ_GUARD_DISABLE=1 ALLOW_DEMO_WRITES=1 DQ_GUARD_ALLOW=1 \
  PGOPTIONS="-c dinequora.fixture_target=disposable -c dq_guard.confirm=anything" \
  $G check --db-url "$(url_of "${RUN}_a")" --operation test:x
refused "fixture on unmarked database" psql_db "${RUN}_a" -f - < scripts/security/reconstructed_operations.sql
refused "fixture with the PR #22 opt-in" with_opts "-c dinequora.fixture_target=disposable" psql_db "${RUN}_a" -f - < scripts/security/menu_archive.sql
refused "demo seed without confirmation" psql_db "${RUN}_a" -f - < scripts/seeds/demo/seed-demo-orgs.sql
refused "demo seed confirmed for another cluster" with_opts "-c dq_guard.confirm=seed-demo:000000000000" psql_db "${RUN}_a" -f - < scripts/seeds/demo/seed-demo-orgs.sql
[ "$(state "${RUN}_a")" = "$s" ] || fail "a refused operation changed the unmarked database"
pass "unmarked new database: check, env overrides, fixtures (with the old opt-in), demo seed refused; nothing changed"
cluster=$($G identity --db-url "$(url_of "${RUN}_a")" | sed -n 's/.*"cluster":"\([0-9a-f]*\)".*/\1/p')
[[ "$cluster" =~ ^[0-9a-f]{12}$ ]] || fail "identity did not report a short cluster id"
out=$(PGOPTIONS="-c dq_guard.confirm=seed-demo:$cluster" psql_db "${RUN}_a" -f - < scripts/seeds/demo/seed-demo-orgs.sql 2>&1 || true)
grep -q 'relation "public.organizations" does not exist' <<<"$out" || fail "demo seed with this cluster's confirmation did not pass the guard: $(tail -1 <<<"$out")"
pass "demo seed: only a confirmation naming this cluster and operation passes the guard"
allowed "claim new empty" $G claim --db-url "$(url_of "${RUN}_a")"
allowed "check after claim" $G check --db-url "$(url_of "${RUN}_a")" --operation test:x --new-empty
pass "claim of a new, empty database, then allowed"

# ------------------------------------------------------------------ concurrent claims
make_db "${RUN}_b"
pids=(); for i in 1 2 3 4; do $G claim --db-url "$(url_of "${RUN}_b")" > "/tmp/${RUN}_claim_$i" 2>&1 & pids+=($!); done
for p in "${pids[@]}"; do wait "$p" || fail "a concurrent claim failed: $(cat /tmp/${RUN}_claim_* | tr '\n' ' ' | cut -c1-200)"; done
rm -f /tmp/${RUN}_claim_*
[ "$(val "${RUN}_b" "select count(*) from dq_guard.marker")" = 1 ] || fail "concurrent claims left more than one marker"
pass "4 concurrent claims: all consistent, exactly one marker"

# ------------------------------------------------------------------ copies and tampering
make_db "${RUN}_copy" "${RUN}_a"   # same cluster, marker copied verbatim (like a restored dump)
s=$(state "${RUN}_copy")
refused "copied database (marker of another database)" $G check --db-url "$(url_of "${RUN}_copy")" --operation test:x
refused "copied database, SQL attest" psql_db "${RUN}_copy" -c "select dq_guard.attest('test:x')"
refused "copied database, fixture" psql_db "${RUN}_copy" -f - < scripts/security/store_sales_tax.sql
[ "$(state "${RUN}_copy")" = "$s" ] || fail "a refused operation changed the copied database"
pass "copy of a disposable database (marker copied): refused by the CLI, by SQL and by fixtures; nothing changed"
make_db "${RUN}_c"
allowed "claim c" $G claim --db-url "$(url_of "${RUN}_c")"
val "${RUN}_c" "update dq_guard.marker set system_identifier = '1'" > /dev/null
refused "tampered marker (other cluster id)" $G check --db-url "$(url_of "${RUN}_c")" --operation test:x
refused "tampered marker, SQL attest" psql_db "${RUN}_c" -c "select dq_guard.attest('test:x')"
val "${RUN}_c" "insert into dq_guard.marker values (false, '1', 1, 'new-empty')" > /dev/null 2>&1 && fail "a second marker row was accepted"
pass "tampered marker refused; a second marker row cannot be inserted"

# ------------------------------------------------------------------ populated database, adopt
make_db "${RUN}_d"
val "${RUN}_d" "create table public.customer_data(id int); insert into public.customer_data values (1)" > /dev/null
s=$(state "${RUN}_d")
refused "claim of a populated database" $G claim --db-url "$(url_of "${RUN}_d")"
refused "populated database, check" $G check --db-url "$(url_of "${RUN}_d")" --operation test:x
refused "adopt without confirmation" $G adopt --db-url "$(url_of "${RUN}_d")"
refused "adopt with another cluster's code" $G adopt --db-url "$(url_of "${RUN}_d")" --confirm "adopt:000000000000"
refused "adopt with the code of another operation" $G adopt --db-url "$(url_of "${RUN}_d")" --confirm "migrate:$cluster"
[ "$(state "${RUN}_d")" = "$s" ] || fail "a refused operation changed the populated database"
pass "populated database: claim, check and adopt without the exact confirmation refused; nothing changed"
allowed "adopt with this cluster's code" $G adopt --db-url "$(url_of "${RUN}_d")" --confirm "adopt:$cluster"
allowed "check on adopted copy" $G check --db-url "$(url_of "${RUN}_d")" --operation test:x
refused "adopted copy is not a new database" $G check --db-url "$(url_of "${RUN}_d")" --operation test:x --new-empty
[ "$(val "${RUN}_d" "select count(*) from public.customer_data")" = 1 ] || fail "adopt changed application data"
pass "adopt only with adopt:<this cluster>; the adopted copy is accepted for tests, never as a new database; its data untouched"

# ------------------------------------------------------------------ drizzle-kit itself (drizzle.config.ts gate)
make_db "${RUN}_e"
s=$(state "${RUN}_e")
refused "drizzle-kit migrate on an unmarked database" env LOVABLE_DB_MIGRATION_URL="$(url_of "${RUN}_e")" npx --no-install drizzle-kit migrate
refused "drizzle-kit with another cluster's confirmation" env LOVABLE_DB_MIGRATION_URL="$(url_of "${RUN}_e")" DQ_GUARD_CONFIRM="migrate:unregistered:000000000000" npx --no-install drizzle-kit migrate
refused "drizzle-kit with generic overrides" env LOVABLE_DB_MIGRATION_URL="$(url_of "${RUN}_e")" DQ_GUARD_DISABLE=1 DQ_GUARD_CONFIRM=yes npx --no-install drizzle-kit migrate
refused "drizzle-kit push on an unmarked database" env LOVABLE_DB_MIGRATION_URL="$(url_of "${RUN}_e")" npx --no-install drizzle-kit push --force
[ "$(state "${RUN}_e")" = "$s" ] || fail "a refused drizzle-kit run changed the database"
[ "$(val "${RUN}_e" "select to_regnamespace('drizzle') is null")" = t ] || fail "drizzle-kit created its schema on a refused database"
t0=$(date +%s)
refused "drizzle-kit on a remote host" env LOVABLE_DB_MIGRATION_URL="postgresql://postgres:x@db.example.invalid:5432/postgres" npx --no-install drizzle-kit migrate
refused "drizzle-kit on a remote host, confirmation for another host" env LOVABLE_DB_MIGRATION_URL="postgresql://postgres:x@db.example.invalid:5432/postgres" DQ_GUARD_CONFIRM="migrate:remote:other.example.invalid" npx --no-install drizzle-kit migrate
pass "drizzle-kit migrate/push run directly: refused on unmarked, wrongly confirmed and remote targets; nothing changed"

# ------------------------------------------------------------------ a claimed database that starts holding real users
make_db "${RUN}_f"
val "${RUN}_f" "create schema auth; create table auth.users(id uuid primary key, email text)" > /dev/null
allowed "claim f (no user yet)" $G claim --db-url "$(url_of "${RUN}_f")"
val "${RUN}_f" "insert into auth.users values (gen_random_uuid(), 'owner@qa.dinequora.test'), (gen_random_uuid(), 'x@example.test')" > /dev/null
allowed "check with test users only" $G check --db-url "$(url_of "${RUN}_f")" --operation test:x
val "${RUN}_f" "insert into auth.users values (gen_random_uuid(), 'someone@gmail.com')" > /dev/null
refused "claimed database now holding a real user" $G check --db-url "$(url_of "${RUN}_f")" --operation test:x
refused "claimed database now holding a real user, SQL attest" psql_db "${RUN}_f" -c "select dq_guard.attest('test:x')"
val "${RUN}_f" "update auth.users set email = null where email = 'someone@gmail.com'" > /dev/null
refused "claimed database holding a user without e-mail" $G check --db-url "$(url_of "${RUN}_f")" --operation test:x
pass "a claimed database stops being disposable once it holds a user outside the test domains (CLI and SQL)"

echo "Target guard self-test passed."
