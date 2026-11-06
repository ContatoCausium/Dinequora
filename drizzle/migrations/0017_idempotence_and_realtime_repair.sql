-- 0017_idempotence_and_realtime_repair.sql
-- Repairs for re-execution safety and realtime completeness.
-- Safe to run after 0016. Fully idempotent.
-- Does NOT modify any prior migration files.

-- ============================================================================
-- SECTION 1: INDEXES (idempotent guards)
-- ============================================================================
CREATE INDEX IF NOT EXISTS menu_products_org ON public.menu_products(org_id, active);
CREATE INDEX IF NOT EXISTS inventory_org_store ON public.inventory_items(org_id, location_id);
CREATE INDEX IF NOT EXISTS orders_org_store_date ON public.orders(org_id, location_id, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_kds ON public.orders(org_id, location_id, status);
CREATE INDEX IF NOT EXISTS order_items_parent ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS modifiers_item ON public.order_item_modifiers(order_item_id);
CREATE INDEX IF NOT EXISTS status_history_order ON public.order_status_history(order_id, created_at);
CREATE INDEX IF NOT EXISTS movements_order ON public.inventory_movements(order_id);
CREATE INDEX IF NOT EXISTS finance_store_date ON public.finance_entries(org_id, location_id, created_at);
CREATE INDEX IF NOT EXISTS expense_org_store ON public.finance_expenses(org_id, location_id);

-- ============================================================================
-- SECTION 2: REPLICA IDENTITY (required for Realtime UPDATE/DELETE events)
-- ============================================================================
ALTER TABLE public.orders REPLICA IDENTITY FULL;
ALTER TABLE public.order_items REPLICA IDENTITY FULL;

-- ============================================================================
-- SECTION 3: REALTIME PUBLICATION GUARDS
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.orders;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'order_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_items;
  END IF;
END $$;

-- ============================================================================
-- SECTION 4: RLS POLICIES (drop+create pattern for idempotence)
-- All USING clauses preserved verbatim from original migrations.
-- ============================================================================

DROP POLICY IF EXISTS menu_categories_read ON public.menu_categories;
CREATE POLICY menu_categories_read ON public.menu_categories
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS menu_products_read ON public.menu_products;
CREATE POLICY menu_products_read ON public.menu_products
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id) AND (cardinality(location_ids) = 0 OR public.is_org_owner(org_id) OR EXISTS (SELECT 1 FROM unnest(location_ids) x WHERE public.can_access_location(x))));

DROP POLICY IF EXISTS inventory_read ON public.inventory_items;
CREATE POLICY inventory_read ON public.inventory_items
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id) AND public.can_access_location(location_id));

DROP POLICY IF EXISTS recipes_read ON public.product_recipes;
CREATE POLICY recipes_read ON public.product_recipes
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id) AND public.can_access_location(location_id));

DROP POLICY IF EXISTS ingredients_read ON public.recipe_ingredients;
CREATE POLICY ingredients_read ON public.recipe_ingredients
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id) AND public.can_access_location(location_id));

DROP POLICY IF EXISTS orders_read ON public.orders;
CREATE POLICY orders_read ON public.orders
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id) AND public.can_access_location(location_id));

DROP POLICY IF EXISTS order_items_read ON public.order_items;
CREATE POLICY order_items_read ON public.order_items
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id) AND public.can_access_location(location_id));

DROP POLICY IF EXISTS modifiers_read ON public.order_item_modifiers;
CREATE POLICY modifiers_read ON public.order_item_modifiers
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.order_items i WHERE i.id = order_item_id AND public.can_access_location(i.location_id) AND public.is_org_member(i.org_id)));

DROP POLICY IF EXISTS history_read ON public.order_status_history;
CREATE POLICY history_read ON public.order_status_history
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id) AND public.can_access_location(location_id));

DROP POLICY IF EXISTS payments_read ON public.payments;
CREATE POLICY payments_read ON public.payments
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id) AND public.can_access_location(location_id));

DROP POLICY IF EXISTS movements_read ON public.inventory_movements;
CREATE POLICY movements_read ON public.inventory_movements
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id) AND public.can_access_location(location_id));

DROP POLICY IF EXISTS finance_read ON public.finance_entries;
CREATE POLICY finance_read ON public.finance_entries
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id) AND public.can_access_location(location_id) AND public.can_manage_org(org_id));

DROP POLICY IF EXISTS suppliers_read ON public.suppliers;
CREATE POLICY suppliers_read ON public.suppliers
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id));

DROP POLICY IF EXISTS purchases_read ON public.purchase_orders;
CREATE POLICY purchases_read ON public.purchase_orders
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id) AND public.can_access_location(location_id) AND public.can_manage_org(org_id));

DROP POLICY IF EXISTS po_items_read ON public.purchase_order_items;
CREATE POLICY po_items_read ON public.purchase_order_items
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id) AND public.can_access_location(location_id) AND public.can_manage_org(org_id));

