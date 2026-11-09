-- Migration 0011: Idempotency hardening for POS sales
-- Ensures UNIQUE index on orders (org_id, client_order_id) and idempotent create_pos_sale RPC

CREATE UNIQUE INDEX IF NOT EXISTS orders_org_client_order_id_uniq
ON public.orders (org_id, client_order_id)
WHERE (client_order_id IS NOT NULL);

CREATE OR REPLACE FUNCTION public.create_pos_sale(
  _org_id uuid,
  _location_id uuid,
  _type order_type,
  _customer_name text,
  _customer_phone text DEFAULT NULL::text,
  _customer_email text DEFAULT NULL::text,
  _delivery_address text DEFAULT NULL::text,
  _table_number text DEFAULT NULL::text,
  _notes text DEFAULT NULL::text,
  _discount_cents integer DEFAULT 0,
  _tax_rate_basis_points integer DEFAULT 825,
  _items jsonb DEFAULT '[]'::jsonb,
  _is_simulation boolean DEFAULT false,
  _client_order_id text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _existing_id uuid;
  _oid uuid;
  _order_num text;
  _item jsonb;
  _mod jsonb;
  _item_id uuid;
  _calc_subtotal integer := 0;
  _item_unit_price integer;
  _item_qty integer;
  _item_mods_total integer;
  _item_total integer;
  _calc_tax integer := 0;
  _calc_total integer := 0;
  _product_uuid uuid;
  _mod_opt_uuid uuid;
BEGIN
  IF NOT public.can_access_location(_location_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  PERFORM public.assert_org_operational(_org_id);

  IF NOT EXISTS (
    SELECT 1 FROM public.locations
    WHERE id = _location_id AND org_id = _org_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'invalid_location_for_org';
  END IF;

  IF _client_order_id IS NOT NULL AND length(trim(_client_order_id)) > 0 THEN
    SELECT id INTO _existing_id FROM public.orders
    WHERE org_id = _org_id AND client_order_id = trim(_client_order_id)
    LIMIT 1;
    IF _existing_id IS NOT NULL THEN
      RETURN _existing_id;
    END IF;
  END IF;

  IF coalesce(length(trim(_customer_name)), 0) < 1 THEN
    _customer_name := 'Walk-in Customer';
  END IF;

  IF _items IS NULL OR jsonb_array_length(_items) = 0 THEN
    RAISE EXCEPTION 'order_empty';
  END IF;

  _order_num := '#' || upper(substring(encode(gen_random_bytes(3), 'hex') from 1 for 6));

  INSERT INTO public.orders (
    org_id, location_id, order_number, type, status, customer_name, customer_phone,
    customer_email, delivery_address, table_number, notes, discount_cents,
    tax_rate_basis_points, is_simulation, created_by, client_order_id
  ) VALUES (
    _org_id, _location_id, _order_num, _type, 'new', trim(_customer_name), nullif(trim(_customer_phone), ''),
    nullif(trim(_customer_email), ''), nullif(trim(_delivery_address), ''), nullif(trim(_table_number), ''),
    nullif(trim(_notes), ''), greatest(coalesce(_discount_cents, 0), 0), greatest(coalesce(_tax_rate_basis_points, 825), 0),
    coalesce(_is_simulation, false), auth.uid(), nullif(trim(_client_order_id), '')
  ) RETURNING id INTO _oid;

  FOR _item IN SELECT * FROM jsonb_array_elements(_items) LOOP
    _item_unit_price := greatest(coalesce((_item->>'unit_price_cents')::int, 0), 0);
    _item_qty := greatest(coalesce((_item->>'quantity')::int, 1), 1);
    _item_mods_total := 0;
    _product_uuid := nullif(_item->>'product_id', '')::uuid;

    IF _product_uuid IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.menu_products
        WHERE id = _product_uuid AND org_id = _org_id
      ) THEN
        RAISE EXCEPTION 'product_not_in_org';
      END IF;
    END IF;

    IF _item->'modifiers' IS NOT NULL AND jsonb_array_length(_item->'modifiers') > 0 THEN
      FOR _mod IN SELECT * FROM jsonb_array_elements(_item->'modifiers') LOOP
        _mod_opt_uuid := nullif(_mod->>'option_id', '')::uuid;
        IF _mod_opt_uuid IS NOT NULL THEN
          IF NOT EXISTS (
            SELECT 1 FROM public.modifier_options mo
            JOIN public.modifier_groups mg ON mg.id = mo.group_id
            WHERE mo.id = _mod_opt_uuid AND mg.org_id = _org_id
          ) THEN
            RAISE EXCEPTION 'modifier_not_in_org';
          END IF;
        END IF;
        _item_mods_total := _item_mods_total + greatest(coalesce((_mod->>'price_cents')::int, 0), 0);
      END LOOP;
    END IF;

    _item_total := (_item_unit_price + _item_mods_total) * _item_qty;
    _calc_subtotal := _calc_subtotal + _item_total;

    INSERT INTO public.order_items (
      order_id, product_id, product_name, unit_price_cents, quantity, subtotal_cents, notes
    ) VALUES (
      _oid, _product_uuid, coalesce(trim(_item->>'product_name'), 'Item'),
      _item_unit_price, _item_qty, _item_total, nullif(trim(_item->>'notes'), '')
    ) RETURNING id INTO _item_id;

    IF _item->'modifiers' IS NOT NULL AND jsonb_array_length(_item->'modifiers') > 0 THEN
      FOR _mod IN SELECT * FROM jsonb_array_elements(_item->'modifiers') LOOP
        INSERT INTO public.order_item_modifiers (order_item_id, option_id, group_name, option_name, price_cents)
        VALUES (_item_id, nullif(_mod->>'option_id', '')::uuid, coalesce(trim(_mod->>'group_name'), 'Modifier'),
                coalesce(trim(_mod->>'option_name'), 'Option'), greatest(coalesce((_mod->>'price_cents')::int, 0), 0));
      END LOOP;
    END IF;
  END LOOP;

  _calc_tax := round(greatest(_calc_subtotal - coalesce(_discount_cents, 0), 0) * (coalesce(_tax_rate_basis_points, 825)::numeric / 10000.0));
  _calc_total := greatest(_calc_subtotal - coalesce(_discount_cents, 0), 0) + _calc_tax;

  UPDATE public.orders
  SET subtotal_cents = _calc_subtotal, tax_cents = _calc_tax, total_cents = _calc_total
  WHERE id = _oid;

  PERFORM public.write_audit(
    _org_id,
    'orders.pos_created',
    _order_num,
    jsonb_build_object('order_id', _oid, 'total_cents', _calc_total, 'client_order_id', _client_order_id, 'simulation', _is_simulation)
  );

  RETURN _oid;
END;
$function$;

REVOKE ALL ON FUNCTION public.create_pos_sale(uuid, uuid, order_type, text, text, text, text, text, text, integer, integer, jsonb, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_pos_sale(uuid, uuid, order_type, text, text, text, text, text, text, integer, integer, jsonb, boolean, text) TO authenticated, service_role;
