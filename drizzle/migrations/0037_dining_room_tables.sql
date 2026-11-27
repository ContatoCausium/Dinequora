-- 0037_dining_room_tables — dining room, step 1: sections, tables and table status per store.
--
-- What it adds (additive only: no existing table, column, row or policy changes):
--   * feature table_service (OFF for every organization until a platform admin turns it on with
--     admin_set_org_feature); its three permissions only count while it is on, for every role,
--     owners included (0022), so nothing changes for any organization when this is applied;
--   * permissions tables.view (see the floor), tables.status (mark a table available, occupied,
--     reserved or cleaning) and tables.manage (create, edit and archive sections and tables);
--   * dining_sections, dining_tables and dining_table_status_events (who changed a status, when,
--     from what to what). Store-scoped reads through RLS; NO direct writes: every write goes through
--     the five RPCs below, which check the store, the organization, the permission and the feature;
--   * tables and sections are archived, never deleted (the next step links tables to service
--     sessions and checks; history must keep pointing at them).
--
-- Who holds the permissions by default:
--   owner: all three (whole catalog); manager without a profile: all three (role_default_permissions
--   derives from the catalog); system profiles: org_admin and manager all three, cashier (front of
--   house) tables.view + tables.status, kitchen / stock / finance none; staff without a profile:
--   none (role_default_permissions for staff is an explicit list, unchanged): an owner grants them
--   per member or through a profile. Custom profiles are not touched.
--
-- Not in this step: service sessions, checks, items, payments. "occupied" is a manual status here;
-- the next step makes opening a check mark the table occupied and keeps it so while a check is open.
--
-- Concurrency (READ COMMITTED, the API default):
--   * a status change locks the table row (FOR UPDATE) and, with _expected_status, refuses to
--     overwrite a status someone else changed meanwhile (status_conflict): two waiters never
--     silently undo each other;
--   * saving a table into a section locks the section (FOR SHARE); archiving a section locks it
--     FOR UPDATE and refuses while it holds an active table: never an active table in an archived
--     section, in either order;
--   * labels and section names are unique per store among active rows (partial unique indexes); a
--     concurrent duplicate fails with table_label_taken / section_name_taken.
--
-- Rollback (a NEW migration): drop the five RPCs and the three tables, restore permission_catalog()
-- from 0032, remove the three permissions from the system profiles and recompute
-- effective_permissions, delete the feature_permissions rows and the feature_catalog row. See
-- docs/operations/dining-room-tables.md.

-- Lock wait limit (as 0031-0036): the new foreign keys briefly lock organizations and locations, and
-- the profile/member updates take row locks. Queued behind a slow transaction, a lock not obtained
-- within 5 s raises 55P03 and the WHOLE run rolls back (nothing applied, nothing recorded); run it again.
set local lock_timeout = '5s';

-- ---------------------------------------------------------------- feature and permissions
insert into public.feature_catalog (key, description) values
  ('table_service', 'Dining room: sections, tables and table status')
on conflict (key) do nothing;

insert into public.feature_permissions (permission, feature) values
  ('tables.view', 'table_service'),
  ('tables.status', 'table_service'),
  ('tables.manage', 'table_service')
on conflict (permission) do nothing;

-- 0032 catalog plus the tables module. role_ceiling / role_default_permissions derive from it
-- (managers: all three; staff: grantable, not held by default).
create or replace function public.permission_catalog()
returns text[] language sql immutable set search_path = public as $$
  select array[
    'dashboard.view','dashboard.financials',
    'pos.view','pos.sell','pos.discount',
    'orders.view','orders.update','orders.refund','orders.resolve_pending',
    'kds.view','kds.operate',
    'tables.view','tables.status','tables.manage',
    'menu.view','menu.create','menu.edit','menu.delete',
    'inventory.view','inventory.create','inventory.edit','inventory.adjust','inventory.transfer','inventory.costs',
    'recipes.view','recipes.edit',
    'purchases.view','purchases.create','purchases.approve','purchases.receive','purchases.cancel',
    'suppliers.view','suppliers.edit',
    'finance.view',
    'expenses.view','expenses.create','expenses.edit','expenses.delete','expenses.pay',
    'reports.view','reports.export',
    'team.view','team.invite','team.manage','team.activity',
    'settings.locations','settings.branding','settings.billing'
  ]::text[]
