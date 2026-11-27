-- CLIENT PREVIEW dataset functions: history back-dating and demo purge. Installed only on
--   * the hosted client-preview project, after scripts/preview/sql/client-preview-identity.sql
--     (dq_preview.marker present), or
--   * a local DISPOSABLE rehearsal stack marked by scripts/guard/target-guard.mjs (dq_guard.attest).
-- Anything else is refused before writing. Not a migration: it never reaches QA or production.
--
--   psql "<connection>" -f scripts/preview/sql/client-preview-functions.sql
--
-- Both functions are SECURITY DEFINER with an empty search_path, executable by service_role only,
-- re-check the destination on every call, and act on ONE organization that must be classified as
-- demo (organizations.is_demo). They never touch another organization, the auth schema or the audit
-- trail (audit rows keep their real time; purged organizations leave their audit rows with org_id
-- set to null by the existing foreign key).
--
-- client_preview_backdate(_org_id, _plan): the dataset is recorded through the same RPCs as the UI
-- (prices, tax, stock, COGS, payments, receipts), all stamped now(); this moves those rows to the
-- business time the dataset planned. Plan:
--   { "orders":   [{ "id": uuid, "at": ts, "steps": [{ "status": "in_prep"|"ready"|"delivered"|"cancelled", "at": ts }] }],
--     "receipts": [{ "id": uuid, "purchase_id": uuid, "ordered_at": ts, "received_at": ts }],
--     "openings_at": ts | null }
-- Every time must be in the past and within 120 days; steps must be in order and after the order.
--
-- client_preview_purge_operational(_org_id): deletes the operational rows of the demo organization
-- (what a reset replaces) and keeps the organization, stores, members and invitations.
-- client_preview_purge(_org_id): teardown — the operational rows, then the organization itself.
-- then the organization itself. Accounts are removed by the seed through the Auth admin API.
\set ON_ERROR_STOP on
DO $$
BEGIN
  IF to_regclass('dq_preview.marker') IS NULL THEN
    IF to_regprocedure('dq_guard.attest(text)') IS NULL THEN
      RAISE EXCEPTION 'refused: neither the client-preview marker nor a disposable local stack';
    END IF;
    PERFORM dq_guard.attest('seed:client-preview');
  ELSIF to_regnamespace('dq_guard') IS NOT NULL THEN
    RAISE EXCEPTION 'refused: a database cannot be both the hosted preview and a local stack';
  END IF;
END $$;

BEGIN;

CREATE OR REPLACE FUNCTION public.client_preview_assert_target(_org_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF to_regclass('dq_preview.marker') IS NULL THEN
    IF to_regprocedure('dq_guard.attest(text)') IS NULL THEN
      RAISE EXCEPTION 'refused: not the client preview';
    END IF;
    PERFORM dq_guard.attest('seed:client-preview');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = _org_id AND is_demo) THEN
    RAISE EXCEPTION 'refused: the organization is not a demo organization';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.client_preview_assert_target(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.client_preview_backdate(_org_id uuid, _plan jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o jsonb; s jsonb; r jsonb; at_ timestamptz; prev timestamptz; last_ timestamptz; cancel_at timestamptz;
  n_orders int := 0; n_receipts int := 0; n_openings int := 0; hist record;
BEGIN
  PERFORM public.client_preview_assert_target(_org_id);
  IF jsonb_typeof(_plan) <> 'object' THEN RAISE EXCEPTION 'invalid_plan'; END IF;

  FOR o IN SELECT * FROM jsonb_array_elements(coalesce(_plan->'orders', '[]'::jsonb)) LOOP
    at_ := (o->>'at')::timestamptz;
    IF at_ IS NULL OR at_ > now() OR at_ < now() - interval '120 days' THEN RAISE EXCEPTION 'invalid_time'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = (o->>'id')::uuid AND org_id = _org_id) THEN
      RAISE EXCEPTION 'unknown_order';
    END IF;
    prev := at_; last_ := at_; cancel_at := NULL;
    -- Status rows in their recorded order; each step gives the time of the matching transition.
    FOR s IN SELECT * FROM jsonb_array_elements(coalesce(o->'steps', '[]'::jsonb)) LOOP
      IF (s->>'at')::timestamptz IS NULL OR (s->>'at')::timestamptz < prev OR (s->>'at')::timestamptz > now() THEN
        RAISE EXCEPTION 'invalid_step_time';
      END IF;
      prev := (s->>'at')::timestamptz; last_ := prev;
      IF s->>'status' = 'cancelled' THEN cancel_at := prev; END IF;
    END LOOP;
    UPDATE public.orders SET created_at = at_, updated_at = last_ WHERE id = (o->>'id')::uuid AND org_id = _org_id;
    -- History: the payment row (to confirmed) at the order time, then one row per step.
    FOR hist IN
      SELECT h.id, h.to_status::text AS to_status,
             row_number() OVER (PARTITION BY h.to_status ORDER BY h.created_at, h.id) AS k
      FROM public.order_status_history h
      WHERE h.order_id = (o->>'id')::uuid AND h.org_id = _org_id
    LOOP
      UPDATE public.order_status_history SET created_at = coalesce((
        SELECT (st.value->>'at')::timestamptz
        FROM (SELECT value, row_number() OVER () AS rn FROM jsonb_array_elements(coalesce(o->'steps','[]'::jsonb))) st
        WHERE st.value->>'status' = hist.to_status
        ORDER BY st.rn OFFSET hist.k - 1 LIMIT 1), at_)
      WHERE id = hist.id;
    END LOOP;
    UPDATE public.payments SET created_at = at_,
      reversed_at = CASE WHEN reversed_at IS NOT NULL THEN coalesce(cancel_at, reversed_at) END
      WHERE order_id = (o->>'id')::uuid AND org_id = _org_id;
    UPDATE public.finance_entries SET created_at = CASE
        WHEN kind IN ('reversal_revenue', 'reversal_cogs') THEN coalesce(cancel_at, at_) ELSE at_ END
      WHERE order_id = (o->>'id')::uuid AND org_id = _org_id;
    UPDATE public.inventory_movements SET created_at = CASE
        WHEN kind = 'reversal' THEN coalesce(cancel_at, at_) ELSE at_ END
      WHERE order_id = (o->>'id')::uuid AND org_id = _org_id;
    n_orders := n_orders + 1;
  END LOOP;

  FOR r IN SELECT * FROM jsonb_array_elements(coalesce(_plan->'receipts', '[]'::jsonb)) LOOP
    IF (r->>'ordered_at')::timestamptz IS NULL OR (r->>'received_at')::timestamptz IS NULL
       OR (r->>'received_at')::timestamptz < (r->>'ordered_at')::timestamptz
       OR (r->>'received_at')::timestamptz > now()
       OR (r->>'ordered_at')::timestamptz < now() - interval '120 days' THEN
      RAISE EXCEPTION 'invalid_time';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.purchase_receipts WHERE id = (r->>'id')::uuid AND org_id = _org_id
                   AND purchase_order_id = (r->>'purchase_id')::uuid) THEN
      RAISE EXCEPTION 'unknown_receipt';
    END IF;
    UPDATE public.purchase_orders SET created_at = (r->>'ordered_at')::timestamptz,
      updated_at = (r->>'received_at')::timestamptz
      WHERE id = (r->>'purchase_id')::uuid AND org_id = _org_id;
    UPDATE public.purchase_receipts SET created_at = (r->>'received_at')::timestamptz
      WHERE id = (r->>'id')::uuid AND org_id = _org_id;
    UPDATE public.inventory_movements SET created_at = (r->>'received_at')::timestamptz
      WHERE client_event_id = 'receipt:' || (r->>'id') AND org_id = _org_id;
    UPDATE public.finance_entries SET created_at = (r->>'received_at')::timestamptz
      WHERE client_event_id = 'receipt:' || (r->>'id') AND org_id = _org_id;
    n_receipts := n_receipts + 1;
  END LOOP;

  IF _plan->>'openings_at' IS NOT NULL THEN
    at_ := (_plan->>'openings_at')::timestamptz;
    IF at_ > now() OR at_ < now() - interval '120 days' THEN RAISE EXCEPTION 'invalid_time'; END IF;
    UPDATE public.inventory_movements SET created_at = at_ WHERE org_id = _org_id AND kind = 'opening';
    GET DIAGNOSTICS n_openings = ROW_COUNT;
  END IF;

  RETURN jsonb_build_object('orders', n_orders, 'receipts', n_receipts, 'openings', n_openings);
