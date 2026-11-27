-- 0042_menu_item_sales — units and sales per menu product and store over the last N local days, for
-- menu engineering (Intelligence > Menu engineering).
--
-- Read only, SECURITY INVOKER: the reader's own RLS decides which orders and items are counted (the same
-- policies as the order history: orders.view, pos.view, kds.view, reports.view or
-- dashboard.financials, at the stores the member can access). Nothing is written, no privilege is
-- added, no new table.
--
-- Counted: orders not cancelled whose created_at falls in the window [first local day, now()) of each
-- store (the store's own time zone, like ledger_day_totals in 0031). Units = sum of quantity; sales =
-- sum of the item subtotal (unit price with options, before order discounts and tax). Simulated orders
-- (demo organizations only, 0018) are counted as the rest of Intelligence counts them.
--
-- One index range scan per store on orders_org_store_date (org_id, location_id, created_at), then
-- order_items by order_id (order_items_parent).
--
-- Rollback (a NEW migration): drop function public.menu_item_sales(uuid, uuid[], integer).

set local lock_timeout = '5s';

create or replace function public.menu_item_sales(
  _org_id uuid,
  _location_ids uuid[] default null,
  _days integer default 30
) returns table (
  location_id uuid,
  product_id uuid,
  product_name text,
  units numeric,
  sales_cents bigint,
  orders bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with w as (
    select l.id,
           (((now() at time zone l.timezone)::date - (least(greatest(coalesce(_days, 30), 1), 366) - 1))
             ::timestamp at time zone l.timezone) as from_ts
      from public.locations l
     where l.org_id = _org_id
       and (_location_ids is null or l.id = any (_location_ids))
  )
  select w.id,
         i.product_id,
         max(i.product_name),
         sum(i.quantity)::numeric,
         sum(i.subtotal_cents)::bigint,
         count(distinct o.id)::bigint
    from w
    join public.orders o
      on o.org_id = _org_id
     and o.location_id = w.id
     and o.created_at >= w.from_ts
     and o.created_at < now()
    join public.order_items i on i.order_id = o.id
   where o.status <> 'cancelled'
   group by w.id, i.product_id;
$$;

revoke all on function public.menu_item_sales(uuid, uuid[], integer) from public, anon;
grant execute on function public.menu_item_sales(uuid, uuid[], integer) to authenticated;