$$;

update public.permission_profiles
   set permissions = array(select distinct p from unnest(permissions || array['tables.view','tables.status','tables.manage']) p order by p)
 where is_system and key in ('org_admin','manager')
   and not (array['tables.view','tables.status','tables.manage'] <@ permissions);
update public.permission_profiles
   set permissions = array(select distinct p from unnest(permissions || array['tables.view','tables.status']) p order by p)
 where is_system and key = 'cashier'
   and not (array['tables.view','tables.status'] <@ permissions);

update public.organization_members
   set effective_permissions = public.effective_permissions_for(role, profile_id, extra_permissions, revoked_permissions);

-- ---------------------------------------------------------------- tables
create table public.dining_sections (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 60 and name = btrim(name)),
  sort_order  integer not null default 0 check (sort_order between 0 and 9999),
  archived_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (org_id, location_id, id)
);
create unique index dining_sections_active_name
  on public.dining_sections (location_id, lower(name)) where archived_at is null;

create table public.dining_tables (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid not null references public.organizations(id) on delete cascade,
  location_id       uuid not null references public.locations(id) on delete cascade,
  section_id        uuid,
  label             text not null check (length(btrim(label)) between 1 and 20 and label = btrim(label)),
  seats             integer not null default 4 check (seats between 1 and 99),
  status            text not null default 'available'
                    check (status in ('available','occupied','reserved','cleaning')),
  status_changed_at timestamptz not null default now(),
  status_changed_by uuid,
  sort_order        integer not null default 0 check (sort_order between 0 and 9999),
  archived_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (org_id, location_id, id),
  -- a table and its section are always in the same store of the same organization
  foreign key (org_id, location_id, section_id) references public.dining_sections (org_id, location_id, id)
);
create unique index dining_tables_active_label
  on public.dining_tables (location_id, lower(label)) where archived_at is null;
create index dining_tables_section on public.dining_tables (section_id) where section_id is not null;

create table public.dining_table_status_events (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  location_id uuid not null,
  table_id    uuid not null,
  from_status text not null check (from_status in ('available','occupied','reserved','cleaning')),
  to_status   text not null check (to_status in ('available','occupied','reserved','cleaning')),
  actor_id    uuid not null,
  created_at  timestamptz not null default now(),
  check (from_status <> to_status),
  foreign key (org_id, location_id, table_id)
    references public.dining_tables (org_id, location_id, id) on delete cascade
);
create index dining_table_status_events_table on public.dining_table_status_events (table_id, created_at desc);

alter table public.dining_sections enable row level security;
alter table public.dining_tables enable row level security;
alter table public.dining_table_status_events enable row level security;

-- Reads: any of the three permissions (the feature is part of the check, evaluated once per
-- statement) AND access to the store (can_access_location, docs/authorization-patterns.md). Not
-- accessible_location_ids(): that function belongs to M2 (0031) and the M2 rollback drops it, which a
-- policy depending on it would block.
create policy dining_sections_read on public.dining_sections for select to authenticated
  using (org_id in (select public.orgs_with_any_permission(array['tables.view','tables.status','tables.manage']))
         and public.can_access_location(location_id));
create policy dining_tables_read on public.dining_tables for select to authenticated
  using (org_id in (select public.orgs_with_any_permission(array['tables.view','tables.status','tables.manage']))
         and public.can_access_location(location_id));
create policy dining_table_status_events_read on public.dining_table_status_events for select to authenticated
  using (org_id in (select public.orgs_with_any_permission(array['tables.view','tables.status','tables.manage']))
         and public.can_access_location(location_id));

