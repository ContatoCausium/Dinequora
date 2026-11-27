-- 0032_pos_pending_sale_resolution — safe manual resolution of a POS sale whose outcome is unknown.
--
-- A register keeps a sale PENDING when it cannot confirm it (lost response, timeout, reload): it is
-- never discarded automatically. This migration lets an authorized person close such a sale, safely:
--   * resolve_pending_pos_sale() takes the SAME transaction-level advisory lock as the sale
--     (pg_advisory_xact_lock(hashtextextended(org_id || ':' || trim(key), 0)), see
--     create_pos_sale_v2): a sale already running in the database finishes first;
--   * under that lock it looks the order up by the idempotency key. If it EXISTS, nothing is
--     closed: the order is returned (the register shows its receipt);
--   * only when no order exists under the lock is the key recorded in pos_sale_key_voids, and
--     create_pos_sale_v2 (under the same lock) refuses that key from then on ('sale_key_voided'):
--     a request still travelling on the network can never record the sale afterwards;
--   * every outcome is written to the audit log (actor, store, key, time, justification).
-- Any error, timeout or uncertainty leaves the sale pending (nothing is written).
--
-- Permission orders.resolve_pending (new; NOT orders.refund):
--   owner: always (owners hold the whole catalog); organization admin (system profile org_admin):
--   yes; manager: not by default (role_default_permissions), may be granted explicitly; staff:
--   never (excluded from role_ceiling, so neither a profile nor an extra grant can give it);
--   platform admins have no automatic access (they are not members of the organization).
--
-- Rollback (a NEW migration): recreate create_pos_sale_v2 from 0025, drop
-- resolve_pending_pos_sale, keep pos_sale_key_voids (history), restore permission_catalog /
-- role_ceiling / role_default_permissions from 0020/0018, remove the permission from org_admin and
-- recompute effective_permissions. See docs/operations/pos-pending-sale-resolution.md.

