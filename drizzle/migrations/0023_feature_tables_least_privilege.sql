-- 0023_feature_tables_least_privilege — follow-up of 0022 (PR #8 audit, P4). Additive: no row,
-- permission or feature switch is changed or removed.
--
-- 1. A feature cannot be deleted (or renamed) while permissions depend on it or organizations have
--    a switch for it. 0022 used ON DELETE CASCADE: deleting a catalog row silently removed its
--    permission mappings, and the gated permission became available to everyone (fail open).
--    Now the delete is refused (RESTRICT); retiring a feature means removing its mappings first,
--    deliberately, in a migration.
-- 2. Least privilege on the three tables. Supabase grants ALL on new tables to anon, authenticated
--    and service_role (on PostgreSQL 17 that includes MAINTAIN). Signed-in users only read (RLS
--    still decides which rows); anon has nothing; service_role reads but does not write: feature
--    switches go only through admin_set_org_feature (platform admins, audited) or migrations.

-- ---------------------------------------------------------------- 1. RESTRICT instead of CASCADE
do $$
declare r record;
begin
  for r in
    select c.conname, c.conrelid::regclass as tbl
    from pg_constraint c
    where c.contype = 'f'
      and c.confrelid = 'public.feature_catalog'::regclass
      and c.conrelid in ('public.feature_permissions'::regclass, 'public.org_features'::regclass)
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end $$;

alter table public.feature_permissions
  add constraint feature_permissions_feature_fkey foreign key (feature)
  references public.feature_catalog(key) on update restrict on delete restrict;
alter table public.org_features
  add constraint org_features_feature_fkey foreign key (feature)
  references public.feature_catalog(key) on update restrict on delete restrict;

-- ---------------------------------------------------------------- 2. least privilege
revoke all on public.feature_catalog, public.org_features, public.feature_permissions
  from public, anon, authenticated, service_role;
grant select on public.feature_catalog, public.org_features, public.feature_permissions
  to authenticated, service_role;