revoke all on public.dining_sections, public.dining_tables, public.dining_table_status_events
  from public, anon, authenticated;
grant select on public.dining_sections, public.dining_tables, public.dining_table_status_events
  to authenticated;
grant all on public.dining_sections, public.dining_tables, public.dining_table_status_events
  to service_role;

-- ---------------------------------------------------------------- writes
-- Every RPC: signed-in member, store of THIS organization, store active and organization operational
-- (assert_operational_scope), then the permission at that store (assert_permission, which includes
-- the feature). Errors are stable codes the app translates.

-- _section_id null = a new section.
create or replace function public.save_dining_section(
  _org_id uuid,
  _location_id uuid,
  _name text,
  _sort_order integer default 0,
  _section_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  n text := btrim(coalesce(_name, ''));
  sid uuid;
begin
  perform public.assert_operational_scope(_org_id, _location_id);
  perform public.assert_permission(_org_id, 'tables.manage', _location_id);
  if length(n) not between 1 and 60 then raise exception 'invalid_name'; end if;
  if _sort_order is null or _sort_order not between 0 and 9999 then raise exception 'invalid_sort_order'; end if;
  begin
    if _section_id is null then
      insert into public.dining_sections (org_id, location_id, name, sort_order)
      values (_org_id, _location_id, n, _sort_order)
      returning id into sid;
    else
      update public.dining_sections
         set name = n, sort_order = _sort_order, updated_at = now()
       where id = _section_id and org_id = _org_id and location_id = _location_id and archived_at is null
      returning id into sid;
      if sid is null then raise exception 'section_not_found'; end if;
    end if;
  exception when unique_violation then
    raise exception 'section_name_taken';
  end;
  perform public.write_audit(_org_id, 'tables.section_saved', sid::text,
    jsonb_build_object('name', n, 'created', _section_id is null));
  return sid;
end $$;

create or replace function public.archive_dining_section(
  _org_id uuid,
  _location_id uuid,
  _section_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare s public.dining_sections;
begin
  perform public.assert_operational_scope(_org_id, _location_id);
  perform public.assert_permission(_org_id, 'tables.manage', _location_id);
  select * into s from public.dining_sections
   where id = _section_id and org_id = _org_id and location_id = _location_id and archived_at is null
   for update;
  if s.id is null then raise exception 'section_not_found'; end if;
  if exists (select 1 from public.dining_tables t where t.section_id = s.id and t.archived_at is null) then
    raise exception 'section_not_empty';
  end if;
  update public.dining_sections set archived_at = now(), updated_at = now() where id = s.id;
  perform public.write_audit(_org_id, 'tables.section_archived', s.id::text, jsonb_build_object('name', s.name));
end $$;

-- _table_id null = a new table; _section_id null = no section.
create or replace function public.save_dining_table(
  _org_id uuid,
  _location_id uuid,
  _label text,
  _seats integer,
  _sort_order integer default 0,
  _table_id uuid default null,
  _section_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  l text := btrim(coalesce(_label, ''));
  tid uuid;
begin
  perform public.assert_operational_scope(_org_id, _location_id);
  perform public.assert_permission(_org_id, 'tables.manage', _location_id);
  if length(l) not between 1 and 20 then raise exception 'invalid_label'; end if;
  if _seats is null or _seats not between 1 and 99 then raise exception 'invalid_seats'; end if;
  if _sort_order is null or _sort_order not between 0 and 9999 then raise exception 'invalid_sort_order'; end if;
  if _section_id is not null then
    -- FOR SHARE: an archive of this section waits for us (and then sees the table), or we wait for it
    -- (and then find no active section).
    perform 1 from public.dining_sections
      where id = _section_id and org_id = _org_id and location_id = _location_id and archived_at is null
      for share;
    if not found then raise exception 'section_not_found'; end if;
  end if;
  begin
    if _table_id is null then
      insert into public.dining_tables (org_id, location_id, section_id, label, seats, sort_order)
      values (_org_id, _location_id, _section_id, l, _seats, _sort_order)
      returning id into tid;
    else
      update public.dining_tables
         set label = l, seats = _seats, section_id = _section_id, sort_order = _sort_order, updated_at = now()
       where id = _table_id and org_id = _org_id and location_id = _location_id and archived_at is null
      returning id into tid;
      if tid is null then raise exception 'table_not_found'; end if;
    end if;
  exception when unique_violation then
    raise exception 'table_label_taken';
  end;
  perform public.write_audit(_org_id, 'tables.table_saved', tid::text,
    jsonb_build_object('label', l, 'seats', _seats, 'section', _section_id, 'created', _table_id is null));
  return tid;
end $$;

create or replace function public.archive_dining_table(
  _org_id uuid,
  _location_id uuid,
  _table_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare t public.dining_tables;
begin
  perform public.assert_operational_scope(_org_id, _location_id);
  perform public.assert_permission(_org_id, 'tables.manage', _location_id);
  select * into t from public.dining_tables
   where id = _table_id and org_id = _org_id and location_id = _location_id and archived_at is null
   for update;
  if t.id is null then raise exception 'table_not_found'; end if;
  if t.status = 'occupied' then raise exception 'table_occupied'; end if;
  update public.dining_tables set archived_at = now(), updated_at = now() where id = t.id;
  perform public.write_audit(_org_id, 'tables.table_archived', t.id::text, jsonb_build_object('label', t.label));
end $$;

-- Returns the table's status after the call. _expected_status (what the caller's screen showed):
-- when given and different from the stored status, nothing is written and status_conflict is raised
-- (detail = the stored status). Setting the status it already has writes nothing.
create or replace function public.set_dining_table_status(
  _org_id uuid,
  _location_id uuid,
  _table_id uuid,
  _status text,
  _expected_status text default null
) returns text
language plpgsql security definer set search_path = public as $$
declare t public.dining_tables;
begin
  perform public.assert_operational_scope(_org_id, _location_id);
  perform public.assert_permission(_org_id, 'tables.status', _location_id);
  if _status is null or _status not in ('available','occupied','reserved','cleaning') then
    raise exception 'invalid_status';
  end if;
  if _expected_status is not null and _expected_status not in ('available','occupied','reserved','cleaning') then
    raise exception 'invalid_status';
  end if;
  select * into t from public.dining_tables
   where id = _table_id and org_id = _org_id and location_id = _location_id and archived_at is null
   for update;
  if t.id is null then raise exception 'table_not_found'; end if;
  if _expected_status is not null and t.status <> _expected_status then
    raise exception 'status_conflict' using detail = t.status;
  end if;
  if t.status = _status then return t.status; end if;
  update public.dining_tables
     set status = _status, status_changed_at = now(), status_changed_by = auth.uid(), updated_at = now()
   where id = t.id;
  insert into public.dining_table_status_events (org_id, location_id, table_id, from_status, to_status, actor_id)
  values (_org_id, _location_id, t.id, t.status, _status, auth.uid());
  return _status;
end $$;

revoke all on function public.save_dining_section(uuid, uuid, text, integer, uuid) from public, anon;
revoke all on function public.archive_dining_section(uuid, uuid, uuid) from public, anon;
revoke all on function public.save_dining_table(uuid, uuid, text, integer, integer, uuid, uuid) from public, anon;
revoke all on function public.archive_dining_table(uuid, uuid, uuid) from public, anon;
revoke all on function public.set_dining_table_status(uuid, uuid, uuid, text, text) from public, anon;
grant execute on function public.save_dining_section(uuid, uuid, text, integer, uuid) to authenticated;
grant execute on function public.archive_dining_section(uuid, uuid, uuid) to authenticated;
grant execute on function public.save_dining_table(uuid, uuid, text, integer, integer, uuid, uuid) to authenticated;
grant execute on function public.archive_dining_table(uuid, uuid, uuid) to authenticated;
grant execute on function public.set_dining_table_status(uuid, uuid, uuid, text, text) to authenticated;
