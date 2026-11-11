-- 0022_permission_scope_and_org_features — a permission only counts in its own organization and
-- store, and only when the organization has the feature behind it enabled.
--
-- 1. Store scope. has_permission(_org, _perm, _location) checked the permission in _org but the
--    store with can_access_location(), which accepts a store of ANY organization the caller belongs
--    to. A member of two organizations could therefore pass a check for org A against a store of
--    org B. Every RPC in 0000-0021 also verifies that the store belongs to the organization (via
--    assert_operational_scope or an explicit locations.org_id check), so no existing path exposed
--    data; the primitive itself is now correct so no future caller depends on that extra check.
--    has_permission / has_any_permission require the store to belong to _org_id. Same signatures.
--
-- 2. Organization features. feature_catalog lists features (all OFF by default); org_features turns
--    one on or off for one organization (platform admins only, audited); feature_permissions maps a
--    permission to the feature it requires. A mapped permission only counts — for every role,
--    owners included — while the feature is enabled for that organization. No existing permission is
--    mapped, so every current check behaves exactly as before; new modules map their permissions
--    when they ship.
--
-- has_any_permission with an empty array now returns false for every role (it returned true for
-- owners). No caller passes an empty array (checked against every definition in 0000-0021).
-- Additive only: no existing table, column, row or policy changes.

-- ---------------------------------------------------------------- feature catalog
create table if not exists public.feature_catalog (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,62}$'),
  description text not null,
  default_enabled boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.org_features (
  org_id uuid not null references public.organizations(id) on delete cascade,
  feature text not null references public.feature_catalog(key) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (org_id, feature)
);

create table if not exists public.feature_permissions (
  permission text primary key,
  feature text not null references public.feature_catalog(key) on delete cascade
);
create index if not exists feature_permissions_feature on public.feature_permissions(feature);

-- Planned modules (roadmap I-0..I-4 and the operations PRs). Every one starts disabled.
insert into public.feature_catalog (key, description) values
  ('integrations', 'Settings > Integrations: third-party connectors'),
  ('cloud_printing', 'Receipt and kitchen printing through cloud-connected printers'),
  ('card_terminals', 'Card-present payments through a processor terminal'),
  ('delivery_channels', 'Orders received from delivery marketplaces or aggregators'),
  ('multi_tender_payments', 'Several payments, tips and split checks on one order'),
  ('cash_management', 'Cash drawer, shifts and cash counts'),
  ('tax_engine', 'Store-level sales tax configuration')
on conflict (key) do nothing;

alter table public.feature_catalog enable row level security;
alter table public.org_features enable row level security;
alter table public.feature_permissions enable row level security;

-- Reads only; every write goes through admin_set_org_feature (or a migration).
revoke all on public.feature_catalog, public.org_features, public.feature_permissions from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.feature_catalog, public.org_features, public.feature_permissions from authenticated;

drop policy if exists feature_catalog_read on public.feature_catalog;
create policy feature_catalog_read on public.feature_catalog for select to authenticated using (true);
drop policy if exists feature_permissions_read on public.feature_permissions;
create policy feature_permissions_read on public.feature_permissions for select to authenticated using (true);
drop policy if exists org_features_read on public.org_features;
create policy org_features_read on public.org_features for select to authenticated
  using (public.is_org_member(org_id) or (select public.is_platform_admin()));

-- ---------------------------------------------------------------- helpers (internal)
-- Unknown feature -> false (fail closed).
create or replace function public.org_feature_enabled(_org_id uuid, _feature text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select f.enabled from public.org_features f where f.org_id = _org_id and f.feature = _feature),
    (select c.default_enabled from public.feature_catalog c where c.key = _feature),
    false)
$$;

-- A permission with no required feature is always available.
create or replace function public.permission_feature_enabled(_org_id uuid, _perm text)
returns boolean language sql stable security definer set search_path = public as $$
  select not exists (
    select 1 from public.feature_permissions fp
    where fp.permission = _perm and not public.org_feature_enabled(_org_id, fp.feature))
$$;

create or replace function public.location_in_org(_location_id uuid, _org_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.locations l where l.id = _location_id and l.org_id = _org_id)
$$;

revoke all on function public.org_feature_enabled(uuid, text),
  public.permission_feature_enabled(uuid, text),
  public.location_in_org(uuid, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------- permission checks
-- Same signatures as 0019. Caller = auth.uid(); member of _org_id; role/effective permissions;
-- feature enabled for _org_id; and, with a store, the store belongs to _org_id AND the caller may
-- access it (owner, or explicit member_location_access).
create or replace function public.has_permission(_org_id uuid, _perm text, _location_id uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
      select 1 from public.organization_members m
      where m.org_id = _org_id and m.user_id = auth.uid()
        and (m.role = 'owner' or _perm = any(m.effective_permissions)))
    and public.permission_feature_enabled(_org_id, _perm)
    and (_location_id is null
         or (public.location_in_org(_location_id, _org_id) and public.can_access_location(_location_id)))
$$;

create or replace function public.has_any_permission(_org_id uuid, _perms text[], _location_id uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
      select 1 from public.organization_members m, unnest(coalesce(_perms, '{}'::text[])) p
      where m.org_id = _org_id and m.user_id = auth.uid()
        and (m.role = 'owner' or p = any(m.effective_permissions))
        and public.permission_feature_enabled(_org_id, p))
    and (_location_id is null
         or (public.location_in_org(_location_id, _org_id) and public.can_access_location(_location_id)))
$$;

-- RLS read policies (0019): organizations where the caller holds any of the permissions, now also
-- requiring the permission's feature. Still evaluated once per statement.
create or replace function public.orgs_with_any_permission(_perms text[])
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.org_id from public.organization_members m
  where m.user_id = auth.uid()
    and exists (
      select 1 from unnest(coalesce(_perms, '{}'::text[])) p
      where (m.role = 'owner' or p = any(m.effective_permissions))
        and public.permission_feature_enabled(m.org_id, p))
$$;

-- What the app shows: configured permissions minus those whose feature is off. Order preserved.
create or replace function public.my_permissions(_org_id uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce((
    select array(
      select p from unnest(public.member_permissions(m.id)) with ordinality as x(p, n)
      where public.permission_feature_enabled(_org_id, p)
      order by n)
    from public.organization_members m where m.org_id = _org_id and m.user_id = auth.uid()), '{}'::text[])
$$;

-- ---------------------------------------------------------------- platform admin switch
create or replace function public.admin_set_org_feature(_org_id uuid, _feature text, _enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
declare _was boolean;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  if _enabled is null or not exists (select 1 from public.feature_catalog where key = _feature) then
    raise exception 'invalid_feature';
  end if;
  if not exists (select 1 from public.organizations where id = _org_id) then raise exception 'not_found'; end if;
  _was := public.org_feature_enabled(_org_id, _feature);
  insert into public.org_features (org_id, feature, enabled, updated_at, updated_by)
  values (_org_id, _feature, _enabled, now(), auth.uid())
  on conflict (org_id, feature) do update
    set enabled = excluded.enabled, updated_at = now(), updated_by = auth.uid();
  perform public.write_audit(_org_id, case when _enabled then 'feature.enabled' else 'feature.disabled' end,
    _feature, jsonb_build_object('feature', _feature, 'from', _was, 'to', _enabled));
end $$;

revoke all on function public.admin_set_org_feature(uuid, text, boolean) from public, anon;
grant execute on function public.admin_set_org_feature(uuid, text, boolean) to authenticated;
