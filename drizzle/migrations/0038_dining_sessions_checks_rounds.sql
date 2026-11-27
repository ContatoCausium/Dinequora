-- 0038_dining_sessions_checks_rounds — dining room, step 2: open a table, send rounds to the kitchen.
--
-- Model (master document: table, service session, check, check items, payment and allocation are
-- separate). This step adds the first three links; payments, allocation and closing a check with
-- items are step 3:
--   * dining_sessions   one seating at a table: guests, server, opened/closed. At most ONE open
--                       session per table (partial unique index). Opening marks the table occupied;
--                       while it is open the table cannot be marked anything else (0037 RPC updated
--                       below) nor archived (0037 already refuses an occupied table);
--   * dining_checks     the bills of a session. Opening a table creates check 1; open_dining_check
--                       adds more (one per person or group, each with an optional name), so people at
--                       the same table can each have their own check and pay it separately (payment is
--                       step 3). Each round goes to ONE check;
--   * dining_check_rounds  each "send to kitchen": exactly one order (orders.id, unique).
--
-- A round IS an order. fire_check_round() records it through create_pos_sale_v2 — the same pricing
-- (server-side menu prices and modifiers), store tax rate check, idempotency key, advisory lock and
-- kitchen status ("new") as the POS — so the kitchen display, the order history and the tickets need
-- no change. Then, as decided for dine-in on 2026-11-27, it consumes the recipe ingredients right
-- away (the kitchen uses them now), with the same rules as the POS sale (insufficient_stock refuses
-- the round). It writes NO payment and NO revenue: an unpaid round is not a sale. Reports and
-- metrics already count only paid orders (isRecordedSale); revenue and COGS are posted when the check
-- is paid (step 3). A round sent by mistake is voided with the existing cancel_order_with_reversal
-- (orders.refund), which returns the ingredients to stock.
--
-- Permission tables.serve (new, behind table_service like the rest of the module): open a table,
-- change guests/server, open more checks at the table, send rounds, move the party to another
-- table, close a session that has nothing to pay. Sending a round ALSO needs pos.sell (create_pos_sale_v2 checks it): recording
-- items with prices is selling. Holders by default: owner; manager without a profile (derived from
-- the catalog); system profiles org_admin, manager and cashier. Staff without a profile: none.
--
-- Idempotency: open_dining_session and fire_check_round take a client key; a replayed request (lost
-- reply, double tap) returns the same session / order and writes nothing twice. Concurrency (READ
-- COMMITTED): opening locks the table (FOR UPDATE); a round locks its check (FOR UPDATE), so a
-- round and closing / moving the session serialize; moving locks both tables in id order.
--
-- Rollback (a NEW migration): drop the RPCs below and the three tables (orders of rounds stay: they
-- are ordinary orders), restore set_dining_table_status and permission_catalog() from 0037, remove
-- tables.serve from the system profiles, feature_permissions and recompute effective_permissions.
-- See docs/operations/dining-room-checks.md.

set local lock_timeout = '5s';

-- ---------------------------------------------------------------- permission
insert into public.feature_permissions (permission, feature) values ('tables.serve', 'table_service')
on conflict (permission) do nothing;

