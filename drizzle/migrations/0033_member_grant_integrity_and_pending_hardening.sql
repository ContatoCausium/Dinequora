-- 0033_member_grant_integrity_and_pending_hardening - additive fixes found by the M2 integration
-- review (2026-11-19). No member gains access; every change narrows it or makes it explicit.
--
-- A. Member grants (finding M1 and the paths found by the independent review). Before:
--    * set_member_access validated individual grants (extra_permissions) only against the catalog,
--      and a manager's "permission_exceeds_own" check compared EFFECTIVE sets: a grant outside the
--      member's tier was stored, inert, and became active when an owner later promoted the member
--      (a manager without orders.resolve_pending planted it in a staff member's extras);
--    * set_member_role kept the member's profile: demoting an org admin to staff left the manager
--      profile in place (staff got org-admin permissions within the staff ceiling) and a later
--      promotion reactivated all of it;
--    * create_invitation let a manager invite staff with a profile beyond the manager's own;
--    * revocations of a permission that left the catalog were lost on the next edit.
--    Now:
--      * an individual grant must be within the member's tier (permission_outside_role), for every
--        caller, owners included: staff never hold orders.resolve_pending, not even inert;
--      * a manager grants (extras or a profile) and invites only with permissions the manager holds
--        (permission_exceeds_own), checked on the request itself;
--      * a BEFORE trigger keeps the invariants on every path (set_member_role, ownership transfer,
--        invitations, service role): a staff member can never carry a manager-tier profile
--        (profile_tier_mismatch: the owner picks the new profile explicitly with set_member_access);
--        becoming an owner clears profile and grants; grants outside the tier are dropped; every
--        change is audited (member.extras_pruned), so nothing is left for a later promotion;
--      * set_member_access keeps revocations of permissions that are no longer in the catalog (they
--        only narrow access); save_permission_profile refuses to change the tier of a profile that
--        a pending invitation uses;
--      * existing data is made consistent WITHOUT changing anyone's effective permissions (checked
--        row by row, the migration aborts otherwise): inert grants dropped; a staff member carrying a
--        manager-tier profile gets the same effective set as explicit grants and revocations, with no
--        profile; an owner's leftover profile/grants cleared. Each change audited, actor null.
--    Unchanged rules: owners hold everything; only owners manage managers and create/edit profiles;
--    managers manage staff of their own stores; platform admins are not members (no permission).
--
-- B. Pending POS sale resolution.
--    * H1: under REPEATABLE READ or SERIALIZABLE the snapshot is taken by the transaction's first
--      statement, BEFORE the key's advisory lock: the resolution would not see a sale committed
--      meanwhile and would close its key, and a sale would not see a closure committed meanwhile and
--      would record a sale under a closed key. Both functions now refuse to run outside READ COMMITTED
--      ('isolation_unsupported', nothing written; the register keeps the sale pending). PostgREST and
--      the app use READ COMMITTED. create_pos_sale_v2 = the 0032 body plus that ONE line.
--    * The resolution also checks that the organization is operational (org_suspended /
--      subscription_inactive) and, when the key has an order, that it belongs to the requested store
--      (location_forbidden; nothing revealed or written).
--    * B4: leading/trailing whitespace and invisible formatting characters of every kind are removed
--      (the set is built from code points, so this file stays plain ASCII), and the justification
--      must keep 10-500 characters with at least 5 letters or digits (reason_required).
--
-- Same lock wait limit as 0031 (this migration may run alone): a lock not obtained within 5 s aborts
-- the whole run, nothing applied. No statement here takes an ACCESS EXCLUSIVE lock on a table the
-- app reads (CREATE OR REPLACE TRIGGER takes SHARE ROW EXCLUSIVE; DROP TRIGGER would take ACCESS
-- EXCLUSIVE and block every RLS check until the end of the run). Rollback: docs/operations/m2-rollback.
set local lock_timeout = '5s';

