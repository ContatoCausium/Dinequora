-- 0045_sales_tax_summary — sales tax collected per store and local calendar month, for the sales tax
-- report (Finance › Reports). Plan Phase 7, "relatórios fiscais".
--
-- Read only, SECURITY INVOKER: the reader's own RLS on orders decides what counts (the same policies as
-- the order history: orders.view, pos.view, kds.view, reports.view or dashboard.financials, at the
-- stores the member can access). Nothing is written; no new privilege beyond EXECUTE for authenticated.
--
-- Counted: orders not cancelled and not simulated (simulated orders exist only in demo organizations and
-- are never taxable sales), by the month of created_at in the store's own time zone, for the last N
-- months including the current one. Per store and month: orders, taxable sales (subtotal − discount),
-- tax collected, and the total. The rate in force is not assumed: it is what each order recorded.
-- Tips (dining room payments) are not sales and are not here.
--
-- Rollback (a NEW migration): drop function public.sales_tax_summary(uuid, uuid[], integer).

set local lock_timeout = '5s';

create or replace function public.sales_tax_summary(
  _org_id uuid,
  _location_ids uuid[] default null,
  _months integer default 3
) returns table (
  location_id uuid,
  month text,
  orders bigint,
  taxable_cents bigint,
  tax_cents bigint,
  total_cents bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with w as (
    select l.id, l.timezone,
           ((date_trunc('month', now() at time zone l.timezone)
             - make_interval(months => least(greatest(coalesce(_months, 3), 1), 24) - 1))
             at time zone l.timezone) as from_ts
      from public.locations l
     where l.org_id = _org_id
       and (_location_ids is null or l.id = any (_location_ids))
  )
  select w.id,
         to_char(o.created_at at time zone w.timezone, 'YYYY-MM'),
         count(*)::bigint,
         sum(o.subtotal_cents - o.discount_cents)::bigint,
         sum(o.tax_cents)::bigint,
         sum(o.total_cents)::bigint
    from w
    join public.orders o
      on o.org_id = _org_id
     and o.location_id = w.id
     and o.created_at >= w.from_ts
     and o.created_at < now()
   where o.status <> 'cancelled'
     and not o.is_simulation
   group by w.id, 2;
$$;

revoke all on function public.sales_tax_summary(uuid, uuid[], integer) from public, anon;
grant execute on function public.sales_tax_summary(uuid, uuid[], integer) to authenticated;
