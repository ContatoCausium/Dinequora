-- 0019_permission_performance — same rules as 0018, evaluated in O(1) per row.
--
-- 0018 computed a member's effective permissions on every has_permission() call. Read RLS calls it
-- once per row, so a member WITHOUT a permission paid ~2 ms per scanned row (1.5 s for ~800 audit
-- rows; statement timeouts under load). The effective set is now materialized on the member row and
-- kept in sync by triggers; has_permission() becomes a single indexed lookup on
-- organization_members(org_id, user_id). Semantics are unchanged: same catalog, ceilings, defaults,
-- profile ∪ extra − revoked, owners have everything.

-- Pure computation from explicit inputs (used by triggers and the backfill).
create or replace function public.effective_permissions_for(
  _role public.org_role, _profile_id uuid, _extra text[], _revoked text[])
returns text[] language sql stable security definer set search_path = public as $$
  select case when _role = 'owner' then public.permission_catalog() else
    array(
      select distinct p
      from unnest(coalesce((select pp.permissions from public.permission_profiles pp where pp.id = _profile_id),
                           public.role_default_permissions(_role)) || coalesce(_extra, '{}')) p
      where p = any(public.role_ceiling(_role)) and not (p = any(coalesce(_revoked, '{}')))
      order by p)
  end
$$;

alter table public.organization_members
  add column if not exists effective_permissions text[] not null default '{}';

create or replace function public.trg_member_effective_permissions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.effective_permissions := public.effective_permissions_for(
    new.role, new.profile_id, new.extra_permissions, new.revoked_permissions);
  return new;
end $$;
drop trigger if exists member_effective_permissions on public.organization_members;
create trigger member_effective_permissions
  before insert or update of role, profile_id, extra_permissions, revoked_permissions
  on public.organization_members
  for each row execute function public.trg_member_effective_permissions();

-- Editing a profile (permissions or tier) refreshes every member that uses it.
create or replace function public.trg_profile_refresh_members()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.organization_members m
     set effective_permissions = public.effective_permissions_for(
           m.role, m.profile_id, m.extra_permissions, m.revoked_permissions)
   where m.profile_id = new.id;
  return new;
end $$;
drop trigger if exists profile_refresh_members on public.permission_profiles;
create trigger profile_refresh_members
  after update of permissions, tier on public.permission_profiles
  for each row execute function public.trg_profile_refresh_members();

-- Backfill (column not referenced by the member trigger's UPDATE OF list, so set it directly).
update public.organization_members
   set effective_permissions = public.effective_permissions_for(role, profile_id, extra_permissions, revoked_permissions);

-- Same signatures as 0018; now read the materialized set.
create or replace function public.member_permissions(_member_id uuid)
returns text[] language sql stable security definer set search_path = public as $$
  select case when m.role = 'owner' then public.permission_catalog() else m.effective_permissions end
  from public.organization_members m where m.id = _member_id
$$;

create or replace function public.has_permission(_org_id uuid, _perm text, _location_id uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
      select 1 from public.organization_members m
      where m.org_id = _org_id and m.user_id = auth.uid()
        and (m.role = 'owner' or _perm = any(m.effective_permissions)))
    and (_location_id is null or public.can_access_location(_location_id))
$$;

create or replace function public.has_any_permission(_org_id uuid, _perms text[], _location_id uuid default null)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
      select 1 from public.organization_members m
      where m.org_id = _org_id and m.user_id = auth.uid()
        and (m.role = 'owner' or m.effective_permissions && _perms))
    and (_location_id is null or public.can_access_location(_location_id))
$$;

revoke all on function public.effective_permissions_for(public.org_role, uuid, text[], text[]),
  public.trg_member_effective_permissions(), public.trg_profile_refresh_members()
  from public, anon, authenticated;

-- Policies: "member holds any of these permissions in the row's org" becomes an uncorrelated
-- sub-select evaluated once per statement (hashed), instead of a function call per row.
-- Store access stays a per-row can_access_location() check exactly as before.
create or replace function public.orgs_with_any_permission(_perms text[])
returns setof uuid language sql stable security definer set search_path = public as $$
  select m.org_id from public.organization_members m
  where m.user_id = auth.uid() and (m.role = 'owner' or m.effective_permissions && _perms)
$$;
revoke all on function public.orgs_with_any_permission(text[]) from public, anon;
grant execute on function public.orgs_with_any_permission(text[]) to authenticated;

alter policy finance_read on public.finance_entries using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and org_id in (select public.orgs_with_any_permission(array['finance.view','dashboard.financials','reports.view'])));
alter policy expense_read on public.finance_expenses using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and org_id in (select public.orgs_with_any_permission(array['finance.view','expenses.view'])));
alter policy purchases_read on public.purchase_orders using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and org_id in (select public.orgs_with_any_permission(array['purchases.view'])));
alter policy po_items_read on public.purchase_order_items using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and org_id in (select public.orgs_with_any_permission(array['purchases.view'])));
alter policy receipts_read on public.purchase_receipts using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and org_id in (select public.orgs_with_any_permission(array['purchases.view'])));
alter policy orders_read on public.orders using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and org_id in (select public.orgs_with_any_permission(array['orders.view','pos.view','kds.view','reports.view','dashboard.financials'])));
alter policy order_items_read on public.order_items using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and org_id in (select public.orgs_with_any_permission(array['orders.view','pos.view','kds.view','reports.view','dashboard.financials'])));
alter policy history_read on public.order_status_history using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and org_id in (select public.orgs_with_any_permission(array['orders.view','pos.view','kds.view','reports.view','dashboard.financials'])));
alter policy payments_read on public.payments using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and org_id in (select public.orgs_with_any_permission(array['orders.view','pos.view','reports.view','dashboard.financials','finance.view'])));
alter policy modifiers_read on public.order_item_modifiers using (
  exists (select 1 from public.order_items i where i.id = order_item_modifiers.order_item_id
          and public.is_org_member(i.org_id) and public.can_access_location(i.location_id)
          and i.org_id in (select public.orgs_with_any_permission(array['orders.view','pos.view','kds.view','reports.view','dashboard.financials']))));
alter policy inventory_read on public.inventory_items using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and org_id in (select public.orgs_with_any_permission(array['inventory.view','purchases.view','recipes.view'])));
alter policy movements_read on public.inventory_movements using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and org_id in (select public.orgs_with_any_permission(array['inventory.view'])));
alter policy recipes_read on public.product_recipes using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and org_id in (select public.orgs_with_any_permission(array['recipes.view','inventory.view'])));
alter policy ingredients_read on public.recipe_ingredients using (
  public.is_org_member(org_id) and public.can_access_location(location_id)
  and org_id in (select public.orgs_with_any_permission(array['recipes.view','inventory.view'])));
alter policy suppliers_read on public.suppliers using (
  public.is_org_member(org_id)
  and org_id in (select public.orgs_with_any_permission(array['suppliers.view','purchases.view'])));
alter policy "Managers read invitations" on public.invitations using (
  org_id in (select public.orgs_with_any_permission(array['team.view'])));
alter policy "Org managers read org audit" on public.audit_logs using (
  org_id is not null and org_id in (select public.orgs_with_any_permission(array['team.activity'])));

-- Pre-existing policy, same semantics: evaluate the caller-only check once per statement (initplan).
alter policy "Platform admins read all audit" on public.audit_logs using ((select public.is_platform_admin()));