-- ================================================================ A. member grants
create or replace function public.trg_member_grant_integrity()
returns trigger language plpgsql security definer set search_path = public as $$
declare _dropped text[]; _tier public.org_role;
begin
  if tg_op = 'INSERT' or new.role is distinct from old.role or new.profile_id is distinct from old.profile_id then
    if new.role = 'owner' then
      -- owners hold the whole catalog; leftovers would come back on a later demotion
      if new.profile_id is not null or cardinality(coalesce(new.extra_permissions, '{}')) > 0 then
        perform public.write_audit(new.org_id, 'member.extras_pruned', new.user_id::text,
          jsonb_build_object('role', new.role, 'removed', to_jsonb(coalesce(new.extra_permissions, '{}')),
                             'profile_removed', new.profile_id));
        new.profile_id := null;
        new.extra_permissions := '{}';
      end if;
      return new;
    end if;
    if new.profile_id is not null then
      select p.tier into _tier from public.permission_profiles p where p.id = new.profile_id;
      if new.role = 'staff' and _tier = 'manager' then raise exception 'profile_tier_mismatch'; end if;
    end if;
  end if;
  if new.role = 'owner' then return new; end if;
  _dropped := array(select distinct p from unnest(coalesce(new.extra_permissions, '{}')) p
                     where not p = any(public.role_ceiling(new.role)) order by p);
  if cardinality(_dropped) > 0 then
    new.extra_permissions := array(select p from unnest(new.extra_permissions) p
                                    where p = any(public.role_ceiling(new.role)));
    perform public.write_audit(new.org_id, 'member.extras_pruned', new.user_id::text,
      jsonb_build_object('role', new.role, 'removed', to_jsonb(_dropped)));
  end if;
  return new;
end $$;
revoke all on function public.trg_member_grant_integrity() from public, anon, authenticated;

-- Existing data, made consistent before the trigger exists (each change audited, actor null). No
-- member's effective permissions change: checked row by row, the migration aborts otherwise.
do $$
declare m record; _base text[]; _defaults text[]; _extra text[]; _revoked text[]; _before text[]; _after text[];
begin
  -- NULL elements (accepted before 0033: the catalog check ignored them) never matched a permission:
  -- removing them changes nothing, and keeps the checks below exact
  update public.organization_members
     set extra_permissions = array_remove(extra_permissions, null),
         revoked_permissions = array_remove(revoked_permissions, null)
   where array_position(extra_permissions, null) is not null
      or array_position(revoked_permissions, null) is not null;
  -- a staff member carrying a manager-tier profile: the same effective set as explicit grants
  for m in select om.*, pp.permissions as profile_permissions from public.organization_members om
             join public.permission_profiles pp on pp.id = om.profile_id
            where om.role = 'staff' and pp.tier = 'manager' for update of om loop
    _before := public.effective_permissions_for(m.role, m.profile_id, m.extra_permissions, m.revoked_permissions);
    _base := array(select p from unnest(m.profile_permissions) p where p = any(public.role_ceiling('staff')));
    _defaults := public.role_default_permissions('staff');
    _extra := array(select distinct p from unnest(_base || m.extra_permissions) p
                     where p = any(public.role_ceiling('staff')) and not p = any(_defaults) order by p);
    _revoked := array(select distinct p from unnest(m.revoked_permissions || array(
                  select d from unnest(_defaults) d where not d = any(_base) and not d = any(m.extra_permissions))) p order by p);
    _after := public.effective_permissions_for('staff', null, _extra, _revoked);
    if _after is distinct from _before then
      raise exception 'member % would change effective permissions: % -> %', m.id, _before, _after;
    end if;
    update public.organization_members
       set profile_id = null, extra_permissions = _extra, revoked_permissions = _revoked
     where id = m.id;
    perform public.write_audit(m.org_id, 'member.extras_pruned', m.user_id::text, jsonb_build_object(
      'role', m.role, 'profile_removed', m.profile_id, 'converted_to_grants', to_jsonb(_extra),
      'converted_to_revocations', to_jsonb(_revoked)));
  end loop;
  -- an owner's leftover profile or grants
  for m in select * from public.organization_members
            where role = 'owner' and (profile_id is not null or cardinality(extra_permissions) > 0) for update loop
    update public.organization_members set profile_id = null, extra_permissions = '{}' where id = m.id;
    perform public.write_audit(m.org_id, 'member.extras_pruned', m.user_id::text, jsonb_build_object(
      'role', m.role, 'removed', to_jsonb(m.extra_permissions), 'profile_removed', m.profile_id));
  end loop;
  -- inert grants outside the tier
  for m in select * from public.organization_members om
            where om.role <> 'owner'
              and exists (select 1 from unnest(om.extra_permissions) p where not p = any(public.role_ceiling(om.role)))
            for update loop
    _before := public.effective_permissions_for(m.role, m.profile_id, m.extra_permissions, m.revoked_permissions);
    _extra := array(select p from unnest(m.extra_permissions) p where p = any(public.role_ceiling(m.role)));
    if public.effective_permissions_for(m.role, m.profile_id, _extra, m.revoked_permissions) is distinct from _before then
      raise exception 'member % would change effective permissions', m.id;
    end if;
    update public.organization_members set extra_permissions = _extra where id = m.id;
    perform public.write_audit(m.org_id, 'member.extras_pruned', m.user_id::text, jsonb_build_object(
      'role', m.role, 'removed', to_jsonb(array(select p from unnest(m.extra_permissions) p where not p = any(_extra)))));
  end loop;