END $$;
REVOKE ALL ON FUNCTION public.client_preview_backdate(uuid, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_preview_backdate(uuid, jsonb) TO service_role;

-- client_preview_purge_operational(_org_id): what a reset replaces — orders, payments, ledger, stock,
-- recipes, menu, suppliers, purchases, expenses. The organization, its stores, members (the personal
-- owners and the demo accounts), store assignments, invitations, subscription and audit trail stay, so
-- every person keeps their own access across resets without a new invitation.
CREATE OR REPLACE FUNCTION public.client_preview_purge_operational(_org_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE t text; n bigint; removed jsonb := '{}'::jsonb;
BEGIN
  PERFORM public.client_preview_assert_target(_org_id);
  -- Children before parents. order_item_modifiers has no org_id: reached through the order lines.
  DELETE FROM public.order_item_modifiers m USING public.order_items i
    WHERE m.order_item_id = i.id AND i.org_id = _org_id;
  GET DIAGNOSTICS n = ROW_COUNT;
  removed := removed || jsonb_build_object('order_item_modifiers', n);
  FOREACH t IN ARRAY ARRAY[
    'payments', 'finance_entries', 'inventory_movements', 'order_status_history', 'order_items',
    'orders', 'purchase_receipts', 'purchase_order_items', 'purchase_orders', 'recipe_ingredients',
    'product_recipes', 'inventory_items', 'menu_products', 'menu_categories', 'suppliers',
    'finance_expenses', 'whatsapp_records'
  ] LOOP
    EXECUTE format('DELETE FROM public.%I WHERE org_id = $1', t) USING _org_id;
    GET DIAGNOSTICS n = ROW_COUNT;
    removed := removed || jsonb_build_object(t, n);
  END LOOP;
  RETURN removed;
END $$;
REVOKE ALL ON FUNCTION public.client_preview_purge_operational(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_preview_purge_operational(uuid) TO service_role;

-- client_preview_purge(_org_id): teardown only — the operational data, then the organization itself
-- (stores, members, invitations, subscription cascade; audit rows are kept with org_id set to null).
CREATE OR REPLACE FUNCTION public.client_preview_purge(_org_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE n bigint; removed jsonb;
BEGIN
  removed := public.client_preview_purge_operational(_org_id);
  DELETE FROM public.organizations WHERE id = _org_id AND is_demo;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN removed || jsonb_build_object('organizations', n);
END $$;
REVOKE ALL ON FUNCTION public.client_preview_purge(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.client_preview_purge(uuid) TO service_role;

COMMIT;
NOTIFY pgrst, 'reload schema';
