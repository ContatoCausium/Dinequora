-- 0046_tips_by_server — tips recorded on dining room checks per server and store over the last N local
-- days, for payroll and tip reporting (Finance › Reports). Tips belong to the staff: they are never
-- revenue (0039), so they are reported here and nowhere in the ledger.
--
-- Read only, SECURITY INVOKER: the reader's own RLS decides what counts (dining_check_payments,
-- dining_checks and dining_sessions are readable with a tables permission at the store). Nothing is
-- written; no new privilege beyond EXECUTE for authenticated.
--
-- Counted: tenders with status 'recorded' (a reversed tender and its tip are left out), by the server of
-- the table's session, in the store's last N local days (its time zone, like 0031/0042/0044). Per server
-- and store: tenders, tips and the amount paid (tax included, tips excluded). Tips by method are split
-- into cash and non-cash, which payroll treats differently.
--
-- Rollback (a NEW migration): drop function public.tips_by_server(uuid, uuid[], integer).

set local lock_timeout = '5s';

create or replace function public.tips_by_server(
  _org_id uuid,
  _location_ids uuid[] default null,
  _days integer default 14
) returns table (
  location_id uuid,
  server_id uuid,
  tenders bigint,
  tips_cents bigint,
  cash_tips_cents bigint,
  paid_cents bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  with w as (
    select l.id,
           (((now() at time zone l.timezone)::date - (least(greatest(coalesce(_days, 14), 1), 366) - 1))
             ::timestamp at time zone l.timezone) as from_ts
      from public.locations l
     where l.org_id = _org_id
       and (_location_ids is null or l.id = any (_location_ids))
  )
  select w.id,
         s.server_id,
         count(*)::bigint,
         sum(p.tip_cents)::bigint,
         sum(case when p.method = 'cash' then p.tip_cents else 0 end)::bigint,
         sum(p.amount_cents)::bigint
    from w
    join public.dining_check_payments p
      on p.org_id = _org_id
     and p.location_id = w.id
     and p.created_at >= w.from_ts
     and p.created_at < now()
    join public.dining_checks c on c.id = p.check_id
    join public.dining_sessions s on s.id = c.session_id
   where p.status = 'recorded'
   group by w.id, s.server_id;
$$;

revoke all on function public.tips_by_server(uuid, uuid[], integer) from public, anon;
grant execute on function public.tips_by_server(uuid, uuid[], integer) to authenticated;