DROP POLICY IF EXISTS receipts_read ON public.purchase_receipts;
CREATE POLICY receipts_read ON public.purchase_receipts
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id) AND public.can_access_location(location_id) AND public.can_manage_org(org_id));

DROP POLICY IF EXISTS whatsapp_read ON public.whatsapp_records;
CREATE POLICY whatsapp_read ON public.whatsapp_records
  FOR SELECT TO authenticated
  USING (public.is_org_owner(org_id));

DROP POLICY IF EXISTS expense_read ON public.finance_expenses;
CREATE POLICY expense_read ON public.finance_expenses
  FOR SELECT TO authenticated
  USING (public.is_org_member(org_id) AND public.can_access_location(location_id) AND public.can_manage_org(org_id));

-- ============================================================================
-- SECTION 5: TRIGGERS (drop+create pattern for idempotence)
-- ============================================================================

DROP TRIGGER IF EXISTS inventory_location ON public.inventory_items;
CREATE TRIGGER inventory_location
  BEFORE INSERT OR UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.validate_operational_location();

DROP TRIGGER IF EXISTS orders_location ON public.orders;
CREATE TRIGGER orders_location
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION public.validate_operational_location();

DROP TRIGGER IF EXISTS finance_location ON public.finance_entries;
CREATE TRIGGER finance_location
  BEFORE INSERT OR UPDATE ON public.finance_entries
  FOR EACH ROW EXECUTE FUNCTION public.validate_operational_location();

DROP TRIGGER IF EXISTS recipes_location ON public.product_recipes;
CREATE TRIGGER recipes_location
  BEFORE INSERT OR UPDATE ON public.product_recipes
  FOR EACH ROW EXECUTE FUNCTION public.validate_operational_location();

DROP TRIGGER IF EXISTS purchases_location ON public.purchase_orders;
CREATE TRIGGER purchases_location
  BEFORE INSERT OR UPDATE ON public.purchase_orders
  FOR EACH ROW EXECUTE FUNCTION public.validate_operational_location();

DROP TRIGGER IF EXISTS expense_location ON public.finance_expenses;
CREATE TRIGGER expense_location
  BEFORE INSERT OR UPDATE ON public.finance_expenses
  FOR EACH ROW EXECUTE FUNCTION public.validate_operational_location();

-- ============================================================================
-- SECTION 6: COLUMN EXISTENCE GUARDS
-- ============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'product_recipes' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE public.product_recipes ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'purchase_orders' AND column_name = 'metadata'
  ) THEN
    ALTER TABLE public.purchase_orders ADD COLUMN metadata jsonb NOT NULL DEFAULT '{}';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'inventory_movements' AND column_name = 'request_hash'
  ) THEN
    ALTER TABLE public.inventory_movements ADD COLUMN request_hash text;
  END IF;
END $$;

-- ============================================================================
-- SECTION 7: FUNCTION IDEMPOTENCE GUARDS
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'validate_operational_location'
  ) THEN
    RAISE EXCEPTION 'CRITICAL: validate_operational_location() missing. Run migrations 0012 first.';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'assert_operational_scope'
  ) THEN
    RAISE EXCEPTION 'CRITICAL: assert_operational_scope() missing. Run migration 0013 first.';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'save_operational_record'
  ) THEN
    RAISE EXCEPTION 'CRITICAL: save_operational_record() missing. Run migration 0014 first.';
  END IF;
END $$;

-- Guard: record_operational_movement must have request_hash patch from 0016
DO $$
DECLARE def text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'record_operational_movement'
  ) THEN
    def := pg_get_functiondef('public.record_operational_movement(uuid,uuid,uuid,text,numeric,text,text,uuid)'::regprocedure);
    IF position('fingerprint' IN def) = 0 THEN
      def := replace(def, 'd numeric; mid uuid; BEGIN', 'd numeric; mid uuid; fingerprint text; BEGIN');
      def := replace(def, 'PERFORM pg_advisory_xact_lock',
        'fingerprint:=md5(jsonb_build_object(''org'',_org_id,''location'',_location_id,''item'',_item_id,''type'',_type,''quantity'',_quantity,''reason'',_reason,''target'',_target_location_id)::text); PERFORM pg_advisory_xact_lock');
      def := replace(def, 'IF prior.reason<>_reason THEN', 'IF prior.request_hash IS DISTINCT FROM fingerprint THEN');
      def := replace(def, ',_reason,auth.uid()) RETURNING id INTO mid;',
        ',_reason,auth.uid()) RETURNING id INTO mid; UPDATE public.inventory_movements SET request_hash=fingerprint WHERE id=mid;');
      EXECUTE def;
    END IF;
  END IF;
END $$;

