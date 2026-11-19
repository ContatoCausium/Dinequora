-- 0034_platform_owner_assignment_guard - a platform admin can no longer make anyone (itself
-- included) the owner of an organization that already has one, and platform operators and owners of
-- customer organizations stay separate accounts.
--
-- Before (0001, the only definition): a platform admin could assign ANY confirmed account,
-- its own included, as owner of ANY organization, also one with owners; as a second owner it could
-- then demote or remove the real owners (only the last owner is protected), i.e. take over a
-- tenant. The Control Center offers the action only for organizations without an owner, but the
-- database did not require it.
--
-- Now admin_assign_owner (same signature, same grants) only recovers an organization WITHOUT an
-- active owner (an owner whose account still exists and is not deleted), and:
--   * never the caller itself (self_assignment_forbidden);
--   * never an account holding any platform role, platform_admin or support
--     (platform_user_forbidden), and never an e-mail matching more than one account
--     (user_ambiguous);
--   * never touches an existing owner: it only inserts the new owner or promotes an existing member
--     (the 0033 trigger then clears that member's profile and individual grants, audited);
--   * concurrent calls are serialized: a transaction-level advisory lock per organization, taken
--     first, and ALSO taken by a trigger by every other path that makes someone owner (invitation
--     acceptance, ownership transfer, role change, new organization); the "no active owner" check
--     runs after the lock, in READ COMMITTED, so it sees every owner committed before it. Other
--     isolation levels would read an older snapshot and are refused (isolation_unsupported), as in
--     0033;
--   * the organization row is locked (FOR NO KEY UPDATE) so it cannot change or disappear meanwhile.
-- And the separation holds afterwards too, from both sides (platform_role_owner_conflict):
--   * a trigger on user_roles refuses any platform role for an account that owns a customer (non-demo)
--     organization, so revoking an admin's role, assigning it an organization and granting the role
--     back is refused;
--   * a deferred constraint trigger on organization_members refuses, at commit, that an account with a
--     platform role becomes owner of a customer organization by any path (role change, ownership
--     transfer, owner invitation, new organization), so demoting it, granting the role and promoting it
--     again is refused too. Test restaurants (is_demo, create_test_restaurant) are exempt;
--   * both take the same per-account lock and refuse isolation levels above READ COMMITTED.
-- Rows that already exist are not changed (the release checklist lists them, read-only); re-granting
-- an existing role to such an account is refused as well. admin_set_platform_role also refuses an
-- e-mail matching more than one account and never grants to a deleted account.
-- Audited as before (platform.owner_assigned), now with the member's previous role, the
-- organization status and the number of inactive owner rows.
--
-- Rollback (a NEW migration): docs/operations/security-closure/0034-rollback.sql (restores the 0001
-- bodies and turns the three trigger functions into no-ops, without DROP TRIGGER: no ACCESS EXCLUSIVE
-- lock on organization_members). Nothing else changes: no table, no data, no grant.
set local lock_timeout = '5s';

-- ---------------------------------------------------------------- one owner change at a time per organization
create or replace function public.trg_member_owner_serialize()
returns trigger language plpgsql set search_path = public as $$
begin
  -- the same key as admin_assign_owner; released at commit or rollback
  perform pg_advisory_xact_lock(hashtextextended('org_owner:' || new.org_id::text, 0));
  return new;
end $$;
revoke all on function public.trg_member_owner_serialize() from public, anon, authenticated;

create or replace trigger member_owner_serialize
  before insert or update of role on public.organization_members
  for each row when (new.role = 'owner')
  execute function public.trg_member_owner_serialize();

-- ---------------------------------------------------------------- operators never own customer organizations
-- Role side: a platform role is refused for an account that owns a customer (non-demo) organization.
create or replace function public.trg_platform_role_separation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- the check must see owners committed while this waited for the lock
  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception 'isolation_unsupported';
  end if;
  -- the same key as admin_assign_owner takes for its target; released at commit or rollback
  perform pg_advisory_xact_lock(hashtextextended('platform_user:' || new.user_id::text, 0));
  if exists (select 1 from public.organization_members m join public.organizations o on o.id = m.org_id
              where m.user_id = new.user_id and m.role = 'owner' and not o.is_demo) then
    raise exception 'platform_role_owner_conflict';
  end if;
  return new;
end $$;
revoke all on function public.trg_platform_role_separation() from public, anon, authenticated;

create or replace trigger platform_role_separation
  before insert or update of user_id, role on public.user_roles
  for each row execute function public.trg_platform_role_separation();

-- Owner side: becoming owner of a customer organization is refused for an account with a platform role,
-- whatever the path (role change, ownership transfer, owner invitation, new organization). Checked at
-- COMMIT (deferred constraint trigger) on the row as it is then: a test restaurant is classified as demo
-- only after create_organization inserted its owner (create_test_restaurant), and a demotion later in
-- the same transaction is honoured. Lock order: org_owner (taken before, by member_owner_serialize) then
-- platform_user, the same as admin_assign_owner.
create or replace function public.trg_owner_platform_separation()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception 'isolation_unsupported';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('platform_user:' || new.user_id::text, 0));
  if exists (select 1 from public.organization_members m join public.organizations o on o.id = m.org_id
              where m.id = new.id and m.role = 'owner' and not o.is_demo)
     and exists (select 1 from public.user_roles r where r.user_id = new.user_id) then
    raise exception 'platform_role_owner_conflict';
  end if;
  return null;
