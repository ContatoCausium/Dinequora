-- 0036_retire_legacy_pos_sale_rpcs - the three sale RPCs of the basis-point era are no longer callable
-- through the API. Additive: nothing is dropped, no body changes, no data changes.
--
-- Since 0025 the application records every sale through the "_v2" functions (store tax rate in parts
-- per million): persist_finalized_pos_sale_atomic_v2 (sale + payment) and create_pos_sale_v2 (open
-- order). The previous signatures were kept as thin wrappers that validate the basis points and
-- DELEGATE to v2:
--   create_pos_sale                    -> create_pos_sale_v2
--   finalize_pos_sale_atomic           -> finalize_pos_sale_atomic_v2
--   persist_finalized_pos_sale_atomic  -> finalize_pos_sale_atomic (SQL wrapper of 0013)
-- Because they delegate, they were never a way around the closed-key refusal of 0032 or the
-- isolation check of 0033 (checked by scripts/security/pos_sale_flow_integrity.mjs: as the owner
-- of the functions, a closed key is refused through each of them). But no application version calls
-- them (main, the published Client Preview Worker 55493d4 and this branch all call v2; the calls are
-- made by server functions, so no cached browser bundle is involved), and three extra entry points
-- for writing a sale are three more things to keep correct. They are retired from the API:
--   * EXECUTE is revoked from PUBLIC, anon, authenticated and service_role (service_role never
--     needed it: the functions require auth.uid());
--   * the functions stay, owned and executable by postgres only (nothing is dropped; the rollback
--     below only grants again). All three are SECURITY DEFINER and reach v2 as their owner, so
--     each one is an entry point of its own and all three are retired together;
--   * the v2 functions are not touched: same bodies, same privileges (authenticated yes, anon no).
-- The run aborts if, afterwards, an API role can still execute a retired function or the current
-- flow lost its privilege.
--
-- Before applying to any environment: its deployed server build must contain 10b2d94 (the 0025 app,
-- which calls v2). The Client Preview (55493d4) and main do.
-- Rollback (a NEW migration): docs/operations/security-closure/0036-rollback.sql (grants EXECUTE to
-- authenticated again).
set local lock_timeout = '5s';

revoke all on function public.create_pos_sale(uuid, uuid, public.order_type, text, text, text, text, text, text, integer, integer, jsonb, boolean, text)
  from public, anon, authenticated, service_role;
revoke all on function public.finalize_pos_sale_atomic(uuid, uuid, public.order_type, text, text, text, text, text, text, integer, integer, jsonb, boolean, text, text)
  from public, anon, authenticated, service_role;
revoke all on function public.persist_finalized_pos_sale_atomic(uuid, uuid, public.order_type, text, text, text, text, text, text, integer, integer, jsonb, boolean, text, text)
  from public, anon, authenticated, service_role;

comment on function public.create_pos_sale(uuid, uuid, public.order_type, text, text, text, text, text, text, integer, integer, jsonb, boolean, text)
  is 'RETIRED from the API by 0036 (owner only). Delegates to create_pos_sale_v2; the application calls v2.';
comment on function public.finalize_pos_sale_atomic(uuid, uuid, public.order_type, text, text, text, text, text, text, integer, integer, jsonb, boolean, text, text)
  is 'RETIRED from the API by 0036 (owner only). Delegates to finalize_pos_sale_atomic_v2; the application calls v2.';
comment on function public.persist_finalized_pos_sale_atomic(uuid, uuid, public.order_type, text, text, text, text, text, text, integer, integer, jsonb, boolean, text, text)
  is 'RETIRED from the API by 0036 (owner only). Calls finalize_pos_sale_atomic; the application calls persist_finalized_pos_sale_atomic_v2.';

-- verified in the same transaction: any surprise aborts the whole run
do $$
declare f record; r text;
begin
  for f in select p.oid, p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('create_pos_sale', 'finalize_pos_sale_atomic', 'persist_finalized_pos_sale_atomic') loop
    foreach r in array array['anon', 'authenticated', 'service_role'] loop
      if has_function_privilege(r, f.oid, 'EXECUTE') then
        raise exception 'legacy sale function % is still executable by %', f.proname, r;
      end if;
    end loop;
  end loop;
  -- every function, legacy and current, exists exactly once (an overload would be a second entry point)
  for f in select n.name, (select count(*) from pg_proc p
                            where p.pronamespace = 'public'::regnamespace and p.proname = n.name) as defs
             from unnest(array['create_pos_sale', 'finalize_pos_sale_atomic', 'persist_finalized_pos_sale_atomic',
                               'create_pos_sale_v2', 'finalize_pos_sale_atomic_v2', 'persist_finalized_pos_sale_atomic_v2']) n(name) loop
    if f.defs <> 1 then
      raise exception 'expected exactly one definition of sale function %, found %', f.name, f.defs;
    end if;
  end loop;
  for f in select p.oid, p.proname from pg_proc p
            where p.pronamespace = 'public'::regnamespace
              and p.proname in ('create_pos_sale_v2', 'finalize_pos_sale_atomic_v2', 'persist_finalized_pos_sale_atomic_v2') loop
    if not has_function_privilege('authenticated', f.oid, 'EXECUTE') or has_function_privilege('anon', f.oid, 'EXECUTE') then
      raise exception 'current sale function % must stay executable by authenticated and not by anon', f.proname;
    end if;
  end loop;
end $$;
