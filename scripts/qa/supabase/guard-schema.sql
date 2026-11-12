-- Seed of the disposable CI/test stack (scripts/qa) ONLY: an EMPTY schema for the target guard.
-- It holds no marker, so the new database is still not disposable until
-- `node scripts/guard/target-guard.mjs claim` marks it (security-suite.sh step 0). It exists from the
-- start only because PostgREST exposes it (config.toml [api] schemas) and refuses to start when an
-- exposed schema is missing. No application data, nothing in public.
create schema if not exists dq_guard authorization postgres;
revoke all on schema dq_guard from public;
