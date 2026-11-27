-- 0043_platform_admin_hardening — fixes from the review of the platform-admin RPCs (2026-11-27).
-- Same signatures and grants; only behaviour that was wrong changes.
--
-- 1. Operators are never members of customer organizations, in ANY role (was: owners only, 0034).
--    Before, admin_set_platform_role granted platform_admin to a manager or staff member of a
--    customer organization, and an account with a platform role could accept a manager or staff
--    invitation: in both cases an operator became a tenant member and read its orders and finance.
--    Now (demo organizations excepted, as in 0034):
--      * the user_roles trigger refuses a platform role for an account that is a member of a customer
--        organization in any role (platform_role_member_conflict; an owner keeps the 0034 code);
--      * a deferred constraint trigger on organization_members refuses, at commit, any membership of a
--        customer organization for an account holding a platform role (same lock key as 0034, so the two
--        sides are serialized). The 0034 owner trigger stays as it is.
-- 2. admin_set_platform_role: the "last platform admin" check is serialized with a transaction-level
--    advisory lock taken before counting, so two admins revoking each other at the same time can no
--    longer leave zero admins (READ COMMITTED let both see the other). The audit is written only when a
--    role was really granted or revoked (an existing grant or a missing role wrote a false entry).
-- 3. admin_set_subscription: grace_ends_at and canceled_at are set only when the status CHANGES to
--    grace or canceled (before, every call on an org in grace restarted the 7-day window, unaudited).
--    It locks the organization row first, then the subscription, the same order as
--    admin_update_organization (whose sync_org_entitlements touches both), so two operators acting on
--    the same organization cannot deadlock.
-- 4. admin_update_organization: suspended_reason changes only when a status is passed (suspended: the
--    new reason; another status: cleared). Before, changing only the plan or the store limit of a
--    suspended organization replaced the suspension text (shown to every member by my_org_status)
--    with the operator's note for that unrelated change.
--
-- Rollback (a NEW migration): restore admin_set_platform_role from 0034, admin_set_subscription and
-- admin_update_organization from 0004, trg_platform_role_separation from 0034; drop the constraint
-- trigger member_platform_separation and function trg_member_platform_separation().

set local lock_timeout = '5s';

-- ---------------------------------------------------------------- 1. separation, role side
create or replace function public.trg_platform_role_separation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception 'isolation_unsupported';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('platform_user:' || new.user_id::text, 0));
  if exists (select 1 from public.organization_members m join public.organizations o on o.id = m.org_id
              where m.user_id = new.user_id and m.role = 'owner' and not o.is_demo) then
    raise exception 'platform_role_owner_conflict';
  end if;
  if exists (select 1 from public.organization_members m join public.organizations o on o.id = m.org_id
              where m.user_id = new.user_id and not o.is_demo) then
    raise exception 'platform_role_member_conflict';
  end if;
  return new;
end $$;
revoke all on function public.trg_platform_role_separation() from public, anon, authenticated;

-- ---------------------------------------------------------------- 1. separation, member side
create or replace function public.trg_member_platform_separation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception 'isolation_unsupported';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('platform_user:' || new.user_id::text, 0));
  -- an owner is the 0034 trigger's case (platform_role_owner_conflict)
  if exists (select 1 from public.organization_members m join public.organizations o on o.id = m.org_id
              where m.id = new.id and m.role <> 'owner' and not o.is_demo)
     and exists (select 1 from public.user_roles r where r.user_id = new.user_id) then
    raise exception 'platform_role_member_conflict';
  end if;
  return null;
end $$;
revoke all on function public.trg_member_platform_separation() from public, anon, authenticated;

do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgname = 'member_platform_separation' and tgrelid = 'public.organization_members'::regclass) then
    execute 'create constraint trigger member_platform_separation
               after insert or update of user_id, org_id, role on public.organization_members
               deferrable initially deferred
               for each row
               execute function public.trg_member_platform_separation()';
  end if;
end $$;

