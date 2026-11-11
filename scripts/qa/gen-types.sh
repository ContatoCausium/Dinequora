#!/usr/bin/env bash
# Generates src/integrations/supabase/types.ts from the LOCAL QA stack (migrations applied from zero),
# with the Supabase CLI version pinned in .github/workflows/ci.yml and the repository's Prettier.
#
#   supabase start --workdir scripts/qa ...     # disposable stack, then apply the migrations:
#   LOVABLE_DB_MIGRATION_URL=<local db url> npx drizzle-kit migrate
#   bash scripts/qa/gen-types.sh                # rewrite types.ts
#   bash scripts/qa/gen-types.sh --check        # fail if types.ts differs from the generated file
#
# Never targets a hosted project: no --remote / --linked / --project-id, and the stack of
# scripts/qa must answer on 127.0.0.1 or localhost. Schema: public (the only one the app uses).
# The output is the CLI's own; the only transformation is Prettier (formatting only; tokens,
# names, optionality and nullability are unchanged).
set -euo pipefail
cd "$(dirname "$0")/../.."

MODE="${1:-write}"
[[ "$MODE" == "write" || "$MODE" == "--check" ]] || { echo "usage: $0 [--check]"; exit 2; }
TARGET=src/integrations/supabase/types.ts

PINNED=$(sed -n '/supabase\/setup-cli@/,/version:/s/^ *version: *\([0-9.][0-9.]*\).*/\1/p' .github/workflows/ci.yml | head -1)
INSTALLED=$(supabase --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)
[[ -n "$PINNED" ]] || { echo "Refusing: no pinned Supabase CLI version in .github/workflows/ci.yml"; exit 2; }
[[ "$INSTALLED" == "$PINNED" ]] || {
  echo "Refusing: Supabase CLI $INSTALLED installed, $PINNED pinned in CI (the generator output depends on it)"
  exit 2
}

DB_URL=$(supabase status --workdir scripts/qa -o env 2>/dev/null | sed -n 's/^DB_URL="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p')
[[ "$DB_URL" =~ @(127\.0\.0\.1|localhost):[0-9]+/postgres$ ]] || {
  echo "Refusing: the scripts/qa stack is not running locally (DB_URL='${DB_URL:-}')"
  exit 2
}

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
supabase gen types typescript --schema public --workdir scripts/qa > "$TMP/raw.ts" 2> "$TMP/gen.err" || {
  cat "$TMP/gen.err"
  exit 1
}
[[ -s "$TMP/raw.ts" ]] || { echo "empty generator output"; cat "$TMP/gen.err"; exit 1; }
npx --no-install prettier --stdin-filepath "$TARGET" < "$TMP/raw.ts" > "$TMP/types.ts"

if [[ "$MODE" == "--check" ]]; then
  if diff -u "$TARGET" "$TMP/types.ts" > "$TMP/types.diff"; then
    echo "PASS generated types: $TARGET matches the schema of the migrations (CLI $PINNED)"
  else
    head -80 "$TMP/types.diff"
    echo "FAIL $TARGET is out of date with the migrations: run bash scripts/qa/gen-types.sh on a local stack built from zero and commit the result"
    exit 1
  fi
else
  cp "$TMP/types.ts" "$TARGET"
  echo "wrote $TARGET ($(wc -l < "$TARGET") lines, CLI $PINNED)"
fi
