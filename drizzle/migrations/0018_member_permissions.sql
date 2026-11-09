-- 0018_member_permissions — granular, per-module permissions on top of the owner/manager/staff tiers.
--
-- Model
--   * organization_members.role stays the SECURITY TIER (owner > manager > staff). It caps what a
--     member can ever be granted (role_ceiling) and keeps every existing tier-based rule intact.
--   * A member's effective permissions = (profile permissions, or the tier default when no profile)
--     ∪ extra_permissions − revoked_permissions, intersected with the tier ceiling. Owners have all.
--   * has_permission(org, perm, location) is the single backend authority; operational RPCs assert
--     it in addition to their existing org/location scope checks, and read RLS uses it.
--   * Members without a profile keep exactly the capabilities they had before this migration
--     (tier defaults mirror the previous can_manage_org / staff behaviour).

-- ---------------------------------------------------------------- catalog & tier rules
create or replace function public.permission_catalog()
returns text[] language sql immutable set search_path = public as $$
  select array[
    'dashboard.view','dashboard.financials',
    'pos.view','pos.sell','pos.discount',
    'orders.view','orders.update','orders.refund',
    'kds.view','kds.operate',
    'menu.view','menu.create','menu.edit','menu.delete',
    'inventory.view','inventory.create','inventory.edit','inventory.adjust','inventory.transfer',
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

-- Highest set a tier may ever hold. Staff never manage people or settings; branding/billing stay owner-only.
create or replace function public.role_ceiling(_role public.org_role)
returns text[] language sql immutable set search_path = public as $$
  select case _role
    when 'owner' then public.permission_catalog()
    when 'manager' then array(select p from unnest(public.permission_catalog()) p
                              where p not in ('settings.branding','settings.billing'))
    else array(select p from unnest(public.permission_catalog()) p
               where p not like 'team.%' and p not like 'settings.%')
  end
$$;

-- Defaults for members without a profile = what the tier could do before 0018.
create or replace function public.role_default_permissions(_role public.org_role)
returns text[] language sql immutable set search_path = public as $$
  select case _role
    when 'owner' then public.permission_catalog()
    when 'manager' then array(select p from unnest(public.role_ceiling('manager')) p
                              where p <> 'suppliers.edit')
    else array['dashboard.view','pos.view','pos.sell','pos.discount','orders.view','orders.update',
               'kds.view','kds.operate','menu.view','inventory.view','recipes.view','suppliers.view']::text[]
  end
$$;

-- ---------------------------------------------------------------- profiles
create table if not exists public.permission_profiles (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade, -- null = system template
  key text not null,
  name text not null check (length(trim(name)) between 2 and 60),
  description text not null default '',
  tier public.org_role not null check (tier in ('manager','staff')),
  permissions text[] not null default '{}',
  is_system boolean not null default false,
  archived_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists permission_profiles_org_key on public.permission_profiles(org_id, key) where org_id is not null;
create unique index if not exists permission_profiles_system_key on public.permission_profiles(key) where org_id is null;
alter table public.permission_profiles enable row level security;
drop policy if exists profiles_read on public.permission_profiles;
create policy profiles_read on public.permission_profiles for select to authenticated
  using (org_id is null or public.is_org_member(org_id));

alter table public.organization_members
  add column if not exists profile_id uuid references public.permission_profiles(id) on delete set null,
  add column if not exists extra_permissions text[] not null default '{}',
  add column if not exists revoked_permissions text[] not null default '{}';
alter table public.invitations
  add column if not exists profile_id uuid references public.permission_profiles(id) on delete set null;

-- System templates (editable copies are created per organization by the owner if needed).
insert into public.permission_profiles (org_id, key, name, description, tier, permissions, is_system) values
  (null,'org_admin','Organization admin','Everything except branding, billing and ownership.','manager',
     public.role_ceiling('manager'), true),
  (null,'manager','Store manager','Runs assigned stores: sales, kitchen, stock, purchases, expenses and staff.','manager',
     public.role_default_permissions('manager'), true),
  (null,'cashier','Cashier / front of house','Sells at the POS and follows orders.','staff',
     array['dashboard.view','pos.view','pos.sell','pos.discount','orders.view','orders.update','kds.view','menu.view'], true),
  (null,'kitchen','Kitchen','Works the kitchen display and reads recipes.','staff',
     array['dashboard.view','kds.view','kds.operate','orders.view','menu.view','recipes.view','inventory.view'], true),
  (null,'stock','Stock keeper','Keeps stock: items, counts, transfers, purchase orders and receiving.','staff',
     array['dashboard.view','inventory.view','inventory.create','inventory.edit','inventory.adjust','inventory.transfer',
           'recipes.view','purchases.view','purchases.create','purchases.receive','suppliers.view','menu.view'], true),
  (null,'finance','Finance','Bills, expenses, payments and financial reports.','staff',
     array['dashboard.view','dashboard.financials','finance.view','expenses.view','expenses.create','expenses.edit',
           'expenses.pay','reports.view','reports.export','purchases.view','suppliers.view'], true)
on conflict do nothing;

-- ---------------------------------------------------------------- resolution
create or replace function public.member_permissions(_member_id uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select case when m.role = 'owner' then public.permission_catalog() else
    array(
      select distinct p
      from unnest(coalesce(pp.permissions, public.role_default_permissions(m.role)) || m.extra_permissions) p
      where p = any(public.role_ceiling(m.role)) and not (p = any(m.revoked_permissions))
      order by p)
  end
  from public.organization_members m
  left join public.permission_profiles pp on pp.id = m.profile_id
  where m.id = _member_id
$$;

create or replace function public.has_permission(_org_id uuid, _perm text, _location_id uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
      select m.role = 'owner' or _perm = any(public.member_permissions(m.id))
      from public.organization_members m where m.org_id = _org_id and m.user_id = auth.uid()), false)
    and (_location_id is null or public.can_access_location(_location_id))
$$;

create or replace function public.has_any_permission(_org_id uuid, _perms text[], _location_id uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from unnest(_perms) p where public.has_permission(_org_id, p, _location_id))
$$;

-- Raises a stable, machine-readable code the API layer maps to a translated message.
create or replace function public.assert_permission(_org_id uuid, _perm text, _location_id uuid default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.has_permission(_org_id, _perm, _location_id) then
    raise exception 'permission_denied' using detail = _perm, hint = coalesce(_location_id::text, '');
  end if;
  if _location_id is not null then perform set_config('servora.audit_location', _location_id::text, true); end if;
end $$;

create or replace function public.my_permissions(_org_id uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select coalesce((select public.member_permissions(m.id) from public.organization_members m
                   where m.org_id = _org_id and m.user_id = auth.uid()), '{}'::text[])
$$;

-- ---------------------------------------------------------------- audit: store + result
alter table public.audit_logs
  add column if not exists location_id uuid,
  add column if not exists result text not null default 'success';
do $$ begin
  alter table public.audit_logs add constraint audit_logs_result_check check (result in ('success','denied','error'));
exception when duplicate_object then null; end $$;
create index if not exists audit_logs_org_created on public.audit_logs(org_id, created_at desc);

-- Same signature as before; now also records the store the operation was scoped to (set by the
-- scope/permission asserts within the same transaction).
create or replace function public.write_audit(_org uuid, _action text, _target text, _meta jsonb)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_logs (org_id, actor_id, action, target, metadata, location_id)
  values (_org, auth.uid(), _action, _target, coalesce(_meta, '{}'::jsonb),
          nullif(current_setting('servora.audit_location', true), '')::uuid);
$$;

create or replace function public.assert_operational_scope(_org_id uuid, _location_id uuid, _manage boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_org_member(_org_id) or not public.can_operate_location(_location_id)
     or not exists (select 1 from public.locations where id = _location_id and org_id = _org_id) then
    raise exception 'forbidden';
  end if;
  if _manage and not public.can_manage_org(_org_id) then raise exception 'forbidden'; end if;
  perform public.assert_org_operational(_org_id);
  perform set_config('servora.audit_location', _location_id::text, true);
end $$;

-- A refused operation rolls back its own transaction (and its audit row). The API layer reports the
-- refusal here in a separate call. Only the caller's own identity is recorded; non-members are ignored;
-- a small per-user rate limit prevents log flooding.
create or replace function public.log_access_denied(_org_id uuid, _action text, _location_id uuid default null, _detail text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or not public.is_org_member(_org_id) then return; end if;
  if (select count(*) from public.audit_logs where actor_id = auth.uid() and result = 'denied'
        and created_at > now() - interval '1 minute') >= 30 then return; end if;
  insert into public.audit_logs (org_id, actor_id, action, target, metadata, location_id, result)
  values (_org_id, auth.uid(), left(coalesce(_action, 'unknown'), 80), left(_detail, 120), '{}'::jsonb,
          case when exists (select 1 from public.locations where id = _location_id and org_id = _org_id)
               then _location_id end, 'denied');
end $$;

-- ---------------------------------------------------------------- team & profile management
create or replace function public.save_permission_profile(
  _org_id uuid, _id uuid, _name text, _description text, _tier public.org_role, _permissions text[])
returns uuid language plpgsql security definer set search_path = public as $$
declare _pid uuid; _clean text[];
begin
  if not public.is_org_owner(_org_id) then raise exception 'forbidden'; end if;
  perform public.assert_org_operational(_org_id);
  if _tier not in ('manager','staff') then raise exception 'invalid_tier'; end if;
  if coalesce(length(trim(_name)), 0) not between 2 and 60 then raise exception 'invalid_name'; end if;
  if exists (select 1 from unnest(coalesce(_permissions, '{}')) p where not p = any(public.role_ceiling(_tier))) then
    raise exception 'invalid_permission';
  end if;
  _clean := array(select distinct p from unnest(coalesce(_permissions, '{}')) p order by p);
  if _id is null then
    insert into public.permission_profiles (org_id, key, name, description, tier, permissions, created_by)
    values (_org_id, 'custom_' || encode(extensions.gen_random_bytes(5), 'hex'), trim(_name),
            coalesce(trim(_description), ''), _tier, _clean, auth.uid())
    returning id into _pid;
  else
    update public.permission_profiles
       set name = trim(_name), description = coalesce(trim(_description), ''), tier = _tier,
           permissions = _clean, updated_at = now()
     where id = _id and org_id = _org_id and not is_system and archived_at is null
    returning id into _pid;
    if _pid is null then raise exception 'forbidden'; end if;
    if exists (select 1 from public.organization_members where profile_id = _pid and role <> _tier) then
      raise exception 'profile_tier_in_use';
    end if;
  end if;
  perform public.write_audit(_org_id, 'permission_profile.saved', _pid::text,
    jsonb_build_object('name', trim(_name), 'tier', _tier, 'permissions', to_jsonb(_clean)));
  return _pid;
end $$;

create or replace function public.archive_permission_profile(_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare _p public.permission_profiles;
begin
  select * into _p from public.permission_profiles where id = _id for update;
  if _p.id is null or _p.is_system or _p.org_id is null or not public.is_org_owner(_p.org_id) then
    raise exception 'forbidden';
  end if;
  if exists (select 1 from public.organization_members where profile_id = _id) then raise exception 'profile_in_use'; end if;
  update public.permission_profiles set archived_at = now() where id = _id;
  perform public.write_audit(_p.org_id, 'permission_profile.archived', _id::text, jsonb_build_object('name', _p.name));
end $$;

-- One audited call for tier + profile + individual adjustments + stores.
create or replace function public.set_member_access(
  _member_id uuid, _role public.org_role, _profile_id uuid, _extra text[], _revoked text[], _location_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare _t public.organization_members; _me public.organization_members; _p public.permission_profiles;
        _before text[]; _after text[]; _mine text[];
begin
  select * into _t from public.organization_members where id = _member_id for update;
  if _t.id is null then raise exception 'forbidden'; end if;
  _me := public.my_member(_t.org_id);
  if _me.id is null then raise exception 'forbidden'; end if;
  perform public.assert_org_operational(_t.org_id);
  if _me.role <> 'owner' then
    if _t.user_id = auth.uid() or not public.has_permission(_t.org_id, 'team.manage')
       or not public.can_manage_member(_member_id) or _role is distinct from _t.role then
      raise exception 'forbidden';
    end if;
  end if;
  if exists (select 1 from unnest(coalesce(_extra, '{}') || coalesce(_revoked, '{}')) p
             where not p = any(public.permission_catalog())) then raise exception 'invalid_permission'; end if;
  if _profile_id is not null then
    select * into _p from public.permission_profiles where id = _profile_id and archived_at is null
      and (org_id is null or org_id = _t.org_id);
    if _p.id is null then raise exception 'invalid_profile'; end if;
    if _p.tier <> _role then raise exception 'profile_tier_mismatch'; end if;
  end if;
  if exists (select 1 from unnest(coalesce(_location_ids, '{}')) x
             where not exists (select 1 from public.locations l where l.id = x and l.org_id = _t.org_id)) then
    raise exception 'invalid_location';
  end if;
  if _me.role = 'manager' and exists (select 1 from unnest(coalesce(_location_ids, '{}')) x
      where x not in (select public.member_scope(_me.id))) then raise exception 'forbidden'; end if;

  _before := public.member_permissions(_member_id);
  update public.organization_members
     set role = _role, -- tier change: last-owner guard + audit via trigger
         profile_id = case when _role = 'owner' then null else _profile_id end,
         extra_permissions = case when _role = 'owner' then '{}' else array(select distinct p from unnest(coalesce(_extra, '{}')) p) end,
         revoked_permissions = case when _role = 'owner' then '{}' else array(select distinct p from unnest(coalesce(_revoked, '{}')) p) end
   where id = _member_id;
  if _role <> 'owner' then
    delete from public.member_location_access where member_id = _member_id
      and not (location_id = any(coalesce(_location_ids, '{}')));
    insert into public.member_location_access (member_id, location_id)
      select _member_id, x from unnest(coalesce(_location_ids, '{}')) x on conflict do nothing;
  end if;
  _after := public.member_permissions(_member_id);
  if _me.role = 'manager' then
    _mine := public.member_permissions(_me.id);
    if exists (select 1 from unnest(_after) p where not p = any(_mine)) then raise exception 'permission_exceeds_own'; end if;
  end if;
  perform public.write_audit(_t.org_id, 'member.access_changed', _t.user_id::text, jsonb_build_object(
    'role', _role, 'profile', _profile_id, 'locations', to_jsonb(coalesce(_location_ids, '{}')),
    'granted', to_jsonb(array(select p from unnest(_after) p where not p = any(_before))),
    'removed', to_jsonb(array(select p from unnest(_before) p where not p = any(_after)))));
end $$;

-- ---------------------------------------------------------------- grants
revoke all on function public.member_permissions(uuid), public.assert_permission(uuid, text, uuid)
  from public, anon, authenticated;
revoke all on function public.has_permission(uuid, text, uuid), public.has_any_permission(uuid, text[], uuid),
  public.my_permissions(uuid), public.log_access_denied(uuid, text, uuid, text),
  public.save_permission_profile(uuid, uuid, text, text, public.org_role, text[]),
  public.archive_permission_profile(uuid),
  public.set_member_access(uuid, public.org_role, uuid, text[], text[], uuid[]) from public, anon;
grant execute on function public.has_permission(uuid, text, uuid), public.has_any_permission(uuid, text[], uuid),
  public.my_permissions(uuid), public.log_access_denied(uuid, text, uuid, text),
  public.save_permission_profile(uuid, uuid, text, text, public.org_role, text[]),
  public.archive_permission_profile(uuid),
  public.set_member_access(uuid, public.org_role, uuid, text[], text[], uuid[]),
  public.permission_catalog(), public.role_ceiling(public.org_role), public.role_default_permissions(public.org_role)
  to authenticated;
revoke execute on function public.write_audit(uuid, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.assert_operational_scope(uuid, uuid, boolean) from public, anon, authenticated;
-- ---------------------------------------------------------------- RPC enforcement (derived from live definitions)
-- create_pos_sale
CREATE OR REPLACE FUNCTION public.create_pos_sale(_org_id uuid, _location_id uuid, _type order_type, _customer_name text, _customer_phone text DEFAULT NULL::text, _customer_email text DEFAULT NULL::text, _delivery_address text DEFAULT NULL::text, _table_number text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _discount_cents integer DEFAULT 0, _tax_rate_basis_points integer DEFAULT 0, _items jsonb DEFAULT '[]'::jsonb, _is_simulation boolean DEFAULT false, _client_order_id text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE existing public.orders; oid uuid; iid uuid; p public.menu_products; it jsonb; m jsonb; g jsonb; opt jsonb; q int; base int; mods int; subtotal int:=0; tax int; fingerprint text; n int; BEGIN
PERFORM public.assert_operational_scope(_org_id,_location_id); PERFORM public.assert_permission(_org_id,'pos.sell',_location_id); IF coalesce(_discount_cents,0)>0 THEN PERFORM public.assert_permission(_org_id,'pos.discount',_location_id); END IF;
IF _is_simulation AND NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=_org_id AND is_demo) THEN RAISE EXCEPTION 'simulation_forbidden'; END IF;
IF coalesce(length(trim(_client_order_id)),0) NOT BETWEEN 1 AND 160 OR _discount_cents IS NULL OR _discount_cents<0 OR _tax_rate_basis_points IS NULL OR _tax_rate_basis_points NOT BETWEEN 0 AND 10000 THEN RAISE EXCEPTION 'invalid_sale'; END IF;
IF jsonb_typeof(_items)<>'array' OR jsonb_array_length(_items) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'order_empty'; END IF;
fingerprint:=encode(extensions.digest(jsonb_build_object('location',_location_id,'type',_type,'items',_items,'discount',_discount_cents,'tax',_tax_rate_basis_points,'simulation',_is_simulation,'customer',_customer_name,'phone',_customer_phone,'email',_customer_email,'address',_delivery_address,'table',_table_number,'notes',_notes)::text,'sha256'),'hex');
PERFORM pg_advisory_xact_lock(hashtextextended(_org_id::text||':'||trim(_client_order_id),0));
SELECT * INTO existing FROM public.orders WHERE org_id=_org_id AND client_order_id=trim(_client_order_id);
IF existing.id IS NOT NULL THEN IF existing.request_hash<>fingerprint OR existing.location_id<>_location_id THEN RAISE EXCEPTION 'idempotency_conflict'; END IF; RETURN existing.id; END IF;
oid:=gen_random_uuid();
INSERT INTO public.orders(id,org_id,location_id,order_number,type,customer_name,customer_phone,customer_email,delivery_address,table_number,notes,discount_cents,tax_rate_basis_points,is_simulation,created_by,client_order_id,request_hash) VALUES(oid,_org_id,_location_id,'#'||upper(left(oid::text,8)),_type,coalesce(nullif(trim(_customer_name),''),'Walk-in'),_customer_phone,_customer_email,_delivery_address,_table_number,_notes,0,_tax_rate_basis_points,_is_simulation,auth.uid(),trim(_client_order_id),fingerprint);
FOR it IN SELECT * FROM jsonb_array_elements(_items) LOOP
SELECT * INTO p FROM public.menu_products WHERE org_id=_org_id AND (id::text=it->>'product_id' OR client_id=it->>'product_id') AND active FOR SHARE;
IF p.id IS NULL OR (cardinality(p.location_ids)>0 AND NOT _location_id=ANY(p.location_ids)) THEN RAISE EXCEPTION 'product_not_in_store'; END IF;
q:=(it->>'quantity')::int; IF q IS NULL OR q NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'invalid_quantity'; END IF; base:=p.price_cents; mods:=0;
IF jsonb_typeof(coalesce(it->'modifiers','[]'))<>'array' THEN RAISE EXCEPTION 'invalid_modifiers'; END IF;
IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(it->'modifiers','[]')) x GROUP BY x->>'group_id',x->>'option_id' HAVING count(*)>1) THEN RAISE EXCEPTION 'duplicate_modifier'; END IF;
FOR g IN SELECT * FROM jsonb_array_elements(p.modifier_groups) LOOP SELECT count(*) INTO n FROM jsonb_array_elements(coalesce(it->'modifiers','[]')) x WHERE x->>'group_id'=g->>'id'; IF n<greatest(coalesce((g->>'minSelections')::int,0),CASE WHEN coalesce((g->>'required')::boolean,false) THEN 1 ELSE 0 END) OR n>coalesce((g->>'maxSelections')::int,1) THEN RAISE EXCEPTION 'modifier_selection_invalid'; END IF; END LOOP;
FOR m IN SELECT * FROM jsonb_array_elements(coalesce(it->'modifiers','[]')) LOOP SELECT x INTO g FROM jsonb_array_elements(p.modifier_groups) x WHERE x->>'id'=m->>'group_id'; SELECT x INTO opt FROM jsonb_array_elements(coalesce(g->'options','[]')) x WHERE x->>'id'=m->>'option_id'; IF opt IS NULL THEN RAISE EXCEPTION 'modifier_not_in_product'; END IF; mods:=mods+(opt->>'priceCents')::int; END LOOP;
subtotal:=subtotal+(base+mods)*q;
INSERT INTO public.order_items(org_id,location_id,order_id,product_id,product_name,unit_price_cents,quantity,subtotal_cents,notes) VALUES(_org_id,_location_id,oid,p.id,p.name,base,q,(base+mods)*q,it->>'notes') RETURNING id INTO iid;
FOR m IN SELECT * FROM jsonb_array_elements(coalesce(it->'modifiers','[]')) LOOP SELECT x INTO g FROM jsonb_array_elements(p.modifier_groups) x WHERE x->>'id'=m->>'group_id'; SELECT x INTO opt FROM jsonb_array_elements(g->'options') x WHERE x->>'id'=m->>'option_id'; INSERT INTO public.order_item_modifiers(order_item_id,option_id,group_id,group_name,option_name,price_cents) VALUES(iid,opt->>'id',g->>'id',g->>'name',opt->>'name',(opt->>'priceCents')::int); END LOOP; END LOOP;
IF _discount_cents>subtotal THEN RAISE EXCEPTION 'invalid_discount'; END IF; tax:=round((subtotal-_discount_cents)::numeric*_tax_rate_basis_points/10000);
UPDATE public.orders SET subtotal_cents=subtotal,discount_cents=_discount_cents,tax_cents=tax,total_cents=subtotal-_discount_cents+tax WHERE id=oid;
INSERT INTO public.order_status_history(org_id,location_id,order_id,to_status,actor_id,reason) VALUES(_org_id,_location_id,oid,'new',auth.uid(),'Order created');
PERFORM public.write_audit(_org_id,'orders.created',oid::text,jsonb_build_object('client_order_id',_client_order_id)); RETURN oid; END $function$;

-- finalize_pos_sale_atomic
CREATE OR REPLACE FUNCTION public.finalize_pos_sale_atomic(_org_id uuid, _location_id uuid, _type order_type, _customer_name text, _customer_phone text DEFAULT NULL::text, _customer_email text DEFAULT NULL::text, _delivery_address text DEFAULT NULL::text, _table_number text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _discount_cents integer DEFAULT 0, _tax_rate_basis_points integer DEFAULT 0, _items jsonb DEFAULT '[]'::jsonb, _is_simulation boolean DEFAULT false, _client_order_id text DEFAULT NULL::text, _payment_method text DEFAULT 'cash'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE oid uuid; ord public.orders; pay public.payments; stock public.inventory_items; req record; cost int:=0; BEGIN
PERFORM public.assert_operational_scope(_org_id,_location_id); PERFORM public.assert_permission(_org_id,'pos.sell',_location_id); IF _payment_method NOT IN('cash','card','digital') OR _payment_method IS NULL THEN RAISE EXCEPTION 'invalid_payment'; END IF;
oid:=public.create_pos_sale(_org_id,_location_id,_type,_customer_name,_customer_phone,_customer_email,_delivery_address,_table_number,_notes,_discount_cents,_tax_rate_basis_points,_items,_is_simulation,_client_order_id);
SELECT * INTO ord FROM public.orders WHERE id=oid FOR UPDATE; SELECT * INTO pay FROM public.payments WHERE order_id=oid;
IF pay.id IS NOT NULL THEN IF pay.method<>_payment_method THEN RAISE EXCEPTION 'idempotency_conflict'; END IF; RETURN oid; END IF; IF ord.status='cancelled' THEN RAISE EXCEPTION 'order_cancelled'; END IF;
IF NOT ord.is_simulation THEN
FOR req IN SELECT ri.inventory_item_id,sum(public.operational_unit_quantity(ri.quantity,ri.unit,s.unit)*(1+ri.waste_percentage/100)*oi.quantity/r.servings) AS qty FROM public.order_items oi JOIN public.product_recipes r ON r.product_id=oi.product_id AND r.org_id=_org_id AND r.location_id=_location_id JOIN public.recipe_ingredients ri ON ri.recipe_id=r.id JOIN public.inventory_items s ON s.id=ri.inventory_item_id WHERE oi.order_id=oid GROUP BY ri.inventory_item_id ORDER BY ri.inventory_item_id LOOP
SELECT * INTO stock FROM public.inventory_items WHERE id=req.inventory_item_id AND org_id=_org_id AND location_id=_location_id FOR UPDATE;
IF NOT stock.active OR stock.quantity<req.qty THEN RAISE EXCEPTION 'insufficient_stock'; END IF; UPDATE public.inventory_items SET quantity=quantity-req.qty,updated_at=now() WHERE id=stock.id;
INSERT INTO public.inventory_movements(org_id,location_id,inventory_item_id,order_id,delta,unit_cost_cents,kind,client_event_id,reason,actor_id) VALUES(_org_id,_location_id,stock.id,oid,-req.qty,stock.cost_cents,'sale','sale:'||oid::text,'Recipe consumption',auth.uid()); cost:=cost+round(req.qty*stock.cost_cents); END LOOP;
INSERT INTO public.finance_entries(org_id,location_id,order_id,kind,amount_cents,client_event_id,description,actor_id) VALUES(_org_id,_location_id,oid,'revenue',ord.total_cents-ord.tax_cents,'sale:'||oid::text,'POS net of tax',auth.uid()),(_org_id,_location_id,oid,'cogs',cost,'sale:'||oid::text,'Recipe cost (configured ingredients only)',auth.uid()); END IF;
INSERT INTO public.payments(org_id,location_id,order_id,method,amount_cents) VALUES(_org_id,_location_id,oid,_payment_method,ord.total_cents);
UPDATE public.orders SET status='confirmed',updated_at=now() WHERE id=oid; INSERT INTO public.order_status_history(org_id,location_id,order_id,from_status,to_status,actor_id,reason) VALUES(_org_id,_location_id,oid,ord.status,'confirmed',auth.uid(),'Payment recorded (not provider capture)');
PERFORM public.write_audit(_org_id,'pos.finalized',oid::text,jsonb_build_object('payment_method',_payment_method)); RETURN oid; END $function$;

-- update_order_status
CREATE OR REPLACE FUNCTION public.update_order_status(_order_id uuid, _new_status order_status, _reason text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ DECLARE ord public.orders; BEGIN
SELECT * INTO ord FROM public.orders WHERE id=_order_id FOR UPDATE; IF ord.id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF; PERFORM public.assert_operational_scope(ord.org_id,ord.location_id); IF NOT public.has_any_permission(ord.org_id,ARRAY['orders.update','kds.operate'],ord.location_id) THEN RAISE EXCEPTION 'permission_denied' USING DETAIL='orders.update'; END IF;
IF _new_status='cancelled' THEN PERFORM public.cancel_order_with_reversal(_order_id,_reason); RETURN; END IF; IF ord.status=_new_status THEN RETURN; END IF;
IF NOT ((ord.status IN('new','confirmed') AND _new_status='in_prep') OR (ord.status='new' AND _new_status='confirmed') OR (ord.status='in_prep' AND _new_status='ready') OR (ord.status='ready' AND _new_status='delivered') OR (ord.status='delivered' AND _new_status='in_prep' AND public.can_manage_org(ord.org_id))) THEN RAISE EXCEPTION 'invalid_transition'; END IF;
UPDATE public.orders SET status=_new_status,updated_at=now() WHERE id=_order_id;
INSERT INTO public.order_status_history(org_id,location_id,order_id,from_status,to_status,actor_id,reason) VALUES(ord.org_id,ord.location_id,_order_id,ord.status,_new_status,auth.uid(),_reason); PERFORM public.write_audit(ord.org_id,'orders.status_changed',_order_id::text,jsonb_build_object('from',ord.status,'to',_new_status)); END $function$;

-- cancel_order_with_reversal
CREATE OR REPLACE FUNCTION public.cancel_order_with_reversal(_order_id uuid, _reason text DEFAULT 'Cancelled'::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ DECLARE ord public.orders; m public.inventory_movements; f public.finance_entries; BEGIN
SELECT * INTO ord FROM public.orders WHERE id=_order_id FOR UPDATE; IF ord.id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF; PERFORM public.assert_operational_scope(ord.org_id,ord.location_id); PERFORM public.assert_permission(ord.org_id,'orders.refund',ord.location_id); IF ord.status='cancelled' THEN RETURN; END IF;
FOR m IN SELECT * FROM public.inventory_movements WHERE order_id=_order_id AND kind='sale' ORDER BY inventory_item_id LOOP
UPDATE public.inventory_items SET quantity=quantity-m.delta,updated_at=now() WHERE id=m.inventory_item_id;
INSERT INTO public.inventory_movements(org_id,location_id,inventory_item_id,order_id,delta,unit_cost_cents,kind,client_event_id,reverses_id,reason,actor_id) VALUES(m.org_id,m.location_id,m.inventory_item_id,_order_id,-m.delta,m.unit_cost_cents,'reversal','reversal:'||_order_id::text,m.id,_reason,auth.uid()); END LOOP;
FOR f IN SELECT * FROM public.finance_entries WHERE order_id=_order_id AND kind IN('revenue','cogs') LOOP INSERT INTO public.finance_entries(org_id,location_id,order_id,kind,amount_cents,client_event_id,reverses_id,description,actor_id) VALUES(f.org_id,f.location_id,_order_id,'reversal_'||f.kind,f.amount_cents,'reversal:'||_order_id::text,f.id,_reason,auth.uid()); END LOOP;
UPDATE public.payments SET status='reversed',reversed_at=now() WHERE order_id=_order_id; UPDATE public.orders SET status='cancelled',updated_at=now() WHERE id=_order_id;
INSERT INTO public.order_status_history(org_id,location_id,order_id,from_status,to_status,actor_id,reason) VALUES(ord.org_id,ord.location_id,_order_id,ord.status,'cancelled',auth.uid(),_reason); PERFORM public.write_audit(ord.org_id,'orders.cancelled',_order_id::text,jsonb_build_object('reason',_reason)); END $function$;

-- set_order_item_ready
CREATE OR REPLACE FUNCTION public.set_order_item_ready(_item_id uuid, _ready boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ DECLARE it public.order_items; BEGIN SELECT * INTO it FROM public.order_items WHERE id=_item_id; IF it.id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF; PERFORM public.assert_operational_scope(it.org_id,it.location_id); IF NOT public.has_any_permission(it.org_id,ARRAY['kds.operate','orders.update'],it.location_id) THEN RAISE EXCEPTION 'permission_denied' USING DETAIL='kds.operate'; END IF; UPDATE public.order_items SET is_item_ready=_ready WHERE id=_item_id; UPDATE public.orders SET updated_at=now() WHERE id=it.order_id; PERFORM public.write_audit(it.org_id,'orders.item_ready',_item_id::text,jsonb_build_object('ready',_ready)); END $function$;

-- save_operational_menu
CREATE OR REPLACE FUNCTION public.save_operational_menu(_org_id uuid, _kind text, _payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ DECLARE id0 uuid; cid uuid; locs uuid[]; oldlocs uuid[]; g jsonb; o jsonb; BEGIN
IF auth.uid() IS NULL OR NOT public.is_org_member(_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF; PERFORM public.assert_permission(_org_id, CASE WHEN _kind='product' AND NOT EXISTS(SELECT 1 FROM public.menu_products WHERE org_id=_org_id AND client_id=_payload->>'id') THEN 'menu.create' ELSE 'menu.edit' END); PERFORM public.assert_org_operational(_org_id);
IF length(coalesce(_payload->>'name','')) NOT BETWEEN 1 AND 160 OR length(coalesce(_payload->>'id','')) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_menu'; END IF;
IF _kind='category' THEN IF NOT public.is_org_owner(_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
INSERT INTO public.menu_categories(org_id,client_id,name,description,active) VALUES(_org_id,_payload->>'id',_payload->>'name',coalesce(_payload->>'description',''),coalesce((_payload->>'active')::boolean,true)) ON CONFLICT(org_id,client_id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,active=EXCLUDED.active RETURNING id INTO id0;
ELSIF _kind='product' THEN
SELECT coalesce(array_agg(value::uuid),'{}') INTO locs FROM jsonb_array_elements_text(coalesce(_payload->'locationIds','[]'));
IF EXISTS(SELECT 1 FROM unnest(locs) x WHERE NOT EXISTS(SELECT 1 FROM public.locations WHERE id=x AND org_id=_org_id) OR NOT public.can_operate_location(x)) THEN RAISE EXCEPTION 'forbidden'; END IF;
IF cardinality(locs)=0 AND NOT public.is_org_owner(_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
SELECT location_ids INTO oldlocs FROM public.menu_products WHERE org_id=_org_id AND client_id=_payload->>'id' FOR UPDATE;
IF oldlocs IS NOT NULL AND NOT public.is_org_owner(_org_id) AND (cardinality(oldlocs)=0 OR EXISTS(SELECT 1 FROM unnest(oldlocs) x WHERE NOT public.can_operate_location(x))) THEN RAISE EXCEPTION 'forbidden'; END IF;
SELECT id INTO cid FROM public.menu_categories WHERE org_id=_org_id AND client_id=_payload->>'category' AND active; IF cid IS NULL THEN RAISE EXCEPTION 'category_required'; END IF;
IF jsonb_typeof(coalesce(_payload->'modifierGroups','[]'))<>'array' THEN RAISE EXCEPTION 'invalid_modifiers'; END IF;
IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(_payload->'modifierGroups','[]')) AS groups(value) GROUP BY groups.value->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'duplicate_modifier_group'; END IF; FOR g IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'modifierGroups','[]')) LOOP
IF coalesce(g->>'id','')='' OR coalesce((g->>'minSelections')::int,0)<0 OR coalesce((g->>'maxSelections')::int,1)<greatest(coalesce((g->>'minSelections')::int,0),CASE WHEN coalesce((g->>'required')::boolean,false) THEN 1 ELSE 0 END) THEN RAISE EXCEPTION 'invalid_modifiers'; END IF;
IF jsonb_typeof(g->'options') IS DISTINCT FROM 'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(g->'options') AS options(value) GROUP BY options.value->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'duplicate_modifier_option'; END IF; FOR o IN SELECT * FROM jsonb_array_elements(g->'options') LOOP IF coalesce(o->>'id','')='' OR o->>'priceCents' IS NULL OR (o->>'priceCents')::int<0 THEN RAISE EXCEPTION 'invalid_modifiers'; END IF; END LOOP; END LOOP;
INSERT INTO public.menu_products(org_id,client_id,category_id,name,description,price_cents,prep_time_minutes,image_url,notes,active,location_ids,modifier_groups) VALUES(_org_id,_payload->>'id',cid,_payload->>'name',coalesce(_payload->>'description',''),(_payload->>'priceCents')::int,coalesce((_payload->>'prepTimeMinutes')::int,10),_payload->>'imageUrl',_payload->>'notes',coalesce((_payload->>'active')::boolean,true),locs,coalesce(_payload->'modifierGroups','[]')) ON CONFLICT(org_id,client_id) DO UPDATE SET category_id=EXCLUDED.category_id,name=EXCLUDED.name,description=EXCLUDED.description,price_cents=EXCLUDED.price_cents,prep_time_minutes=EXCLUDED.prep_time_minutes,image_url=EXCLUDED.image_url,notes=EXCLUDED.notes,active=EXCLUDED.active,location_ids=EXCLUDED.location_ids,modifier_groups=EXCLUDED.modifier_groups,updated_at=now() RETURNING id INTO id0;
ELSE RAISE EXCEPTION 'invalid_kind'; END IF; PERFORM public.write_audit(_org_id,'menu.saved',id0::text,jsonb_build_object('kind',_kind)); RETURN id0; END $function$;

-- archive_operational_menu
CREATE OR REPLACE FUNCTION public.archive_operational_menu(_org_id uuid, _kind text, _client_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ DECLARE p public.menu_products; BEGIN
IF auth.uid() IS NULL OR NOT public.is_org_member(_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF; PERFORM public.assert_permission(_org_id,'menu.delete'); PERFORM public.assert_org_operational(_org_id);
IF _kind='category' THEN IF NOT public.is_org_owner(_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
IF EXISTS(SELECT 1 FROM public.menu_products p JOIN public.menu_categories c ON c.id=p.category_id WHERE c.org_id=_org_id AND c.client_id=_client_id AND p.active) THEN RAISE EXCEPTION 'category_in_use'; END IF; UPDATE public.menu_categories SET active=false WHERE org_id=_org_id AND client_id=_client_id;
ELSIF _kind='product' THEN SELECT * INTO p FROM public.menu_products WHERE org_id=_org_id AND client_id=_client_id FOR UPDATE;
IF p.id IS NULL OR (NOT public.is_org_owner(_org_id) AND (cardinality(p.location_ids)=0 OR EXISTS(SELECT 1 FROM unnest(p.location_ids) x WHERE NOT public.can_operate_location(x)))) THEN RAISE EXCEPTION 'forbidden'; END IF; UPDATE public.menu_products SET active=false,updated_at=now() WHERE id=p.id;
ELSE RAISE EXCEPTION 'invalid_kind'; END IF; PERFORM public.write_audit(_org_id,'menu.archived',_client_id,jsonb_build_object('kind',_kind)); END $function$;

-- save_operational_record
CREATE OR REPLACE FUNCTION public.save_operational_record(_org_id uuid, _location_id uuid, _kind text, _payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE id0 uuid; item jsonb; ref uuid; product uuid; category text; existing public.inventory_items; recipe public.product_recipes; po public.purchase_orders; BEGIN
IF _kind='whatsapp' THEN IF auth.uid() IS NULL OR NOT public.is_org_owner(_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF; PERFORM public.assert_org_operational(_org_id);ELSIF _kind='supplier' THEN IF auth.uid() IS NULL OR NOT public.is_org_member(_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF; PERFORM public.assert_permission(_org_id,'suppliers.edit'); PERFORM public.assert_org_operational(_org_id);ELSE PERFORM public.assert_operational_scope(_org_id,_location_id); PERFORM public.assert_permission(_org_id, CASE _kind WHEN 'inventory' THEN CASE WHEN coalesce(_payload->>'id','')='' THEN 'inventory.create' ELSE 'inventory.edit' END WHEN 'recipe' THEN 'recipes.edit' WHEN 'purchase' THEN 'purchases.create' WHEN 'expense' THEN CASE WHEN coalesce(_payload->>'id','')='' THEN 'expenses.create' ELSE 'expenses.edit' END ELSE 'invalid_kind' END, _location_id); IF _kind='purchase' AND coalesce(_payload->>'status','draft')='sent' THEN PERFORM public.assert_permission(_org_id,'purchases.approve',_location_id); END IF; IF _kind='expense' AND coalesce(_payload->>'status','')='paid' AND NOT EXISTS(SELECT 1 FROM public.finance_expenses WHERE id::text=coalesce(_payload->>'id','') AND payload->>'status'='paid') THEN PERFORM public.assert_permission(_org_id,'expenses.pay',_location_id); END IF; IF _kind='expense' AND coalesce((_payload->>'active')::boolean,true)=false THEN PERFORM public.assert_permission(_org_id,'expenses.delete',_location_id); END IF; END IF;
IF jsonb_typeof(_payload)<>'object' THEN RAISE EXCEPTION 'invalid_payload'; END IF;
IF coalesce(_payload->>'id','')<>'' THEN id0:=(_payload->>'id')::uuid; END IF;
IF _kind='inventory' THEN IF NOT (_payload ? 'quantity' AND _payload ? 'costCents' AND _payload ? 'unit') OR _payload->>'quantity' IS NULL OR _payload->>'costCents' IS NULL OR _payload->>'unit' NOT IN('oz','lb','gal','kg','units','pack') THEN RAISE EXCEPTION 'invalid_inventory'; END IF;
 IF length(coalesce(_payload->>'name','')) NOT BETWEEN 1 AND 160 OR (_payload->>'costCents')::int<0 OR (_payload->>'quantity')::numeric<0 THEN RAISE EXCEPTION 'invalid_inventory'; END IF;
 IF id0 IS NOT NULL THEN SELECT * INTO existing FROM public.inventory_items WHERE id=id0 AND org_id=_org_id AND location_id=_location_id FOR UPDATE; IF existing.id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
 UPDATE public.inventory_items SET name=_payload->>'name',category=coalesce(_payload->>'category','dry_goods'),sku=coalesce(_payload->>'sku',''),min_quantity=coalesce((_payload->>'minQuantity')::numeric,0),cost_cents=(_payload->>'costCents')::int,supplier=coalesce(_payload->>'supplier',''),active=coalesce((_payload->>'active')::boolean,true),updated_at=now() WHERE id=id0;
 ELSE id0:=gen_random_uuid(); INSERT INTO public.inventory_items(id,org_id,location_id,client_id,name,category,sku,unit,quantity,min_quantity,cost_cents,supplier) VALUES(id0,_org_id,_location_id,id0::text,_payload->>'name',coalesce(_payload->>'category','dry_goods'),coalesce(_payload->>'sku',''),_payload->>'unit',(_payload->>'quantity')::numeric,coalesce((_payload->>'minQuantity')::numeric,0),(_payload->>'costCents')::int,coalesce(_payload->>'supplier',''));
 IF (_payload->>'quantity')::numeric>0 THEN INSERT INTO public.inventory_movements(org_id,location_id,inventory_item_id,delta,unit_cost_cents,kind,client_event_id,reason,actor_id) VALUES(_org_id,_location_id,id0,(_payload->>'quantity')::numeric,(_payload->>'costCents')::int,'opening','opening:'||id0::text,'Opening stock',auth.uid()); END IF; END IF;
ELSIF _kind='recipe' THEN
 SELECT id INTO product FROM public.menu_products WHERE org_id=_org_id AND (id::text=_payload->>'productId' OR client_id=_payload->>'productId') AND active AND (cardinality(location_ids)=0 OR _location_id=ANY(location_ids)); IF product IS NULL THEN RAISE EXCEPTION 'product_required'; END IF;
 IF id0 IS NOT NULL THEN SELECT * INTO recipe FROM public.product_recipes WHERE id=id0 AND org_id=_org_id AND location_id=_location_id FOR UPDATE; IF recipe.id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF; END IF;
 IF jsonb_typeof(_payload->'ingredients')<>'array' OR jsonb_array_length(_payload->'ingredients')=0 THEN RAISE EXCEPTION 'ingredients_required'; END IF;
 IF id0 IS NULL THEN id0:=gen_random_uuid(); END IF;
 INSERT INTO public.product_recipes(id,org_id,location_id,product_id,servings,yield_quantity,yield_unit,instructions,metadata) VALUES(id0,_org_id,_location_id,product,(_payload->>'servings')::numeric,coalesce((_payload->>'yieldQuantity')::numeric,1),coalesce(_payload->>'yieldUnit','units'),coalesce(_payload->>'prepInstructions',''),_payload)
 ON CONFLICT(id) DO UPDATE SET servings=EXCLUDED.servings,yield_quantity=EXCLUDED.yield_quantity,yield_unit=EXCLUDED.yield_unit,instructions=EXCLUDED.instructions,metadata=EXCLUDED.metadata,updated_at=now();
 DELETE FROM public.recipe_ingredients WHERE recipe_id=id0;
 FOR item IN SELECT * FROM jsonb_array_elements(_payload->'ingredients') LOOP
  ref:=(item->>'inventoryItemId')::uuid;
  IF NOT EXISTS(SELECT 1 FROM public.inventory_items WHERE id=ref AND org_id=_org_id AND location_id=_location_id AND active) THEN RAISE EXCEPTION 'ingredient_not_in_store'; END IF;
  PERFORM public.operational_unit_quantity((item->>'quantity')::numeric,item->>'unit',(SELECT unit FROM public.inventory_items WHERE id=ref));
  INSERT INTO public.recipe_ingredients(org_id,location_id,recipe_id,inventory_item_id,quantity,unit,waste_percentage) VALUES(_org_id,_location_id,id0,ref,(item->>'quantity')::numeric,item->>'unit',coalesce((item->>'wastePercentage')::numeric,0)); END LOOP;
ELSIF _kind='supplier' THEN
 IF id0 IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=id0 AND org_id=_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF coalesce(length(trim(_payload->>'name')),0)=0 THEN RAISE EXCEPTION 'invalid_supplier'; END IF;
 IF id0 IS NULL THEN id0:=gen_random_uuid(); END IF;
 INSERT INTO public.suppliers(id,org_id,name,details,active) VALUES(id0,_org_id,_payload->>'name',_payload,coalesce((_payload->>'active')::boolean,true)) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,details=EXCLUDED.details,active=EXCLUDED.active,updated_at=now();
ELSIF _kind='purchase' THEN
 IF id0 IS NOT NULL THEN SELECT * INTO po FROM public.purchase_orders WHERE id=id0 AND org_id=_org_id AND location_id=_location_id FOR UPDATE; IF po.id IS NULL OR po.status NOT IN('draft','sent') OR EXISTS(SELECT 1 FROM public.purchase_receipts WHERE purchase_order_id=id0) THEN RAISE EXCEPTION 'purchase_locked'; END IF; END IF;
 ref:=(_payload->>'supplierId')::uuid; IF NOT EXISTS(SELECT 1 FROM public.suppliers WHERE id=ref AND org_id=_org_id AND active) THEN RAISE EXCEPTION 'supplier_required'; END IF;
 IF coalesce(_payload->>'status','draft') NOT IN('draft','sent') THEN RAISE EXCEPTION 'invalid_purchase_status'; END IF;
 IF jsonb_typeof(_payload->'items')<>'array' OR jsonb_array_length(_payload->'items')=0 THEN RAISE EXCEPTION 'items_required'; END IF;
 IF id0 IS NULL THEN id0:=gen_random_uuid(); END IF;
 INSERT INTO public.purchase_orders(id,org_id,location_id,supplier_id,status,discount_cents,tax_cents,shipping_cents,notes,metadata) VALUES(id0,_org_id,_location_id,ref,coalesce(_payload->>'status','draft'),coalesce((_payload->>'discountCents')::int,0),coalesce((_payload->>'taxCents')::int,0),coalesce((_payload->>'shippingCents')::int,0),coalesce(_payload->>'notes',''),_payload) ON CONFLICT(id) DO UPDATE SET supplier_id=EXCLUDED.supplier_id,status=EXCLUDED.status,discount_cents=EXCLUDED.discount_cents,tax_cents=EXCLUDED.tax_cents,shipping_cents=EXCLUDED.shipping_cents,notes=EXCLUDED.notes,metadata=EXCLUDED.metadata,updated_at=now();
 DELETE FROM public.purchase_order_items WHERE purchase_order_id=id0;
 FOR item IN SELECT * FROM jsonb_array_elements(_payload->'items') LOOP INSERT INTO public.purchase_order_items(org_id,location_id,purchase_order_id,inventory_item_id,quantity_ordered,unit_price_cents) VALUES(_org_id,_location_id,id0,(item->>'inventoryItemId')::uuid,(item->>'quantityOrdered')::numeric,(item->>'unitPriceCents')::int); END LOOP;
 IF (SELECT sum(round(quantity_ordered*unit_price_cents)) FROM public.purchase_order_items WHERE purchase_order_id=id0)<coalesce((_payload->>'discountCents')::int,0) THEN RAISE EXCEPTION 'invalid_discount'; END IF;
ELSIF _kind='expense' THEN
 IF id0 IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.finance_expenses WHERE id=id0 AND org_id=_org_id AND location_id=_location_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF (_payload->>'amountCents')::int<0 OR coalesce(_payload->>'status','') NOT IN('pending','paid','overdue') OR coalesce(_payload->>'recurrence','') NOT IN('fixed','variable','recurring') OR coalesce(_payload->>'description','')='' THEN RAISE EXCEPTION 'invalid_expense'; END IF;
 IF coalesce((_payload->>'isSimulation')::boolean,false) AND NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=_org_id AND is_demo) THEN RAISE EXCEPTION 'simulation_forbidden'; END IF;
 IF id0 IS NULL THEN id0:=gen_random_uuid(); END IF;
 INSERT INTO public.finance_expenses(id,org_id,location_id,payload,active) VALUES(id0,_org_id,_location_id,_payload,coalesce((_payload->>'active')::boolean,true)) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,active=EXCLUDED.active,updated_at=now();
ELSIF _kind='whatsapp' THEN
 IF id0 IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.whatsapp_records WHERE id=id0 AND org_id=_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
 IF _payload->>'kind'='contact' AND coalesce((_payload->>'consentGranted')::boolean,false)=false THEN RAISE EXCEPTION 'consent_required'; END IF;
 IF coalesce(_payload->>'status','') IN('sent','delivered') THEN RAISE EXCEPTION 'provider_unavailable'; END IF;
 IF id0 IS NULL THEN id0:=gen_random_uuid(); END IF;
 INSERT INTO public.whatsapp_records(id,org_id,kind,payload,is_simulation) VALUES(id0,_org_id,_payload->>'kind',_payload,true) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=now();
ELSE RAISE EXCEPTION 'invalid_kind'; END IF;
PERFORM public.write_audit(_org_id,_kind||'.saved',id0::text,'{}'); RETURN id0;
END $function$;

-- record_operational_movement
CREATE OR REPLACE FUNCTION public.record_operational_movement(_org_id uuid, _location_id uuid, _item_id uuid, _type text, _quantity numeric, _reason text, _client_event_id text, _target_location_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE item public.inventory_items; target public.inventory_items; prior public.inventory_movements; d numeric; mid uuid; fingerprint text; BEGIN
PERFORM public.assert_operational_scope(_org_id,_location_id); PERFORM public.assert_permission(_org_id, CASE WHEN _type='transfer' THEN 'inventory.transfer' ELSE 'inventory.adjust' END, _location_id);
IF _client_event_id IS NULL OR length(_client_event_id) NOT BETWEEN 1 AND 160 OR _quantity IS NULL OR _quantity<0 OR coalesce(length(trim(_reason)),0)=0 THEN RAISE EXCEPTION 'invalid_movement'; END IF;
IF _type='transfer' THEN PERFORM public.assert_operational_scope(_org_id,_target_location_id); PERFORM public.assert_permission(_org_id,'inventory.transfer',_target_location_id); PERFORM set_config('servora.audit_location',_location_id::text,true); IF _target_location_id=_location_id THEN RAISE EXCEPTION 'invalid_transfer'; END IF; END IF;
fingerprint:=md5(jsonb_build_object('org',_org_id,'location',_location_id,'item',_item_id,'type',_type,'quantity',_quantity,'reason',_reason,'target',_target_location_id)::text); PERFORM pg_advisory_xact_lock(hashtextextended(_org_id::text||':'||_client_event_id,0));
SELECT * INTO item FROM public.inventory_items WHERE id=_item_id AND org_id=_org_id AND location_id=_location_id FOR UPDATE; IF item.id IS NULL OR NOT item.active THEN RAISE EXCEPTION 'forbidden'; END IF;
SELECT * INTO prior FROM public.inventory_movements WHERE org_id=_org_id AND client_event_id=_client_event_id AND inventory_item_id=_item_id;
IF prior.id IS NOT NULL THEN IF prior.request_hash IS DISTINCT FROM fingerprint THEN RAISE EXCEPTION 'idempotency_conflict'; END IF; RETURN prior.id; END IF;
d:=CASE _type WHEN 'in' THEN _quantity WHEN 'out' THEN -_quantity WHEN 'loss' THEN -_quantity WHEN 'transfer' THEN -_quantity WHEN 'adjustment' THEN _quantity-item.quantity ELSE NULL END;
IF d IS NULL OR d=0 OR item.quantity+d<0 THEN RAISE EXCEPTION 'invalid_quantity'; END IF;
UPDATE public.inventory_items SET quantity=quantity+d,updated_at=now() WHERE id=_item_id;
INSERT INTO public.inventory_movements(org_id,location_id,inventory_item_id,delta,unit_cost_cents,kind,client_event_id,reason,actor_id) VALUES(_org_id,_location_id,_item_id,d,item.cost_cents,CASE WHEN _type='transfer' THEN 'transfer_out' ELSE 'adjustment' END,_client_event_id,_reason,auth.uid()) RETURNING id INTO mid; UPDATE public.inventory_movements SET request_hash=fingerprint WHERE id=mid;
IF _type='transfer' THEN
 SELECT * INTO target FROM public.inventory_items WHERE org_id=_org_id AND location_id=_target_location_id AND client_id=item.client_id FOR UPDATE;
 IF target.id IS NULL THEN INSERT INTO public.inventory_items(org_id,location_id,client_id,name,category,sku,unit,quantity,min_quantity,cost_cents,supplier) VALUES(_org_id,_target_location_id,item.client_id,item.name,item.category,item.sku,item.unit,0,item.min_quantity,item.cost_cents,item.supplier) RETURNING * INTO target; END IF;
 IF target.unit<>item.unit THEN RAISE EXCEPTION 'incompatible_units'; END IF;
 UPDATE public.inventory_items SET quantity=quantity+_quantity,updated_at=now() WHERE id=target.id;
 INSERT INTO public.inventory_movements(org_id,location_id,inventory_item_id,delta,unit_cost_cents,kind,client_event_id,reason,actor_id) VALUES(_org_id,_target_location_id,target.id,_quantity,item.cost_cents,'transfer_in',_client_event_id,_reason,auth.uid()); END IF;
PERFORM public.write_audit(_org_id,'inventory.moved',mid::text,jsonb_build_object('type',_type,'quantity',_quantity)); RETURN mid; END $function$;

-- receive_operational_purchase
CREATE OR REPLACE FUNCTION public.receive_operational_purchase(_purchase_id uuid, _items jsonb, _client_event_id text, _notes text DEFAULT ''::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE po public.purchase_orders; it public.purchase_order_items; x jsonb; prior public.purchase_receipts; rid uuid; qty numeric; price int; amount int:=0; fingerprint text; BEGIN
SELECT * INTO po FROM public.purchase_orders WHERE id=_purchase_id FOR UPDATE; IF po.id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF; PERFORM public.assert_operational_scope(po.org_id,po.location_id); PERFORM public.assert_permission(po.org_id,'purchases.receive',po.location_id);
IF coalesce(length(trim(_client_event_id)),0) NOT BETWEEN 1 AND 160 OR jsonb_typeof(_items)<>'array' OR jsonb_array_length(_items)=0 THEN RAISE EXCEPTION 'invalid_receipt'; END IF;
fingerprint:=encode(extensions.digest(jsonb_build_object('po',_purchase_id,'items',_items,'notes',_notes)::text,'sha256'),'hex');
PERFORM pg_advisory_xact_lock(hashtextextended(po.org_id::text||':'||_client_event_id,0));
SELECT * INTO prior FROM public.purchase_receipts WHERE org_id=po.org_id AND client_event_id=_client_event_id; IF prior.id IS NOT NULL THEN IF prior.payload_hash<>fingerprint THEN RAISE EXCEPTION 'idempotency_conflict'; END IF; RETURN prior.id; END IF;
IF po.status NOT IN('sent','partially_received') THEN RAISE EXCEPTION 'purchase_locked'; END IF;
IF EXISTS(SELECT 1 FROM jsonb_array_elements(_items) AS receipt_element(value) GROUP BY receipt_element.value->>'itemId' HAVING count(*)>1) THEN RAISE EXCEPTION 'duplicate_item'; END IF;
rid:=gen_random_uuid();
FOR x IN SELECT * FROM jsonb_array_elements(_items) ORDER BY value->>'itemId' LOOP
 qty:=(x->>'receivedNow')::numeric; IF qty IS NULL OR qty<0 THEN RAISE EXCEPTION 'invalid_quantity'; END IF; IF qty=0 THEN CONTINUE; END IF;
 SELECT * INTO it FROM public.purchase_order_items WHERE id=(x->>'itemId')::uuid AND purchase_order_id=_purchase_id FOR UPDATE;
 IF it.id IS NULL OR it.quantity_received+qty>it.quantity_ordered THEN RAISE EXCEPTION 'invalid_receipt_quantity'; END IF;
 price:=coalesce((x->>'priceVerifiedCents')::int,it.unit_price_cents); IF price<0 THEN RAISE EXCEPTION 'invalid_price'; END IF;
 UPDATE public.purchase_order_items SET quantity_received=quantity_received+qty,unit_price_cents=price WHERE id=it.id;
 UPDATE public.inventory_items SET quantity=quantity+qty,cost_cents=price,updated_at=now() WHERE id=it.inventory_item_id;
 INSERT INTO public.inventory_movements(org_id,location_id,inventory_item_id,delta,unit_cost_cents,kind,client_event_id,reason,actor_id) VALUES(po.org_id,po.location_id,it.inventory_item_id,qty,price,'receiving','receipt:'||rid::text,_notes,auth.uid()); amount:=amount+round(qty*price);
END LOOP;
IF amount=0 AND NOT EXISTS(SELECT 1 FROM public.inventory_movements WHERE client_event_id='receipt:'||rid::text) THEN RAISE EXCEPTION 'empty_receipt'; END IF;
INSERT INTO public.purchase_receipts(id,org_id,location_id,purchase_order_id,client_event_id,payload_hash,items,actor_id) VALUES(rid,po.org_id,po.location_id,_purchase_id,_client_event_id,fingerprint,_items,auth.uid());
UPDATE public.purchase_orders SET status=CASE WHEN EXISTS(SELECT 1 FROM public.purchase_order_items WHERE purchase_order_id=_purchase_id AND quantity_received<quantity_ordered) THEN 'partially_received' ELSE 'received' END,updated_at=now() WHERE id=_purchase_id;
INSERT INTO public.finance_entries(org_id,location_id,kind,amount_cents,client_event_id,description,actor_id) VALUES(po.org_id,po.location_id,'purchase',amount,'receipt:'||rid::text,'Inventory acquisition (not cash payment)',auth.uid());
PERFORM public.write_audit(po.org_id,'purchase.received',rid::text,jsonb_build_object('purchase_id',_purchase_id)); RETURN rid; END $function$;

-- cancel_operational_purchase
CREATE OR REPLACE FUNCTION public.cancel_operational_purchase(_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ DECLARE po public.purchase_orders; BEGIN SELECT * INTO po FROM public.purchase_orders WHERE id=_id FOR UPDATE; IF po.id IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF; PERFORM public.assert_operational_scope(po.org_id,po.location_id); PERFORM public.assert_permission(po.org_id,'purchases.cancel',po.location_id); IF po.status='cancelled' THEN RETURN; END IF; IF EXISTS(SELECT 1 FROM public.purchase_receipts WHERE purchase_order_id=_id) THEN RAISE EXCEPTION 'received_purchase_requires_return'; END IF; UPDATE public.purchase_orders SET status='cancelled',updated_at=now() WHERE id=_id; PERFORM public.write_audit(po.org_id,'purchase.cancelled',_id::text,jsonb_build_object('reason',_reason)); END $function$;

-- create_invitation
drop function if exists public.create_invitation(uuid, text, public.org_role, uuid[]);
CREATE OR REPLACE FUNCTION public.create_invitation(_org_id uuid, _email text, _role org_role, _location_ids uuid[] DEFAULT '{}'::uuid[], _profile_id uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare _token text; _me public.organization_members;
begin
  _me := public.my_member(_org_id);
  if _me.id is null or _me.role = 'staff' then raise exception 'forbidden'; end if;
  if _me.role = 'manager' and _role <> 'staff' then raise exception 'forbidden'; end if;
  if _me.role <> 'owner' then perform public.assert_permission(_org_id, 'team.invite'); end if;
  if _profile_id is not null and not exists (select 1 from public.permission_profiles p where p.id = _profile_id
      and p.archived_at is null and (p.org_id is null or p.org_id = _org_id) and p.tier = _role) then
    raise exception 'invalid_profile'; end if;
  perform public.assert_org_operational(_org_id);
  if _email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid_email'; end if;
  if exists (select 1 from unnest(coalesce(_location_ids, '{}')) x where not exists (
      select 1 from public.locations l where l.id = x and l.org_id = _org_id)) then raise exception 'invalid_location'; end if;
  if _me.role = 'manager' and exists (select 1 from unnest(coalesce(_location_ids, '{}')) x
      where x not in (select public.member_scope(_me.id))) then raise exception 'forbidden'; end if;
  _token := encode(extensions.gen_random_bytes(24), 'hex');
  insert into public.invitations (org_id, email, role, token_hash, invited_by, location_ids, profile_id)
    values (_org_id, lower(trim(_email)), _role, encode(extensions.digest(_token, 'sha256'), 'hex'), auth.uid(),
            case when _role = 'owner' then '{}' else coalesce(_location_ids, '{}') end,
            case when _role = 'owner' then null else _profile_id end);
  return _token;
end $function$;

-- accept_invitation
CREATE OR REPLACE FUNCTION public.accept_invitation(_token text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
declare _inv public.invitations; _email text; _mid uuid;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  select * into _inv from public.invitations where token_hash = encode(extensions.digest(_token, 'sha256'), 'hex') for update;
  if _inv.id is null or _inv.revoked_at is not null or _inv.accepted_at is not null or _inv.expires_at < now() then
    raise exception 'invalid_invitation'; end if;
  select lower(email) into _email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if _email is null or _email <> _inv.email then raise exception 'email_mismatch'; end if;
  perform public.assert_org_operational(_inv.org_id);
  insert into public.organization_members (org_id, user_id, role, profile_id) values (_inv.org_id, auth.uid(), _inv.role, _inv.profile_id)
    on conflict (org_id, user_id) do nothing returning id into _mid;
  if _mid is not null then
    insert into public.member_location_access (member_id, location_id)
      select _mid, x from unnest(_inv.location_ids) x
      where exists (select 1 from public.locations l where l.id = x and l.org_id = _inv.org_id) on conflict do nothing;
  end if;
  update public.invitations set accepted_at = now() where id = _inv.id;
  perform public.write_audit(_inv.org_id, 'invitation.accepted', _inv.email, '{}'::jsonb);
  return _inv.org_id;
end $function$;

-- revoke_invitation
CREATE OR REPLACE FUNCTION public.revoke_invitation(_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _inv public.invitations; _me public.organization_members;
begin
  select * into _inv from public.invitations where id = _id and accepted_at is null and revoked_at is null for update;
  if _inv.id is null then raise exception 'forbidden'; end if;
  _me := public.my_member(_inv.org_id);
  if _me.id is null or _me.role = 'staff' then raise exception 'forbidden'; end if;
  if _me.role <> 'owner' then perform public.assert_permission(_inv.org_id, 'team.invite'); end if;
  if _me.role = 'manager' and (_inv.role <> 'staff' or exists (select 1 from unnest(_inv.location_ids) x
      where x not in (select public.member_scope(_me.id)))) then raise exception 'forbidden'; end if;
  update public.invitations set revoked_at = now() where id = _id;
end $function$;

-- set_member_locations
CREATE OR REPLACE FUNCTION public.set_member_locations(_member_id uuid, _location_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _t public.organization_members; _me public.organization_members;
begin
  select * into _t from public.organization_members where id = _member_id;
  if _t.id is null or _t.role = 'owner' or not public.can_manage_member(_member_id) then raise exception 'forbidden'; end if;
  perform public.assert_org_operational(_t.org_id);
  _me := public.my_member(_t.org_id);
  if _me.role <> 'owner' then perform public.assert_permission(_t.org_id, 'team.manage'); end if;
  if exists (select 1 from unnest(coalesce(_location_ids, '{}')) x where not exists (
      select 1 from public.locations l where l.id = x and l.org_id = _t.org_id)) then raise exception 'invalid_location'; end if;
  if _me.role = 'manager' and exists (select 1 from unnest(coalesce(_location_ids, '{}')) x
      where x not in (select public.member_scope(_me.id))) then raise exception 'forbidden'; end if;
  delete from public.member_location_access where member_id = _member_id and not (location_id = any(coalesce(_location_ids, '{}')));
  insert into public.member_location_access (member_id, location_id)
    select _member_id, x from unnest(coalesce(_location_ids, '{}')) x on conflict do nothing;
  perform public.write_audit(_t.org_id, 'member.locations_changed', _t.user_id::text, jsonb_build_object('locations', to_jsonb(coalesce(_location_ids, '{}'))));
end $function$;

-- remove_member
CREATE OR REPLACE FUNCTION public.remove_member(_member_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _t public.organization_members;
begin
  select * into _t from public.organization_members where id = _member_id;
  if _t.id is null then raise exception 'forbidden'; end if;
  if _t.user_id <> auth.uid() and not public.can_manage_member(_member_id) then raise exception 'forbidden'; end if;
  if _t.user_id <> auth.uid() and not public.is_org_owner(_t.org_id) then perform public.assert_permission(_t.org_id, 'team.manage'); end if;
  perform public.assert_org_operational(_t.org_id);
  delete from public.member_location_access where member_id = _member_id;
  delete from public.organization_members where id = _member_id; -- audit + last-owner guard via trigger
end $function$;

-- update_location
CREATE OR REPLACE FUNCTION public.update_location(_id uuid, _name text, _address text, _phone text, _timezone text, _hours jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare _loc public.locations; _me public.organization_members;
begin
  select * into _loc from public.locations where id = _id for update;
  if _loc.id is null then raise exception 'forbidden'; end if;
  _me := public.my_member(_loc.org_id);
  if _me.id is null or _me.role = 'staff' or not public.can_access_location(_id) then raise exception 'forbidden'; end if;
  if _me.role <> 'owner' then perform public.assert_permission(_loc.org_id, 'settings.locations', _id); end if;
  perform public.assert_org_operational(_loc.org_id);
  if coalesce(length(trim(_name)), 0) < 2 or length(_name) > 80 then raise exception 'invalid_name'; end if;
  if not exists (select 1 from pg_timezone_names where name = _timezone) then raise exception 'invalid_timezone'; end if;
  if jsonb_typeof(coalesce(_hours, '{}')) <> 'object' then raise exception 'invalid_hours'; end if;
  update public.locations set name = trim(_name), address = nullif(trim(_address), ''), phone = nullif(trim(_phone), ''),
    timezone = _timezone, hours = coalesce(_hours, '{}'), updated_at = now(),
    -- editing the address of a verified store clears verification
    is_verified = is_verified and nullif(trim(_address), '') is not distinct from address
  where id = _id;
  perform public.write_audit(_loc.org_id, 'location.updated', trim(_name), jsonb_build_object('location_id', _id));
end $function$;

revoke execute on function public.create_invitation(uuid, text, public.org_role, uuid[], uuid) from public, anon;
grant execute on function public.create_invitation(uuid, text, public.org_role, uuid[], uuid) to authenticated;
-- ---------------------------------------------------------------- read RLS by module permission
-- Org membership and store access checks are kept; the module permission is an additional filter.
alter policy finance_read on public.finance_entries using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and public.has_any_permission(org_id, array['finance.view','dashboard.financials','reports.view'], location_id));
alter policy expense_read on public.finance_expenses using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and public.has_any_permission(org_id, array['finance.view','expenses.view'], location_id));

alter policy purchases_read on public.purchase_orders using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and public.has_permission(org_id, 'purchases.view', location_id));
alter policy po_items_read on public.purchase_order_items using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and public.has_permission(org_id, 'purchases.view', location_id));
alter policy receipts_read on public.purchase_receipts using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and public.has_permission(org_id, 'purchases.view', location_id));

alter policy orders_read on public.orders using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and public.has_any_permission(org_id, array['orders.view','pos.view','kds.view','reports.view','dashboard.financials'], location_id));
alter policy order_items_read on public.order_items using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and public.has_any_permission(org_id, array['orders.view','pos.view','kds.view','reports.view','dashboard.financials'], location_id));
alter policy history_read on public.order_status_history using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and public.has_any_permission(org_id, array['orders.view','pos.view','kds.view','reports.view','dashboard.financials'], location_id));
alter policy payments_read on public.payments using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and public.has_any_permission(org_id, array['orders.view','pos.view','reports.view','dashboard.financials','finance.view'], location_id));
alter policy modifiers_read on public.order_item_modifiers using (
  exists (select 1 from public.order_items i where i.id = order_item_modifiers.order_item_id
          and public.is_org_member(i.org_id) and public.can_access_location(i.location_id)
          and public.has_any_permission(i.org_id, array['orders.view','pos.view','kds.view','reports.view','dashboard.financials'], i.location_id)));

alter policy inventory_read on public.inventory_items using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and public.has_any_permission(org_id, array['inventory.view','purchases.view','recipes.view'], location_id));
alter policy movements_read on public.inventory_movements using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and public.has_any_permission(org_id, array['inventory.view'], location_id));
alter policy recipes_read on public.product_recipes using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and public.has_any_permission(org_id, array['recipes.view','inventory.view'], location_id));
alter policy ingredients_read on public.recipe_ingredients using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and public.has_any_permission(org_id, array['recipes.view','inventory.view'], location_id));

alter policy suppliers_read on public.suppliers using (
  public.is_org_member(org_id) and public.has_any_permission(org_id, array['suppliers.view','purchases.view']));

alter policy "Managers read invitations" on public.invitations using (public.has_permission(org_id, 'team.view'));
alter policy "Org managers read org audit" on public.audit_logs using (
  org_id is not null and public.has_permission(org_id, 'team.activity'));