-- ---------------------------------------------------------------- permission catalog
create or replace function public.permission_catalog()
returns text[] language sql immutable set search_path = public as $$
  select array[
    'dashboard.view','dashboard.financials',
    'pos.view','pos.sell','pos.discount',
    'orders.view','orders.update','orders.refund','orders.resolve_pending',
    'kds.view','kds.operate',
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

-- Staff can never hold it (ceiling); everything else as in 0018.
create or replace function public.role_ceiling(_role public.org_role)
returns text[] language sql immutable set search_path = public as $$
  select case _role
    when 'owner' then public.permission_catalog()
    when 'manager' then array(select p from unnest(public.permission_catalog()) p
                              where p not in ('settings.branding','settings.billing'))
    else array(select p from unnest(public.permission_catalog()) p
               where p not like 'team.%' and p not like 'settings.%'
                 and p <> 'orders.resolve_pending')
  end
$$;

-- Managers without a profile do NOT get it by default (explicit grant only); everything else as in 0018.
create or replace function public.role_default_permissions(_role public.org_role)
returns text[] language sql immutable set search_path = public as $$
  select case _role
    when 'owner' then public.permission_catalog()
    when 'manager' then array(select p from unnest(public.role_ceiling('manager')) p
                              where p <> 'suppliers.edit' and p <> 'orders.resolve_pending')
    else array['dashboard.view','pos.view','pos.sell','pos.discount','orders.view','orders.update',
               'kds.view','kds.operate','menu.view','inventory.view','recipes.view','suppliers.view']::text[]
  end
$$;

-- Organization admin template: yes. The manager template: no (explicit grant only).
update public.permission_profiles
   set permissions = array(select distinct p from unnest(permissions || array['orders.resolve_pending']) p order by p)
 where is_system and key = 'org_admin'
   and not ('orders.resolve_pending' = any(permissions));

update public.organization_members
   set effective_permissions = public.effective_permissions_for(role, profile_id, extra_permissions, revoked_permissions);

-- ---------------------------------------------------------------- closed keys (immutable; written only by the RPC)
create table public.pos_sale_key_voids (
  org_id          uuid not null references public.organizations(id) on delete cascade,
  client_order_id text not null check (length(client_order_id) between 1 and 160),
  location_id     uuid not null references public.locations(id),
  actor_id        uuid not null,
  reason          text not null check (length(btrim(reason)) between 10 and 500),
  amount_cents    integer check (amount_cents >= 0),
  attempts        integer check (attempts >= 0),
  last_attempt_at timestamptz,
  created_at      timestamptz not null default now(),
  primary key (org_id, client_order_id)
);
alter table public.pos_sale_key_voids enable row level security;
create policy pos_voids_read on public.pos_sale_key_voids for select to authenticated
  using (public.is_org_member(org_id) and public.can_access_location(location_id)
         and public.has_any_permission(org_id, array['pos.sell','orders.view','orders.resolve_pending'], location_id));
revoke all on public.pos_sale_key_voids from public, anon, authenticated;
grant select on public.pos_sale_key_voids to authenticated;
grant all on public.pos_sale_key_voids to service_role;

-- ---------------------------------------------------------------- resolution
create or replace function public.resolve_pending_pos_sale(
  _org_id uuid,
  _location_id uuid,
  _client_order_id text,
  _reason text,
  _amount_cents integer default null,
  _attempts integer default null,
  _last_attempt_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  k text := btrim(coalesce(_client_order_id, ''));
  why text := btrim(coalesce(_reason, ''));
  o public.orders;
  v public.pos_sale_key_voids;
  paid boolean;
begin
  if auth.uid() is null or not public.is_org_member(_org_id) then raise exception 'forbidden'; end if;
  if _location_id is null or not public.location_in_org(_location_id, _org_id) then raise exception 'location_forbidden'; end if;
  perform public.assert_permission(_org_id, 'orders.resolve_pending', _location_id);
  if length(k) not between 1 and 160 then raise exception 'invalid_key'; end if;
  if length(why) not between 10 and 500 then raise exception 'reason_required'; end if;
  if _amount_cents is not null and _amount_cents < 0 then raise exception 'invalid_amount'; end if;
  if _attempts is not null and _attempts < 0 then raise exception 'invalid_attempts'; end if;

  -- The SAME lock as create_pos_sale_v2: a sale running in the database for this key finishes first.
  perform pg_advisory_xact_lock(hashtextextended(_org_id::text || ':' || k, 0));

  select * into o from public.orders where org_id = _org_id and client_order_id = k;
  if o.id is not null then
    -- The sale exists: recover it, close nothing.
    paid := exists (select 1 from public.payments p where p.org_id = _org_id and p.order_id = o.id);
    perform set_config('servora.audit_location', o.location_id::text, true);
    perform public.write_audit(_org_id, 'pos.pending_sale_recovered', k,
      jsonb_build_object('order_id', o.id, 'order_status', o.status, 'paid', paid, 'reason', why,
                         'requested_location_id', _location_id));
    return jsonb_build_object('status', 'recorded', 'order_id', o.id, 'order_status', o.status, 'paid', paid);
  end if;

  select * into v from public.pos_sale_key_voids where org_id = _org_id and client_order_id = k;
  if v.client_order_id is not null then
    return jsonb_build_object('status', 'already_resolved', 'resolved_at', v.created_at);
  end if;

  insert into public.pos_sale_key_voids(org_id, client_order_id, location_id, actor_id, reason,
                                        amount_cents, attempts, last_attempt_at)
  values (_org_id, k, _location_id, auth.uid(), why, _amount_cents, _attempts, _last_attempt_at);
  perform set_config('servora.audit_location', _location_id::text, true);
  perform public.write_audit(_org_id, 'pos.pending_sale_resolved', k,
    jsonb_build_object('reason', why, 'amount_cents', _amount_cents, 'attempts', _attempts,
                       'last_attempt_at', _last_attempt_at));
  return jsonb_build_object('status', 'resolved', 'resolved_at', now());
end $$;
revoke all on function public.resolve_pending_pos_sale(uuid, uuid, text, text, integer, integer, timestamptz) from public, anon;
grant execute on function public.resolve_pending_pos_sale(uuid, uuid, text, text, integer, integer, timestamptz) to authenticated;

-- ---------------------------------------------------------------- sale: refuse a voided key
-- create_pos_sale_v2 exactly as in 0025 plus ONE line (the IF EXISTS … 'sale_key_voided' check), placed
-- right after the existing-order check and therefore under the same advisory lock: an order that
-- exists is still returned; a key closed by resolve_pending_pos_sale can never record a sale.
CREATE OR REPLACE FUNCTION public.create_pos_sale_v2(_org_id uuid, _location_id uuid, _type order_type, _customer_name text, _customer_phone text DEFAULT NULL::text, _customer_email text DEFAULT NULL::text, _delivery_address text DEFAULT NULL::text, _table_number text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _discount_cents integer DEFAULT 0, _tax_rate_ppm integer DEFAULT NULL::integer, _items jsonb DEFAULT '[]'::jsonb, _is_simulation boolean DEFAULT false, _client_order_id text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE existing public.orders; oid uuid; iid uuid; p public.menu_products; it jsonb; m jsonb; g jsonb; opt jsonb; q int; base int; mods int; subtotal int:=0; tax int; store_ppm int; fingerprint text; n int; BEGIN
PERFORM public.assert_operational_scope(_org_id,_location_id); PERFORM public.assert_permission(_org_id,'pos.sell',_location_id); IF coalesce(_discount_cents,0)>0 THEN PERFORM public.assert_permission(_org_id,'pos.discount',_location_id); END IF;
IF _is_simulation AND NOT EXISTS(SELECT 1 FROM public.organizations WHERE id=_org_id AND is_demo) THEN RAISE EXCEPTION 'simulation_forbidden'; END IF;
IF coalesce(length(trim(_client_order_id)),0) NOT BETWEEN 1 AND 160 OR _discount_cents IS NULL OR _discount_cents<0 OR _tax_rate_ppm IS NULL OR _tax_rate_ppm NOT BETWEEN 0 AND 1000000 THEN RAISE EXCEPTION 'invalid_sale'; END IF;
IF jsonb_typeof(_items)<>'array' OR jsonb_array_length(_items) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'order_empty'; END IF;
fingerprint:=encode(extensions.digest(jsonb_build_object('location',_location_id,'type',_type,'items',_items,'discount',_discount_cents,'tax',_tax_rate_ppm,'simulation',_is_simulation,'customer',_customer_name,'phone',_customer_phone,'email',_customer_email,'address',_delivery_address,'table',_table_number,'notes',_notes)::text,'sha256'),'hex');
PERFORM pg_advisory_xact_lock(hashtextextended(_org_id::text||':'||trim(_client_order_id),0));
SELECT * INTO existing FROM public.orders WHERE org_id=_org_id AND client_order_id=trim(_client_order_id);
IF existing.id IS NOT NULL THEN IF existing.request_hash<>fingerprint OR existing.location_id<>_location_id THEN RAISE EXCEPTION 'idempotency_conflict'; END IF; RETURN existing.id; END IF;
IF EXISTS(SELECT 1 FROM public.pos_sale_key_voids v WHERE v.org_id=_org_id AND v.client_order_id=trim(_client_order_id)) THEN RAISE EXCEPTION 'sale_key_voided'; END IF;
-- The rate charged is the store's configured rate (0025). The client sends the rate it displayed only as a confirmation: a store without a rate cannot sell, and a stale client is refused instead of silently charged a different amount.
-- FOR SHARE serializes the sale with set_location_tax_rate (FOR UPDATE, then UPDATE): a rate change waits for a sale that already read the rate, and a sale that arrives while a change is in progress waits and then reads the committed rate.
SELECT l.tax_rate_ppm INTO store_ppm FROM public.locations l WHERE l.id=_location_id AND l.org_id=_org_id FOR SHARE;
IF store_ppm IS NULL THEN RAISE EXCEPTION 'tax_rate_not_configured'; END IF; IF store_ppm<>_tax_rate_ppm THEN RAISE EXCEPTION 'tax_rate_changed'; END IF;
oid:=gen_random_uuid();
INSERT INTO public.orders(id,org_id,location_id,order_number,type,customer_name,customer_phone,customer_email,delivery_address,table_number,notes,discount_cents,tax_rate_basis_points,tax_rate_ppm,is_simulation,created_by,client_order_id,request_hash) VALUES(oid,_org_id,_location_id,'#'||upper(left(oid::text,8)),_type,coalesce(nullif(trim(_customer_name),''),'Walk-in'),_customer_phone,_customer_email,_delivery_address,_table_number,_notes,0,round(store_ppm/100.0)::int,store_ppm,_is_simulation,auth.uid(),trim(_client_order_id),fingerprint);
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
IF _discount_cents>subtotal THEN RAISE EXCEPTION 'invalid_discount'; END IF; tax:=round((subtotal-_discount_cents)::numeric*store_ppm/1000000);
UPDATE public.orders SET subtotal_cents=subtotal,discount_cents=_discount_cents,tax_cents=tax,total_cents=subtotal-_discount_cents+tax WHERE id=oid;
INSERT INTO public.order_status_history(org_id,location_id,order_id,to_status,actor_id,reason) VALUES(_org_id,_location_id,oid,'new',auth.uid(),'Order created');
PERFORM public.write_audit(_org_id,'orders.created',oid::text,jsonb_build_object('client_order_id',_client_order_id)); RETURN oid; END $function$;
