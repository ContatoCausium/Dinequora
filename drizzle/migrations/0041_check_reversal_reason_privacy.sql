-- 0041_check_reversal_reason_privacy — the reason typed when a check payment is reversed is read only
-- by who may reverse payments at that store.
--
-- Before (0039): dining_check_payments was granted SELECT on every column to authenticated, and its RLS
-- policy lets any member with a tables permission at the store read the rows. So a server or a cashier
-- could read reversal_reason through the API, while the same kind of justification for a pending POS
-- sale is kept from them (0035).
-- Now:
--   1. the API role reads every column of dining_check_payments EXCEPT reversal_reason (column grants;
--      a table-level REVOKE also revokes column privileges, so this pair is idempotent). The rows and the
--      RLS policy are unchanged; the app never selected the column;
--   2. list_check_reversal_reasons(org, store, check) returns the reasons of that check's reversed
--      tenders to a member holding orders.refund AT THAT STORE (the permission void_check_payment
--      requires), checked with the same scope and permission helpers. Other tenants, other stores and
--      members without the permission are refused. Read only; nothing is written or audited.
--
-- Rollback (a NEW migration): grant select on table public.dining_check_payments to authenticated;
-- drop function public.list_check_reversal_reasons(uuid, uuid, uuid).

set local lock_timeout = '5s';

revoke select on table public.dining_check_payments from authenticated;
grant select (id, org_id, location_id, check_id, method, amount_cents, tip_cents, tendered_cents,
              change_cents, status, client_key, created_by, created_at, reversed_by, reversed_at)
  on table public.dining_check_payments to authenticated;

create or replace function public.list_check_reversal_reasons(
  _org_id uuid,
  _location_id uuid,
  _check_id uuid
) returns table (payment_id uuid, reason text)
language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_operational_scope(_org_id, _location_id);
  perform public.assert_permission(_org_id, 'orders.refund', _location_id);
  return query
    select p.id, p.reversal_reason
      from public.dining_check_payments p
     where p.org_id = _org_id
       and p.location_id = _location_id
       and p.check_id = _check_id
       and p.status = 'reversed'
     order by p.reversed_at, p.id;
end $$;

revoke all on function public.list_check_reversal_reasons(uuid, uuid, uuid) from public, anon;
grant execute on function public.list_check_reversal_reasons(uuid, uuid, uuid) to authenticated;