-- ---------------------------------------------------------------- 2. admin_set_platform_role
create or replace function public.admin_set_platform_role(_email text, _role public.platform_role, _grant boolean, _reason text)
returns void language plpgsql security definer set search_path = public as $$
declare _uid uuid; _matches int; _changed int;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  if coalesce(length(trim(_reason)), 0) < 3 then raise exception 'reason_required'; end if;
  select count(*), min(id::text)::uuid into _matches, _uid from auth.users
   where lower(email) = lower(trim(_email)) and email_confirmed_at is not null
     and (not _grant or deleted_at is null);
  if _matches = 0 then raise exception 'user_not_found'; end if;
  if _matches > 1 then raise exception 'user_ambiguous'; end if;
  -- 0043: every platform role change waits here, so the last-admin count below sees the others' commits
  perform pg_advisory_xact_lock(hashtextextended('platform_roles', 0));
  -- the caller may have lost its own role while it waited
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  if _grant then
    insert into public.user_roles (user_id, role) values (_uid, _role) on conflict do nothing;
  else
    if _role = 'platform_admin' and (select count(*) from public.user_roles where role = 'platform_admin' and user_id <> _uid) = 0 then
      raise exception 'last_admin'; end if;
    delete from public.user_roles where user_id = _uid and role = _role;
  end if;
  get diagnostics _changed = row_count;
  if _changed = 0 then return; end if;  -- nothing changed: nothing to audit
  perform public.write_audit(null, case when _grant then 'platform.role_granted' else 'platform.role_revoked' end,
    lower(trim(_email)), jsonb_build_object('role', _role, 'reason', _reason));
end $$;

-- ---------------------------------------------------------------- 3. admin_set_subscription
create or replace function public.admin_set_subscription(_org_id uuid, _plan text, _status text, _reason text)
returns void language plpgsql security definer set search_path = public as $$
declare _old public.subscriptions; _changes_status boolean;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  if coalesce(length(trim(_reason)), 0) < 3 then raise exception 'reason_required'; end if;
  if _plan is not null and not exists (select 1 from public.billing_plans where id = _plan and active) then raise exception 'invalid_plan'; end if;
  if _status is not null and _status not in ('trialing','active','past_due','grace','incomplete','unpaid','canceled') then raise exception 'invalid_status'; end if;
  -- 0043: organization first, then subscription (the order admin_update_organization uses)
  perform 1 from public.organizations where id = _org_id for update;
  select * into _old from public.subscriptions where org_id = _org_id for update;
  if _old.org_id is null then raise exception 'not_found'; end if;
  _changes_status := _status is not null and _status is distinct from _old.status;
  update public.subscriptions set plan_id = coalesce(_plan, plan_id), status = coalesce(_status, status),
    grace_ends_at = case when _changes_status and _status = 'grace' then now() + interval '7 days' else grace_ends_at end,
    canceled_at = case when _changes_status and _status = 'canceled' then now() else canceled_at end,
    updated_at = now() where org_id = _org_id;
  perform public.write_audit(_org_id, 'billing.subscription_changed', null, jsonb_build_object('reason', _reason,
    'from', jsonb_build_object('plan', _old.plan_id, 'status', _old.status), 'to', jsonb_build_object('plan', _plan, 'status', _status)));
end $$;

-- ---------------------------------------------------------------- 4. admin_update_organization
create or replace function public.admin_update_organization(_org_id uuid, _status text, _plan text, _store_limit integer, _reason text)
returns void language plpgsql security definer set search_path = public as $$
declare _old public.organizations;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  if coalesce(length(trim(_reason)), 0) < 3 then raise exception 'reason_required'; end if;
  if _status is not null and _status not in ('trial','active','suspended') then raise exception 'invalid_status'; end if;
  if _plan is not null and not exists (select 1 from public.billing_plans where id = _plan and active) then raise exception 'invalid_plan'; end if;
  if _store_limit is not null and _store_limit > 500 then raise exception 'invalid_limit'; end if;
  select * into _old from public.organizations where id = _org_id for update;
  if _old.id is null then raise exception 'not_found'; end if;
  update public.organizations set status = coalesce(_status, status),
    store_limit_override = case when _store_limit is null then store_limit_override when _store_limit <= 0 then null else _store_limit end,
    -- 0043: only a status passed in this call changes the suspension text
    suspended_reason = case when _status is null then suspended_reason
                            when _status = 'suspended' then _reason
                            else null end
  where id = _org_id;
  if _plan is not null then update public.subscriptions set plan_id = _plan, updated_at = now() where org_id = _org_id; end if;
  perform public.sync_org_entitlements(_org_id);
  perform public.write_audit(_org_id, 'platform.organization_updated', _old.name, jsonb_build_object(
    'reason', _reason, 'from', jsonb_build_object('status', _old.status, 'plan', _old.plan, 'store_limit', _old.store_limit, 'override', _old.store_limit_override),
    'to', jsonb_build_object('status', _status, 'plan', _plan, 'store_limit_override', _store_limit, 'effective', public.effective_store_limit(_org_id))));
end $$;
