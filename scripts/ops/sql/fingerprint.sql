-- Read-only fingerprint of an application database (same lines as the QA backups of 2026-11-11/12):
-- row count + md5 of every public table, auth users, migration tracker, public functions, policies.
-- Used by scripts/ops/db-ops.mjs (backup, precheck, recover) to prove a state is unchanged.
begin transaction read only;
do $$
declare t record; n bigint; h text;
begin
  for t in select c.relname from pg_class c join pg_namespace s on s.oid=c.relnamespace where s.nspname='public' and c.relkind='r' order by 1 loop
    execute format('select count(*), md5(coalesce(string_agg(x::text, %L order by x::text), %L)) from public.%I x', '|', '', t.relname) into n, h;
    raise notice 'FP public.% % %', t.relname, n, h;
  end loop;
end $$;
select 'FP auth.users ' || count(*) || ' ' || md5(coalesce(string_agg(id::text || email, '|' order by id), '')) from auth.users;
select 'FP drizzle ' || count(*) || ' ' || md5(coalesce(string_agg(hash || created_at, '|' order by id), '')) from drizzle.__drizzle_migrations;
select 'FP functions ' || count(*) || ' ' || md5(string_agg(p.proname || md5(pg_get_functiondef(p.oid)), '|' order by p.proname, p.oid)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f';
select 'FP policies ' || count(*) || ' ' || md5(string_agg(tablename || policyname || coalesce(qual,'') || coalesce(with_check,''), '|' order by tablename, policyname)) from pg_policies where schemaname='public';
rollback;