create or replace function public.permission_catalog()
returns text[] language sql immutable set search_path = public as $$
  select array[
    'dashboard.view','dashboard.financials',
    'pos.view','pos.sell','pos.discount',
    'orders.view','orders.update','orders.refund','orders.resolve_pending',
    'kds.view','kds.operate',
    'tables.view','tables.status','tables.serve','tables.manage',
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
   set permissions = array(select distinct p from unnest(permissions || array['tables.serve']) p order by p)
 where is_system and key in ('org_admin','manager','cashier')
   and not ('tables.serve' = any(permissions));

update public.organization_members
   set effective_permissions = public.effective_permissions_for(role, profile_id, extra_permissions, revoked_permissions);

-- ---------------------------------------------------------------- tables
create table public.dining_sessions (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  table_id    uuid not null,
  guests      integer not null check (guests between 1 and 99),
  server_id   uuid not null,
  status      text not null default 'open' check (status in ('open','closed')),
  client_key  text not null check (length(client_key) between 1 and 160),
  opened_by   uuid not null,
  opened_at   timestamptz not null default now(),
  closed_by   uuid,
  closed_at   timestamptz,
  unique (org_id, client_key),
  unique (org_id, location_id, id),
  check ((status = 'open') = (closed_at is null)),
  foreign key (org_id, location_id, table_id) references public.dining_tables (org_id, location_id, id)
);
create unique index dining_sessions_one_open_per_table on public.dining_sessions (table_id) where status = 'open';
create index dining_sessions_store_open on public.dining_sessions (location_id) where status = 'open';

create table public.dining_checks (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  location_id uuid not null,
  session_id  uuid not null,
  number      integer not null default 1 check (number between 1 and 99),
  label       text check (label is null or (length(btrim(label)) between 1 and 40 and label = btrim(label))),
  status      text not null default 'open' check (status in ('open','closed','void')),
  client_key  text check (client_key is null or length(client_key) between 1 and 160),
  opened_by   uuid,
  opened_at   timestamptz not null default now(),
  closed_at   timestamptz,
  unique (org_id, location_id, id),
  unique (session_id, number),
  unique (org_id, client_key),
  check ((status = 'open') = (closed_at is null)),
  foreign key (org_id, location_id, session_id) references public.dining_sessions (org_id, location_id, id) on delete cascade
);

create table public.dining_check_rounds (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null,
  location_id uuid not null,
  check_id    uuid not null,
  order_id    uuid not null unique,
  round_no    integer not null check (round_no between 1 and 999),
  fired_by    uuid not null,
  fired_at    timestamptz not null default now(),
  unique (check_id, round_no),
  foreign key (org_id, location_id, check_id) references public.dining_checks (org_id, location_id, id) on delete cascade,
  foreign key (org_id, location_id, order_id) references public.orders (org_id, location_id, id)
);

alter table public.dining_sessions enable row level security;
alter table public.dining_checks enable row level security;
alter table public.dining_check_rounds enable row level security;

-- Reads: any tables.* permission (feature included) AND access to the store; same shape as 0037.
create policy dining_sessions_read on public.dining_sessions for select to authenticated
  using (org_id in (select public.orgs_with_any_permission(array['tables.view','tables.status','tables.serve','tables.manage']))
         and public.can_access_location(location_id));
create policy dining_checks_read on public.dining_checks for select to authenticated
  using (org_id in (select public.orgs_with_any_permission(array['tables.view','tables.status','tables.serve','tables.manage']))
         and public.can_access_location(location_id));
create policy dining_check_rounds_read on public.dining_check_rounds for select to authenticated
  using (org_id in (select public.orgs_with_any_permission(array['tables.view','tables.status','tables.serve','tables.manage']))
         and public.can_access_location(location_id));

-- The 0037 reads now also accept tables.serve (a server who only serves still sees the floor).
alter policy dining_sections_read on public.dining_sections
  using (org_id in (select public.orgs_with_any_permission(array['tables.view','tables.status','tables.serve','tables.manage']))
         and public.can_access_location(location_id));
alter policy dining_tables_read on public.dining_tables
  using (org_id in (select public.orgs_with_any_permission(array['tables.view','tables.status','tables.serve','tables.manage']))
         and public.can_access_location(location_id));
alter policy dining_table_status_events_read on public.dining_table_status_events
  using (org_id in (select public.orgs_with_any_permission(array['tables.view','tables.status','tables.serve','tables.manage']))
         and public.can_access_location(location_id));

revoke all on public.dining_sessions, public.dining_checks, public.dining_check_rounds
  from public, anon, authenticated;
grant select on public.dining_sessions, public.dining_checks, public.dining_check_rounds to authenticated;
grant all on public.dining_sessions, public.dining_checks, public.dining_check_rounds to service_role;

-- ---------------------------------------------------------------- helpers (internal)
-- Table status change + history row, by the caller. The caller holds the table row lock.
create or replace function public.dining_table_set_status_internal(_table public.dining_tables, _to text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if _table.status = _to then return; end if;
  update public.dining_tables
     set status = _to, status_changed_at = now(), status_changed_by = auth.uid(), updated_at = now()
   where id = _table.id;
  insert into public.dining_table_status_events (org_id, location_id, table_id, from_status, to_status, actor_id)
  values (_table.org_id, _table.location_id, _table.id, _table.status, _to, auth.uid());
end $$;
revoke all on function public.dining_table_set_status_internal(public.dining_tables, text) from public, anon, authenticated;

-- A server must be a member of the organization who can work at this store.
create or replace function public.dining_server_ok(_org_id uuid, _location_id uuid, _user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.organization_members m
     where m.org_id = _org_id and m.user_id = _user_id
       and (m.role = 'owner'
            or exists (select 1 from public.member_location_access a
                        where a.member_id = m.id and a.location_id = _location_id)))
$$;
revoke all on function public.dining_server_ok(uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- 0037 status change, session-aware
-- Same as 0037 plus one rule: while a session is open the table stays occupied (table_has_open_check).
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
  if exists (select 1 from public.dining_sessions s where s.table_id = t.id and s.status = 'open') then
    raise exception 'table_has_open_check';
  end if;
  perform public.dining_table_set_status_internal(t, _status);
  return _status;
end $$;

-- ---------------------------------------------------------------- open a table
-- Returns the session id. The table must be available or reserved (a reservation being seated).
-- _server_id null = the caller. Replaying the same _client_key returns the same session.
create or replace function public.open_dining_session(
  _org_id uuid,
  _location_id uuid,
  _table_id uuid,
  _guests integer,
  _client_key text,
  _server_id uuid default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  k text := btrim(coalesce(_client_key, ''));
  srv uuid := coalesce(_server_id, auth.uid());
  t public.dining_tables;
  s public.dining_sessions;
  sid uuid;
begin
  perform public.assert_operational_scope(_org_id, _location_id);
  perform public.assert_permission(_org_id, 'tables.serve', _location_id);
  if length(k) not between 1 and 160 then raise exception 'invalid_key'; end if;
  if _guests is null or _guests not between 1 and 99 then raise exception 'invalid_guests'; end if;
  if not public.dining_server_ok(_org_id, _location_id, srv) then raise exception 'invalid_server'; end if;
  select * into t from public.dining_tables
   where id = _table_id and org_id = _org_id and location_id = _location_id and archived_at is null
   for update;
  if t.id is null then raise exception 'table_not_found'; end if;
  -- under the table lock: a replay finds its session; a second party finds the table taken
  select * into s from public.dining_sessions where org_id = _org_id and client_key = k;
  if s.id is not null then
    if s.table_id <> t.id then raise exception 'idempotency_conflict'; end if;
    return s.id;
  end if;
  if t.status not in ('available','reserved') then raise exception 'table_not_available' using detail = t.status; end if;
  insert into public.dining_sessions (org_id, location_id, table_id, guests, server_id, client_key, opened_by)
  values (_org_id, _location_id, t.id, _guests, srv, k, auth.uid())
  returning id into sid;
  insert into public.dining_checks (org_id, location_id, session_id, opened_by) values (_org_id, _location_id, sid, auth.uid());
  perform public.dining_table_set_status_internal(t, 'occupied');
  perform public.write_audit(_org_id, 'tables.session_opened', sid::text,
    jsonb_build_object('table', t.label, 'guests', _guests, 'server', srv));
  return sid;
end $$;

-- Guests and server of an open session.
create or replace function public.update_dining_session(
  _org_id uuid,
  _location_id uuid,
  _session_id uuid,
  _guests integer,
  _server_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare s public.dining_sessions;
begin
  perform public.assert_operational_scope(_org_id, _location_id);
  perform public.assert_permission(_org_id, 'tables.serve', _location_id);
  if _guests is null or _guests not between 1 and 99 then raise exception 'invalid_guests'; end if;
  if _server_id is null or not public.dining_server_ok(_org_id, _location_id, _server_id) then
    raise exception 'invalid_server';
  end if;
  select * into s from public.dining_sessions
   where id = _session_id and org_id = _org_id and location_id = _location_id and status = 'open'
   for update;
  if s.id is null then raise exception 'session_not_found'; end if;
  if s.guests = _guests and s.server_id = _server_id then return; end if;
  update public.dining_sessions set guests = _guests, server_id = _server_id where id = s.id;
  perform public.write_audit(_org_id, 'tables.session_updated', s.id::text,
    jsonb_build_object('guests', _guests, 'server', _server_id));
end $$;

-- ---------------------------------------------------------------- another check at the same table
-- Returns the check id: the next number of the session, with an optional name ("Ana", "Couple by the
-- window"). The session row lock numbers the checks one at a time. Replaying the same _client_key
-- returns the same check.
create or replace function public.open_dining_check(
  _org_id uuid,
  _location_id uuid,
  _session_id uuid,
  _client_key text,
  _label text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  k text := btrim(coalesce(_client_key, ''));
  l text := nullif(btrim(coalesce(_label, '')), '');
  s public.dining_sessions;
  existing public.dining_checks;
  n integer;
  cid uuid;
begin
  perform public.assert_operational_scope(_org_id, _location_id);
  perform public.assert_permission(_org_id, 'tables.serve', _location_id);
  if length(k) not between 1 and 160 then raise exception 'invalid_key'; end if;
  if l is not null and length(l) > 40 then raise exception 'invalid_label'; end if;
  select * into s from public.dining_sessions
   where id = _session_id and org_id = _org_id and location_id = _location_id
   for update;
  if s.id is null then raise exception 'session_not_found'; end if;
  select * into existing from public.dining_checks where org_id = _org_id and client_key = k;
  if existing.id is not null then
    if existing.session_id <> s.id then raise exception 'idempotency_conflict'; end if;
    return existing.id;
  end if;
  if s.status <> 'open' then raise exception 'session_not_found'; end if;
  select coalesce(max(number), 0) + 1 into n from public.dining_checks where session_id = s.id;
  if n > 99 then raise exception 'too_many_checks'; end if;
  insert into public.dining_checks (org_id, location_id, session_id, number, label, client_key, opened_by)
  values (_org_id, _location_id, s.id, n, l, k, auth.uid())
  returning id into cid;
  perform public.write_audit(_org_id, 'tables.check_opened', cid::text,
    jsonb_build_object('session', s.id, 'number', n, 'label', l));
  return cid;
end $$;

-- ---------------------------------------------------------------- send a round to the kitchen
-- Returns the order id. _items / _tax_rate_ppm as create_pos_sale_v2 (server prices; the rate the
-- screen showed is only a confirmation). Replaying the same _client_key returns the same order and
-- consumes nothing twice.
create or replace function public.fire_check_round(
  _org_id uuid,
  _location_id uuid,
  _check_id uuid,
  _client_key text,
  _items jsonb,
  _tax_rate_ppm integer,
  _notes text default null
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  k text := btrim(coalesce(_client_key, ''));
  c public.dining_checks;
  s public.dining_sessions;
  t public.dining_tables;
  ord public.orders;
  stock public.inventory_items;
  req record;
  oid uuid;
  n integer;
  tn text;
begin
  perform public.assert_operational_scope(_org_id, _location_id);
  perform public.assert_permission(_org_id, 'tables.serve', _location_id);
  if length(k) not between 1 and 150 then raise exception 'invalid_key'; end if;
  -- the check lock serializes rounds of the same check with each other and with close / move
  select * into c from public.dining_checks
   where id = _check_id and org_id = _org_id and location_id = _location_id
   for update;
  if c.id is null then raise exception 'check_not_found'; end if;
  -- a replay of a round already recorded on this check returns it, even if the check closed since
  select r.order_id into oid from public.dining_check_rounds r
    join public.orders o on o.id = r.order_id
   where r.check_id = c.id and o.client_order_id = 'round:' || k;
  if oid is not null then return oid; end if;
  if c.status <> 'open' then raise exception 'check_not_open'; end if;
  select * into s from public.dining_sessions where id = c.session_id;
  if s.status <> 'open' then raise exception 'check_not_open'; end if;
  select * into t from public.dining_tables where id = s.table_id;
  -- The ticket names the check when the table has more than one: the kitchen display shows the table
  -- field ("4 · Ana", "4 · Check 2"), so the runner knows whose plate it is. Check 1 stays "4".
  tn := t.label || case when c.label is not null then ' · ' || c.label
                        when c.number > 1 then ' · Check ' || c.number else '' end;
  -- pricing, tax confirmation, idempotency and the kitchen status: the POS path (also asserts pos.sell)
  oid := public.create_pos_sale_v2(_org_id, _location_id, 'dine_in'::public.order_type,
           'Table ' || tn, null, null, null, tn, nullif(btrim(coalesce(_notes, '')), ''),
           0, _tax_rate_ppm, _items, false, 'round:' || k);
  -- the key belongs to another check (or an order outside this module)
  if exists (select 1 from public.dining_check_rounds r where r.order_id = oid and r.check_id <> c.id)
     or exists (select 1 from public.payments p where p.order_id = oid) then
    raise exception 'idempotency_conflict';
  end if;
  select * into ord from public.orders where id = oid for update;
  if ord.status = 'cancelled' then raise exception 'order_cancelled'; end if;
  select coalesce(max(round_no), 0) + 1 into n from public.dining_check_rounds where check_id = c.id;
  insert into public.dining_check_rounds (org_id, location_id, check_id, order_id, round_no, fired_by)
  values (_org_id, _location_id, c.id, oid, n, auth.uid());
  -- the ingredients are used now (same rules as the POS sale); never twice for the same order
  if not exists (select 1 from public.inventory_movements m where m.order_id = oid and m.kind = 'sale') then
    for req in
      select ri.inventory_item_id,
             sum(public.operational_unit_quantity(ri.quantity, ri.unit, st.unit) * (1 + ri.waste_percentage / 100)
                 * oi.quantity / r.servings) as qty
        from public.order_items oi
        join public.product_recipes r on r.product_id = oi.product_id and r.org_id = _org_id and r.location_id = _location_id
        join public.recipe_ingredients ri on ri.recipe_id = r.id
        join public.inventory_items st on st.id = ri.inventory_item_id
       where oi.order_id = oid
       group by ri.inventory_item_id
       order by ri.inventory_item_id
    loop
      select * into stock from public.inventory_items
       where id = req.inventory_item_id and org_id = _org_id and location_id = _location_id
       for update;
      if not stock.active or stock.quantity < req.qty then raise exception 'insufficient_stock'; end if;
      update public.inventory_items set quantity = quantity - req.qty, updated_at = now() where id = stock.id;
      insert into public.inventory_movements (org_id, location_id, inventory_item_id, order_id, delta,
        unit_cost_cents, kind, client_event_id, reason, actor_id)
      values (_org_id, _location_id, stock.id, oid, -req.qty, stock.cost_cents, 'sale', 'sale:' || oid::text,
        'Recipe consumption (sent to kitchen)', auth.uid());
    end loop;
  end if;
  perform public.write_audit(_org_id, 'tables.round_fired', oid::text,
    jsonb_build_object('check', c.id, 'round', n, 'table', t.label));
  return oid;
end $$;

-- ---------------------------------------------------------------- move the party
create or replace function public.move_dining_session(
  _org_id uuid,
  _location_id uuid,
  _session_id uuid,
  _to_table_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.dining_sessions;
  t_from public.dining_tables;
  t_to public.dining_tables;
  t public.dining_tables;
begin
  perform public.assert_operational_scope(_org_id, _location_id);
  perform public.assert_permission(_org_id, 'tables.serve', _location_id);
  select * into s from public.dining_sessions
   where id = _session_id and org_id = _org_id and location_id = _location_id and status = 'open';
  if s.id is null then raise exception 'session_not_found'; end if;
  if s.table_id = _to_table_id then return; end if;
  -- both tables locked in id order (no deadlock between two opposite moves)
  for t in select * from public.dining_tables
            where id in (s.table_id, _to_table_id) and org_id = _org_id and location_id = _location_id
            order by id for update loop
    if t.id = s.table_id then t_from := t; else t_to := t; end if;
  end loop;
  if t_to.id is null or t_to.archived_at is not null then raise exception 'table_not_found'; end if;
  -- the session itself, under the table locks (it may have been closed or moved meanwhile)
  select * into s from public.dining_sessions where id = _session_id for update;
  if s.status <> 'open' or s.table_id <> t_from.id then raise exception 'session_not_found'; end if;
  if t_to.status not in ('available','reserved') then raise exception 'table_not_available' using detail = t_to.status; end if;
  update public.dining_sessions set table_id = t_to.id where id = s.id;
  perform public.dining_table_set_status_internal(t_from, 'cleaning');
  perform public.dining_table_set_status_internal(t_to, 'occupied');
  perform public.write_audit(_org_id, 'tables.session_moved', s.id::text,
    jsonb_build_object('from', t_from.label, 'to', t_to.label));
end $$;

-- ---------------------------------------------------------------- close a session with nothing to pay
-- The party left before ordering, or every round was voided. A check with a live round is paid and
-- closed in step 3 (check_has_items). The table goes to cleaning.
create or replace function public.close_empty_dining_session(
  _org_id uuid,
  _location_id uuid,
  _session_id uuid
) returns void
language plpgsql security definer set search_path = public as $$
declare
  s public.dining_sessions;
  c public.dining_checks;
  t public.dining_tables;
begin
  perform public.assert_operational_scope(_org_id, _location_id);
  perform public.assert_permission(_org_id, 'tables.serve', _location_id);
  select * into s from public.dining_sessions
   where id = _session_id and org_id = _org_id and location_id = _location_id and status = 'open';
  if s.id is null then raise exception 'session_not_found'; end if;
  select * into t from public.dining_tables where id = s.table_id for update;
  -- every check of the session, locked (a round being sent finishes first, or waits and is refused)
  for c in select * from public.dining_checks where session_id = s.id order by id for update loop
    if exists (select 1 from public.dining_check_rounds r join public.orders o on o.id = r.order_id
                where r.check_id = c.id and o.status <> 'cancelled') then
      raise exception 'check_has_items';
    end if;
  end loop;
  -- the session under the locks: still open and still at the table we locked (not moved meanwhile)
  select * into s from public.dining_sessions where id = _session_id for update;
  if s.status <> 'open' or s.table_id <> t.id then raise exception 'session_not_found'; end if;
  update public.dining_checks set status = 'void', closed_at = now() where session_id = s.id and status = 'open';
  update public.dining_sessions set status = 'closed', closed_at = now(), closed_by = auth.uid() where id = s.id;
  perform public.dining_table_set_status_internal(t, 'cleaning');
  perform public.write_audit(_org_id, 'tables.session_closed_empty', s.id::text,
    jsonb_build_object('table', t.label));
end $$;

revoke all on function public.open_dining_session(uuid, uuid, uuid, integer, text, uuid) from public, anon;
revoke all on function public.update_dining_session(uuid, uuid, uuid, integer, uuid) from public, anon;
revoke all on function public.open_dining_check(uuid, uuid, uuid, text, text) from public, anon;
revoke all on function public.fire_check_round(uuid, uuid, uuid, text, jsonb, integer, text) from public, anon;
revoke all on function public.move_dining_session(uuid, uuid, uuid, uuid) from public, anon;
revoke all on function public.close_empty_dining_session(uuid, uuid, uuid) from public, anon;
grant execute on function public.open_dining_session(uuid, uuid, uuid, integer, text, uuid) to authenticated;
grant execute on function public.update_dining_session(uuid, uuid, uuid, integer, uuid) to authenticated;
grant execute on function public.open_dining_check(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.fire_check_round(uuid, uuid, uuid, text, jsonb, integer, text) to authenticated;
grant execute on function public.move_dining_session(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.close_empty_dining_session(uuid, uuid, uuid) to authenticated;
