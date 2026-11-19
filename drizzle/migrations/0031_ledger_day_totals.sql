-- 0031_ledger_day_totals — financial totals aggregated by the database at read time (M2).
--
-- Before: the app read every finance_entries row of the period page by page (1,000 rows per request,
-- wave 0) and added them up in the server function: correct, but the cost grew with the volume.
-- Now one function returns, in ONE statement (one MVCC snapshot), the totals per store × local day ×
-- kind for the period, plus "yesterday up to the same local time":
--   * no totals are stored: every call aggregates the ledger itself, so the figures are identical
--     to the ledger by construction; back-dated rows, deletions and time-zone changes are reflected
--     on the next read with no maintenance;
--   * each store's window and local day use that store's IANA zone (locations.timezone), DST-aware;
--     CHANGING a store's zone re-buckets its whole history into the new zone's days;
--   * SECURITY INVOKER: the RLS of finance_entries and of locations still decides what the caller
--     sees — no new access path;
--   * a single jsonb value is returned, so PostgREST's max-rows (1,000) never cuts the result.
--
-- finance_read is rewritten WITHOUT changing who may read what. The previous policy called
-- is_org_member() and can_access_location() — SECURITY DEFINER functions the planner cannot inline —
-- once PER ROW (≈60 µs per row: 1,000,000 rows ≈ 68 s, beyond the 8 s statement timeout). The same
-- rules are now evaluated ONCE per query:
--   * org_id in orgs_with_any_permission(finance.view, dashboard.financials, reports.view) — that
--     set contains only organizations the caller is a member of, so it already implies
--     is_org_member(org_id);
--   * location_id in accessible_location_ids() — exactly the predicate of can_access_location():
--     a store of an organization the caller belongs to, as owner or with explicit store access.
-- Same rows visible for every caller (tested per role, store and tenant against the old policy).
--
-- Rollback (a NEW migration, in this order — never DROP ... CASCADE, which would also drop the
-- policy that depends on accessible_location_ids and leave the ledger unreadable):
--   1. alter policy finance_read back to the previous expression (kept in a comment below);
--   2. drop function ledger_day_totals(uuid, uuid[], integer, boolean);
--   3. drop function accessible_location_ids();
-- The app falls back to the paged reader when ledger_day_totals does not exist (only that error —
-- any other error is raised).
--
-- Lock wait limit (added 2026-11-19, before this migration was applied to any hosted database):
-- ALTER POLICY below needs an ACCESS EXCLUSIVE lock on finance_entries; queued behind a slow reader
-- it would also hold back every new ledger read. drizzle-kit migrate (postgres.js driver) applies
-- ALL pending migrations and their tracker rows in ONE transaction, so SET LOCAL holds for the rest
-- of that transaction (this file and every later one in the same run). A lock not obtained within
-- 5 s raises 55P03 and the WHOLE run rolls back: nothing applied, nothing recorded; run it again.
-- PGOPTIONS does not work here: the runner does not pass it on and postgres.js ignores it.
set local lock_timeout = '5s';

-- ---------------------------------------------------------------- store access, once per query
create or replace function public.accessible_location_ids()
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
revoke all on function public.accessible_location_ids() from public, anon;
grant execute on function public.accessible_location_ids() to authenticated;

-- previous (0019): using (public.is_org_member(org_id) and public.can_access_location(location_id)
--   and org_id in (select public.orgs_with_any_permission(array['finance.view','dashboard.financials','reports.view'])))
alter policy finance_read on public.finance_entries using (
  org_id in (select public.orgs_with_any_permission(array['finance.view','dashboard.financials','reports.view']))
  and location_id in (select public.accessible_location_ids()));

-- ---------------------------------------------------------------- aggregation
create or replace function public.ledger_day_totals(
  _org_id uuid,
  _location_ids uuid[] default null,
  _days integer default null,
  _same_time_yesterday boolean default false
) returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with s as (
    select l.id, l.timezone, (now() at time zone l.timezone)::date as today
      from public.locations l
     where l.org_id = _org_id
       and (_location_ids is null or l.id = any (_location_ids))
  ), w as (
    -- Window bounds as plain timestamptz values: the index range on (org_id, location_id,
    -- created_at) is applied before anything else, so only rows of the window are read.
    select s.id, s.timezone, s.today, d.since_day,
           coalesce(d.since_day::timestamp at time zone s.timezone, '-infinity'::timestamptz) as from_ts,
           ((s.today - 1)::timestamp at time zone s.timezone) as y_from,
           (((s.today - 1) + (now() at time zone s.timezone)::time) at time zone s.timezone) as y_until
      from s
     cross join lateral (
       select case when _days is null then null
                   else s.today - (least(greatest(_days, 1), 3700) - 1) end as since_day) d
  ), b as (
    -- One index range scan per store: (org_id, location_id, created_at) between from_ts and now().
    select w.id as location_id,
           (f.created_at at time zone w.timezone)::date as day,
           f.kind,
           sum(f.amount_cents)::bigint as cents,
           count(*)::bigint as n
      from w
     cross join lateral (
       select e.created_at, e.kind, e.amount_cents
         from public.finance_entries e
        where e.org_id = _org_id
          and e.location_id = w.id
          and e.created_at >= w.from_ts
          and e.created_at < now()) f
     group by 1, 2, 3
  ), y as (
    select w.id as location_id, f.kind, sum(f.amount_cents)::bigint as cents, count(*)::bigint as n
      from w
     cross join lateral (
       select e.kind, e.amount_cents
         from public.finance_entries e
        where _same_time_yesterday
          and e.org_id = _org_id
          and e.location_id = w.id
          and e.created_at >= w.y_from
          and e.created_at < w.y_until) f
     group by 1, 2
  )
  select jsonb_build_object(
    'read_until', now(),
    'stores', coalesce((select jsonb_agg(jsonb_build_object(
                 'id', w.id, 'tz', w.timezone, 'today', w.today, 'since', w.since_day)) from w), '[]'::jsonb),
    'buckets', coalesce((select jsonb_agg(jsonb_build_array(b.location_id, b.day, b.kind, b.cents, b.n)) from b), '[]'::jsonb),
    'yesterday', coalesce((select jsonb_agg(jsonb_build_array(y.location_id, y.kind, y.cents, y.n)) from y), '[]'::jsonb)
  );
$$;

revoke all on function public.ledger_day_totals(uuid, uuid[], integer, boolean) from public, anon;
grant execute on function public.ledger_day_totals(uuid, uuid[], integer, boolean) to authenticated;