end $$;

-- "member_ceiling_..." sorts before "member_effective_permissions": the effective set is computed
-- from the corrected row. CREATE OR REPLACE TRIGGER takes SHARE ROW EXCLUSIVE (reads not blocked).
create or replace trigger member_ceiling_grants
  before insert or update of role, profile_id, extra_permissions on public.organization_members
  for each row execute function public.trg_member_grant_integrity();

-- set_member_access: the 0018 body plus the request checks and the revocation rule marked 0033.
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
  -- 0033: a NULL element is not a permission (it slipped through the catalog check before)
  if array_position(coalesce(_extra, '{}') || coalesce(_revoked, '{}'), null) is not null then
    raise exception 'invalid_permission'; end if;
  -- 0033: an individual grant must be one the tier can hold (never stored inert).
  if _role <> 'owner' and exists (select 1 from unnest(coalesce(_extra, '{}')) p
             where not p = any(public.role_ceiling(_role))) then raise exception 'permission_outside_role'; end if;
  -- 0033: a manager grants only what the manager holds, checked on the request itself.
  if _me.role = 'manager' and exists (select 1 from unnest(coalesce(_extra, '{}')) p
             where not p = any(public.member_permissions(_me.id))) then raise exception 'permission_exceeds_own'; end if;
  if _profile_id is not null then
    select * into _p from public.permission_profiles where id = _profile_id and archived_at is null
      and (org_id is null or org_id = _t.org_id);
    if _p.id is null then raise exception 'invalid_profile'; end if;
    if _p.tier <> _role then raise exception 'profile_tier_mismatch'; end if;
    -- 0033: a manager assigns only a profile whose permissions (within the tier) the manager holds.
    if _me.role = 'manager' and exists (select 1 from unnest(_p.permissions) p
        where p = any(public.role_ceiling(_role)) and not p = any(public.member_permissions(_me.id))) then
      raise exception 'permission_exceeds_own'; end if;
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
         -- 0033: revocations of permissions no longer in the catalog are kept (they only narrow access;
         -- the permission may come back, e.g. after an M2 rollback and re-application)
         revoked_permissions = case when _role = 'owner' then '{}' else array(select distinct p from unnest(coalesce(_revoked, '{}')
           || array(select r from unnest(_t.revoked_permissions) r where not r = any(public.permission_catalog()))) p) end
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

-- create_invitation: the 0018 body plus the request check marked 0033.
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
  -- 0033: a manager invites only with permissions the manager holds (the profile, or the tier defaults).
  if _me.role = 'manager' and exists (select 1 from unnest(public.effective_permissions_for(_role, _profile_id, '{}', '{}')) p
      where not p = any(public.member_permissions(_me.id))) then raise exception 'permission_exceeds_own'; end if;
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

