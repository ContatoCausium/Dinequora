-- 0044_inventory_consumption — what each stock item was consumed by sales over the last N local days,
-- for the purchase forecast (Inventory > Purchase forecast).
--
-- Read only, SECURITY INVOKER: the reader's RLS on inventory_movements decides what counts
-- (inventory.view at the stores the member can access). Nothing is written; no new privilege beyond
-- EXECUTE for authenticated.
--
-- Consumed = the stock taken by sales ('sale' movements, negative) minus what came back when those
-- sales were reversed ('reversal' movements whose reversed movement is a sale), in the item's own unit.
-- Manual adjustments, losses, transfers and receipts are NOT consumption. The window is the store's last
-- N local days up to now (its time zone, like 0031 and 0042).
--
-- The index (org_id, location_id, created_at) lets each store's window be read as one range instead of
-- the whole table (inventory_movements had only order_id and reverses_id indexes). The table is small
-- today; CREATE INDEX holds a SHARE lock while it builds, and lock_timeout bounds the wait.
--
-- Rollback (a NEW migration): drop function public.inventory_consumption(uuid, uuid[], integer);
-- drop index public.inventory_movements_store_date.

set local lock_timeout = '5s';

create index if not exists inventory_movements_store_date
  on public.inventory_movements (org_id, location_id, created_at);

create or replace function public.inventory_consumption(
  _org_id uuid,
  _location_ids uuid[] default null,
  _days integer default 30
) returns table (
  location_id uuid,
  inventory_item_id uuid,
  consumed numeric
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
  select w.id, m.inventory_item_id, -sum(m.delta)::numeric
    from w
    join public.inventory_movements m
      on m.org_id = _org_id
     and m.location_id = w.id
     and m.created_at >= w.from_ts
     and m.created_at < now()
   where m.kind = 'sale'
      or (m.kind = 'reversal'
          and exists (select 1 from public.inventory_movements s
                       where s.id = m.reverses_id and s.kind = 'sale'))
   group by w.id, m.inventory_item_id
  having -sum(m.delta) > 0;
$$;

revoke all on function public.inventory_consumption(uuid, uuid[], integer) from public, anon;
grant execute on function public.inventory_consumption(uuid, uuid[], integer) to authenticated;