end $$;
revoke all on function public.trg_owner_platform_separation() from public, anon, authenticated;

-- CREATE CONSTRAINT TRIGGER has no OR REPLACE; created once (no DROP TRIGGER: no ACCESS EXCLUSIVE lock)
do $$
begin
  if not exists (select 1 from pg_trigger
                  where tgname = 'owner_platform_separation' and tgrelid = 'public.organization_members'::regclass) then
    execute 'create constraint trigger owner_platform_separation
               after insert or update of role on public.organization_members
               deferrable initially deferred
               for each row when (new.role = ''owner'')
               execute function public.trg_owner_platform_separation()';
  end if;
end $$;

-- admin_set_platform_role: the 0001 body plus the account lookup marked 0034 (one account per e-mail;
-- a deleted account never receives a role). The separation itself is the trigger above.
create or replace function public.admin_set_platform_role(_email text, _role public.platform_role, _grant boolean, _reason text)
returns void language plpgsql security definer set search_path = public as $$
declare _uid uuid; _matches int;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  if coalesce(length(trim(_reason)), 0) < 3 then raise exception 'reason_required'; end if;
  -- 0034: refuse an e-mail matching more than one account; never grant to a deleted account
  select count(*), min(id::text)::uuid into _matches, _uid from auth.users
   where lower(email) = lower(trim(_email)) and email_confirmed_at is not null
     and (not _grant or deleted_at is null);
  if _matches = 0 then raise exception 'user_not_found'; end if;
  if _matches > 1 then raise exception 'user_ambiguous'; end if;
  if _grant then
    insert into public.user_roles (user_id, role) values (_uid, _role) on conflict do nothing;
  else
    if _role = 'platform_admin' and (select count(*) from public.user_roles where role = 'platform_admin' and user_id <> _uid) = 0 then
      raise exception 'last_admin'; end if;
    delete from public.user_roles where user_id = _uid and role = _role;
  end if;
  perform public.write_audit(null, case when _grant then 'platform.role_granted' else 'platform.role_revoked' end,
    lower(trim(_email)), jsonb_build_object('role', _role, 'reason', _reason));
end $$;

-- ---------------------------------------------------------------- admin_assign_owner
create or replace function public.admin_assign_owner(_org_id uuid, _email text, _verification_note text)
returns void language plpgsql security definer set search_path = public as $$
declare _uid uuid; _org public.organizations; _prev public.org_role; _inactive int; _matches int;
begin
  if not public.is_platform_admin() then raise exception 'forbidden'; end if;
  -- the checks below must see owners and roles committed while this call waited for the locks
  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then
    raise exception 'isolation_unsupported';
  end if;
  if coalesce(length(trim(_verification_note)), 0) < 10 then raise exception 'verification_required'; end if;
  if _org_id is null then raise exception 'not_found'; end if;
  perform pg_advisory_xact_lock(hashtextextended('org_owner:' || _org_id::text, 0));
  select * into _org from public.organizations where id = _org_id for no key update;
  if _org.id is null then raise exception 'not_found'; end if;
  -- only an organization without an active owner can be recovered this way
  if exists (select 1 from public.organization_members m join auth.users u on u.id = m.user_id
              where m.org_id = _org_id and m.role = 'owner' and u.deleted_at is null) then
    raise exception 'owner_exists';
  end if;
  select count(*), min(id::text)::uuid into _matches, _uid from auth.users
   where lower(email) = lower(trim(_email)) and email_confirmed_at is not null and deleted_at is null;
  if _matches = 0 then raise exception 'user_not_found'; end if;
  if _matches > 1 then raise exception 'user_ambiguous'; end if;
  if _uid = auth.uid() then raise exception 'self_assignment_forbidden'; end if;
  perform pg_advisory_xact_lock(hashtextextended('platform_user:' || _uid::text, 0));
  if exists (select 1 from public.user_roles where user_id = _uid) then
    raise exception 'platform_user_forbidden';
  end if;
  select role into _prev from public.organization_members where org_id = _org_id and user_id = _uid;
  select count(*) into _inactive from public.organization_members where org_id = _org_id and role = 'owner';
  insert into public.organization_members (org_id, user_id, role) values (_org_id, _uid, 'owner')
    on conflict (org_id, user_id) do update set role = 'owner';
  perform public.write_audit(_org_id, 'platform.owner_assigned', lower(trim(_email)), jsonb_build_object(
    'verification', _verification_note, 'previous_role', _prev, 'org_status', _org.status,
    'inactive_owner_rows', _inactive));
end $$;
revoke all on function public.admin_assign_owner(uuid, text, text) from public, anon;
grant execute on function public.admin_assign_owner(uuid, text, text) to authenticated;
