-- 0035_pending_sale_reason_privacy - the justification of a pending POS sale resolution is kept apart
-- from the structured audit and read only by who may resolve pending sales at that store.
--
-- Before (0032/0033) the text was stored twice and readable by too many people:
--   * pos_sale_key_voids.reason: every member with pos.sell, orders.view or orders.resolve_pending at
--     the store (cashiers included) could select it through the API;
--   * audit_logs.metadata.reason: every member with team.activity in the WHOLE organization (no store
--     scope), and every platform admin for every tenant.
-- Now:
--   1. the text lives only in pos_pending_resolution_reasons: no API privilege at all (RLS on, no
--      policy, no grant to anon or authenticated); service_role only;
--   2. pos_sale_key_voids keeps its rows and structured columns; its reason column holds the fixed
--      marker '[moved to pos_pending_resolution_reasons]' (no ALTER TABLE: no ACCESS EXCLUSIVE lock on
--      a table every sale reads); the API role reads only org_id, client_order_id, location_id,
--      created_at (what the register's lookup uses; the previous Worker reads created_at only);
--   3. resolve_pending_pos_sale (same signature, same checks, same lock) writes the text there;
--   4. list_pending_sale_reasons() is the only way to read it: a member of the organization of tier
--      owner or manager holding orders.resolve_pending AT THAT STORE (owners: every store; the
--      organization admin profile and managers with an explicit grant: their stores). Staff can never
--      hold the permission (0032/0033 ceiling) and are refused by tier as well; platform admins are
--      not members; other tenants and other stores are refused;
--   5. the activity log (audit_logs, read by team.activity) is scoped to the reader's stores: an event
--      recorded for a store is visible only to members with access to that store (owners: all);
--      organization-level events (no store) stay visible as before. Platform admins keep the structured
--      audit (never the text). The store list is computed once per statement (hashed subplan), by a
--      helper of this migration (the M2 rollback drops accessible_location_ids, not this one);
--   6. LAST, while this transaction holds the locks taken above (the audit policy change locks
--      audit_logs): texts already stored (local and test databases; the hosted databases never ran
--      0032) are MOVED, never discarded: each audit event and closed key gets its row in the private
--      store, the audit metadata keeps reason_id and reason_length instead of the text, the closed key
--      gets the marker; the move is audited per organization (pos.pending_reasons_moved) and verified
--      (any leftover aborts the whole migration). Audit rows whose organization was deleted (org_id
--      NULL) are left as they are (there is no organization to keep the text under).
-- Every statement is idempotent, so docs/operations/m2-rollback/reapply.sql can run this file again.
--
-- Rollback (a NEW migration): docs/operations/security-closure/0035-rollback.sql. It restores the 0033
-- function and the 0019 audit policy and drops the reader and the helper; it puts no text back, but
-- NEW resolutions then expose the text again as 0033 did (see its WARNING).
set local lock_timeout = '5s';

-- ---------------------------------------------------------------- 1. private store of the text
create table if not exists public.pos_pending_resolution_reasons (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid not null references public.organizations(id) on delete cascade,
  location_id     uuid not null references public.locations(id),
  client_order_id text not null check (length(client_order_id) between 1 and 160),
  outcome         text not null check (outcome in ('resolved', 'recovered')),
  order_id        uuid,
  actor_id        uuid,
  reason          text not null check (length(btrim(reason)) between 10 and 500),
  created_at      timestamptz not null default now(),
  -- reserved for the retention procedure (docs/operations/pending-reason-retention.md); never set here
  redacted_at     timestamptz
);
create index if not exists pos_pending_reasons_store_idx
  on public.pos_pending_resolution_reasons (org_id, location_id, created_at desc);
create index if not exists pos_pending_reasons_key_idx
  on public.pos_pending_resolution_reasons (org_id, client_order_id);
alter table public.pos_pending_resolution_reasons enable row level security;
revoke all on table public.pos_pending_resolution_reasons from public, anon, authenticated;
grant all on table public.pos_pending_resolution_reasons to service_role;

-- ---------------------------------------------------------------- 2. API reads the closed keys' structured columns only
-- (a table-level REVOKE also revokes the column privileges, so this pair is idempotent)
revoke select on table public.pos_sale_key_voids from authenticated;
grant select (org_id, client_order_id, location_id, created_at) on table public.pos_sale_key_voids to authenticated;

-- ---------------------------------------------------------------- 3. resolution writes the text to the private store
-- The 0033 body; the only changes are marked 0035 (rid, the reasons insert, the closed key's marker,
-- and the audit metadata: reason_id and reason_length instead of reason).
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
  rid uuid;
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
    -- 0035: the justification goes to the private store; the audit keeps structured fields only.
    insert into public.pos_pending_resolution_reasons(org_id, location_id, client_order_id, outcome, order_id,
                                                      actor_id, reason)
    values (_org_id, o.location_id, k, 'recovered', o.id, auth.uid(), why) returning id into rid;
    perform set_config('servora.audit_location', o.location_id::text, true);
    perform public.write_audit(_org_id, 'pos.pending_sale_recovered', k,
      jsonb_build_object('order_id', o.id, 'order_status', o.status, 'paid', paid, 'reason_id', rid,
                         'reason_length', length(why), 'requested_location_id', _location_id));
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
  -- 0035: the closed key carries a fixed marker, never the text.
  values (_org_id, k, _location_id, auth.uid(), '[moved to pos_pending_resolution_reasons]',
          _amount_cents, _attempts, _last_attempt_at);
  insert into public.pos_pending_resolution_reasons(org_id, location_id, client_order_id, outcome, actor_id, reason)
  values (_org_id, _location_id, k, 'resolved', auth.uid(), why) returning id into rid;
  perform set_config('servora.audit_location', _location_id::text, true);
  perform public.write_audit(_org_id, 'pos.pending_sale_resolved', k,
    jsonb_build_object('reason_id', rid, 'reason_length', length(why), 'amount_cents', _amount_cents,
                       'attempts', _attempts, 'last_attempt_at', _last_attempt_at));
  return jsonb_build_object('status', 'resolved', 'resolved_at', now());
end $$;

-- ---------------------------------------------------------------- 4. the only way to read the text
create or replace function public.list_pending_sale_reasons(
  _org_id uuid,
  _location_id uuid,
  _client_order_id text default null,
  _limit integer default 50
) returns table(reason_id uuid, client_order_id text, outcome text, order_id uuid, actor_id uuid,
                reason text, created_at timestamptz, redacted_at timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  _me public.organization_members;
begin
  if auth.uid() is null then raise exception 'forbidden'; end if;
  _me := public.my_member(_org_id);
  -- not a member (platform admins, other tenants), or staff (the tier can never hold the permission)
  if _me.id is null or _me.role not in ('owner', 'manager') then raise exception 'forbidden'; end if;
  if _location_id is null or not public.location_in_org(_location_id, _org_id) then
    raise exception 'location_forbidden';
  end if;
  -- the permission AT THAT STORE: owners everywhere, managers only at their stores
  if not public.has_permission(_org_id, 'orders.resolve_pending', _location_id) then
    raise exception 'permission_denied' using detail = 'orders.resolve_pending', hint = _location_id::text;
  end if;
  return query
    select r.id, r.client_order_id, r.outcome, r.order_id, r.actor_id, r.reason, r.created_at, r.redacted_at
      from public.pos_pending_resolution_reasons r
     where r.org_id = _org_id
       and r.location_id = _location_id
       and (_client_order_id is null or r.client_order_id = btrim(_client_order_id))
     order by r.created_at desc, r.id
     limit least(greatest(coalesce(_limit, 50), 1), 200);
end $$;
revoke all on function public.list_pending_sale_reasons(uuid, uuid, text, integer) from public, anon;
grant execute on function public.list_pending_sale_reasons(uuid, uuid, text, integer) to authenticated;

-- ---------------------------------------------------------------- 5. activity log scoped to the reader's stores
-- The caller's stores in every organization (owner: all of its organizations' stores; others: explicit
-- access), the same rule as can_access_location, evaluated once per statement in the policy.
create or replace function public.audit_visible_location_ids()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select l.id
    from public.locations l
    join public.organization_members m on m.org_id = l.org_id and m.user_id = auth.uid()
   where m.role = 'owner'
      or exists (select 1 from public.member_location_access a
                  where a.member_id = m.id and a.location_id = l.id)
$$;
revoke all on function public.audit_visible_location_ids() from public, anon;
grant execute on function public.audit_visible_location_ids() to authenticated;

-- previous (0019): using (org_id is not null
--   and org_id in (select public.orgs_with_any_permission(array['team.activity'])))
alter policy "Org managers read org audit" on public.audit_logs using (
  org_id is not null
  and org_id in (select public.orgs_with_any_permission(array['team.activity']))
  and (location_id is null or location_id in (select public.audit_visible_location_ids())));

-- ---------------------------------------------------------------- 6. move the texts already stored (LAST)
do $$
declare o record; marker constant text := '[moved to pos_pending_resolution_reasons]';
begin
  if exists (select 1 from public.audit_logs
              where action in ('pos.pending_sale_resolved', 'pos.pending_sale_recovered')
                and org_id is not null and metadata ? 'reason'
                and jsonb_typeof(metadata->'reason') <> 'string') then
    raise exception 'pending_reason_unexpected_format';
  end if;
  drop table if exists pg_temp.m2r_move;
  create temporary table m2r_move on commit drop as
    select a.id as audit_id, gen_random_uuid() as reason_id, a.org_id,
           coalesce(a.location_id, (select v.location_id from public.pos_sale_key_voids v
                                     where v.org_id = a.org_id and v.client_order_id = a.target)) as location_id,
           a.target as client_order_id,
           case a.action when 'pos.pending_sale_resolved' then 'resolved' else 'recovered' end as outcome,
           case when a.metadata->>'order_id' ~ '^[0-9a-fA-F-]{36}$' then (a.metadata->>'order_id')::uuid end as order_id,
           a.actor_id, a.metadata->>'reason' as reason, a.created_at
      from public.audit_logs a
     where a.action in ('pos.pending_sale_resolved', 'pos.pending_sale_recovered')
       and a.org_id is not null and a.metadata ? 'reason';
  if exists (select 1 from m2r_move where location_id is null or client_order_id is null) then
    raise exception 'pending_reason_without_store';
  end if;
  insert into public.pos_pending_resolution_reasons
         (id, org_id, location_id, client_order_id, outcome, order_id, actor_id, reason, created_at)
  select reason_id, org_id, location_id, client_order_id, outcome, order_id, actor_id, reason, created_at
    from m2r_move;
  update public.audit_logs a
     set metadata = (a.metadata - 'reason')
                    || jsonb_build_object('reason_id', m.reason_id, 'reason_length', length(m.reason))
    from m2r_move m
   where a.id = m.audit_id;

  -- closed keys whose text did not come with an audit event (e.g. written outside the RPC)
  drop table if exists pg_temp.m2r_voids;
  create temporary table m2r_voids on commit drop as
    select v.org_id, v.client_order_id from public.pos_sale_key_voids v where v.reason <> marker;
  insert into public.pos_pending_resolution_reasons
         (org_id, location_id, client_order_id, outcome, actor_id, reason, created_at)
  select v.org_id, v.location_id, v.client_order_id, 'resolved', v.actor_id, v.reason, v.created_at
    from public.pos_sale_key_voids v
   where v.reason <> marker
     and not exists (select 1 from public.pos_pending_resolution_reasons r
                      where r.org_id = v.org_id and r.client_order_id = v.client_order_id
                        and r.outcome = 'resolved' and r.reason = v.reason);
  update public.pos_sale_key_voids set reason = marker where reason <> marker;

  if exists (select 1 from public.audit_logs
              where action in ('pos.pending_sale_resolved', 'pos.pending_sale_recovered')
                and org_id is not null and metadata ? 'reason')
     or exists (select 1 from public.pos_sale_key_voids where reason <> marker) then
    raise exception 'pending_reason_move_incomplete';
  end if;

  perform set_config('servora.audit_location', '', true);
  for o in select x.org_id, sum(x.a)::int as audit_events, sum(x.k)::int as closed_keys
             from (select org_id, 1 as a, 0 as k from m2r_move
                   union all select org_id, 0, 1 from m2r_voids) x
            group by x.org_id loop
    perform public.write_audit(o.org_id, 'pos.pending_reasons_moved', null, jsonb_build_object(
      'audit_events', o.audit_events, 'closed_keys', o.closed_keys, 'migration', '0035'));
  end loop;
end $$;