-- Guard: save_operational_menu must have duplicate modifier validation from 0016
DO $$
DECLARE def text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'save_operational_menu'
  ) THEN
    def := pg_get_functiondef('public.save_operational_menu(uuid,text,jsonb)'::regprocedure);
    IF position('duplicate_modifier_group' IN def) = 0 THEN
      def := replace(def,
        'FOR g IN SELECT * FROM jsonb_array_elements(coalesce(_payload->''modifierGroups'',''[]'')) LOOP',
        'IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(_payload->''modifierGroups'',''[]'')) AS groups(value) GROUP BY groups.value->>''id'' HAVING count(*)>1) THEN RAISE EXCEPTION ''duplicate_modifier_group''; END IF; FOR g IN SELECT * FROM jsonb_array_elements(coalesce(_payload->''modifierGroups'',''[]'')) LOOP');
      def := replace(def,
        'FOR o IN SELECT * FROM jsonb_array_elements(g->''options'') LOOP',
        'IF jsonb_typeof(g->''options'') IS DISTINCT FROM ''array'' OR EXISTS(SELECT 1 FROM jsonb_array_elements(g->''options'') AS options(value) GROUP BY options.value->>''id'' HAVING count(*)>1) THEN RAISE EXCEPTION ''duplicate_modifier_option''; END IF; FOR o IN SELECT * FROM jsonb_array_elements(g->''options'') LOOP');
      def := replace(def,
        'OR (o->>''priceCents'')::int<0',
        'OR o->>''priceCents'' IS NULL OR (o->>''priceCents'')::int<0');
      EXECUTE def;
    END IF;
  END IF;
END $$;

-- Guard: receive_operational_purchase must have alias fix from 0015
DO $$
DECLARE def text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'receive_operational_purchase'
  ) THEN
    def := pg_get_functiondef('public.receive_operational_purchase(uuid,jsonb,text,text)'::regprocedure);
    IF position('jsonb_array_elements(_items) x GROUP BY x->>' IN def) > 0
       AND position('receipt_element' IN def) = 0 THEN
      def := replace(def,
        'jsonb_array_elements(_items) x GROUP BY x->>''itemId''',
        'jsonb_array_elements(_items) AS receipt_element(value) GROUP BY receipt_element.value->>''itemId''');
      EXECUTE def;
    END IF;
  END IF;
END $$;

-- Guard: save_operational_record must have inventory validation from 0015
DO $$
DECLARE def text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'save_operational_record'
  ) THEN
    def := pg_get_functiondef('public.save_operational_record(uuid,uuid,text,jsonb)'::regprocedure);
    IF position('invalid_inventory' IN def) = 0 THEN
      def := replace(def,
        'IF _kind=''inventory'' THEN',
        'IF _kind=''inventory'' THEN IF NOT (_payload ? ''quantity'' AND _payload ? ''costCents'' AND _payload ? ''unit'') OR _payload->>''quantity'' IS NULL OR _payload->>''costCents'' IS NULL OR _payload->>''unit'' NOT IN(''oz'',''lb'',''gal'',''kg'',''units'',''pack'') THEN RAISE EXCEPTION ''invalid_inventory''; END IF;');
      EXECUTE def;
    END IF;
  END IF;
END $$;

-- ============================================================================
-- SECTION 8: GRANT REPAIRS
-- ============================================================================
GRANT EXECUTE ON FUNCTION public.save_operational_menu(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.archive_operational_menu(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_pos_sale(uuid, uuid, public.order_type, text, text, text, text, text, text, integer, integer, jsonb, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_pos_sale_atomic(uuid, uuid, public.order_type, text, text, text, text, text, text, integer, integer, jsonb, boolean, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.persist_finalized_pos_sale_atomic(uuid, uuid, public.order_type, text, text, text, text, text, text, integer, integer, jsonb, boolean, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_order_with_reversal(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_order_status(uuid, public.order_status, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_order_item_ready(uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_operational_record(uuid, uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_operational_movement(uuid, uuid, uuid, text, numeric, text, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.receive_operational_purchase(uuid, jsonb, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_operational_purchase(uuid, text) TO authenticated;

REVOKE ALL ON FUNCTION public.save_operational_menu(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.archive_operational_menu(uuid, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_pos_sale(uuid, uuid, public.order_type, text, text, text, text, text, text, integer, integer, jsonb, boolean, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalize_pos_sale_atomic(uuid, uuid, public.order_type, text, text, text, text, text, text, integer, integer, jsonb, boolean, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.persist_finalized_pos_sale_atomic(uuid, uuid, public.order_type, text, text, text, text, text, text, integer, integer, jsonb, boolean, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_order_with_reversal(uuid, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_order_status(uuid, public.order_status, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_order_item_ready(uuid, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.save_operational_record(uuid, uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_operational_movement(uuid, uuid, uuid, text, numeric, text, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.receive_operational_purchase(uuid, jsonb, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_operational_purchase(uuid, text) FROM PUBLIC, anon;