-- save_permission_profile: the 0018 body plus the pending-invitation check marked 0033.
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
    -- 0033: nor a pending invitation (its acceptance would give staff a manager-tier profile).
    if exists (select 1 from public.invitations where profile_id = _pid and role <> _tier
                 and accepted_at is null and revoked_at is null) then
      raise exception 'profile_tier_in_use';
    end if;
  end if;
  perform public.write_audit(_org_id, 'permission_profile.saved', _pid::text,
    jsonb_build_object('name', trim(_name), 'tier', _tier, 'permissions', to_jsonb(_clean)));
  return _pid;
end $$;

-- ================================================================ B. pending POS sale resolution
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
  -- 0033 (B4): whitespace and invisible formatting characters (soft hyphen, zero-width and
  -- direction marks, fillers, variation selectors...), built from code points so the file stays ASCII.
  ws text := '[[:space:]' || chr(160) || chr(173) || chr(847) || chr(1564) || chr(4447) || chr(4448)
             || chr(5760) || chr(6068) || chr(6069) || chr(6155) || '-' || chr(6159)
             || chr(8192) || '-' || chr(8207) || chr(8232) || '-' || chr(8239) || chr(8287) || '-' || chr(8303)
             || chr(12288) || chr(12644) || chr(65024) || '-' || chr(65039) || chr(65279) || chr(65440) || ']';
  why text;
  o public.orders;
  v public.pos_sale_key_voids;
  paid boolean;
begin
  -- 0033 (H1): only READ COMMITTED sees, under the key's lock, a sale committed meanwhile.
  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception 'isolation_unsupported';
  end if;
  if auth.uid() is null or not public.is_org_member(_org_id) then raise exception 'forbidden'; end if;
  if _location_id is null or not public.location_in_org(_location_id, _org_id) then raise exception 'location_forbidden'; end if;
  perform public.assert_permission(_org_id, 'orders.resolve_pending', _location_id);
  -- 0033: a suspended organization (or one without an active subscription) writes nothing.
  perform public.assert_org_operational(_org_id);
  if length(k) not between 1 and 160 then raise exception 'invalid_key'; end if;
  -- 0033 (B4): trimmed of every kind of whitespace; 10-500 characters, at least 5 letters or digits.
  why := regexp_replace(coalesce(_reason, ''), '^' || ws || '+|' || ws || '+$', '', 'g');
  if length(why) not between 10 and 500
     or length(regexp_replace(regexp_replace(why, ws, '', 'g'), '[^[:alnum:]]', '', 'g')) < 5 then
    raise exception 'reason_required';
  end if;
  if _amount_cents is not null and _amount_cents < 0 then raise exception 'invalid_amount'; end if;
  if _attempts is not null and _attempts < 0 then raise exception 'invalid_attempts'; end if;

  -- The SAME lock as create_pos_sale_v2: a sale running in the database for this key finishes first.
  perform pg_advisory_xact_lock(hashtextextended(_org_id::text || ':' || k, 0));

  select * into o from public.orders where org_id = _org_id and client_order_id = k;
  if o.id is not null then
    -- 0033: the order of another store is neither revealed nor touched.
    if o.location_id <> _location_id then raise exception 'location_forbidden'; end if;
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
    -- 0033: a key closed for another store is not revealed either.
    if v.location_id <> _location_id then raise exception 'location_forbidden'; end if;
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

-- create_pos_sale_v2: the 0032 body plus ONE line (the isolation check, first statement of the body).
CREATE OR REPLACE FUNCTION public.create_pos_sale_v2(_org_id uuid, _location_id uuid, _type order_type, _customer_name text, _customer_phone text DEFAULT NULL::text, _customer_email text DEFAULT NULL::text, _delivery_address text DEFAULT NULL::text, _table_number text DEFAULT NULL::text, _notes text DEFAULT NULL::text, _discount_cents integer DEFAULT 0, _tax_rate_ppm integer DEFAULT NULL::integer, _items jsonb DEFAULT '[]'::jsonb, _is_simulation boolean DEFAULT false, _client_order_id text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE existing public.orders; oid uuid; iid uuid; p public.menu_products; it jsonb; m jsonb; g jsonb; opt jsonb; q int; base int; mods int; subtotal int:=0; tax int; store_ppm int; fingerprint text; n int; BEGIN
IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN RAISE EXCEPTION 'isolation_unsupported'; END IF;
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
