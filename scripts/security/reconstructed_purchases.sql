\set ON_ERROR_STOP on
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-4000-8000-000000000001',false);
SELECT id AS inventory_id FROM public.inventory_items WHERE name='Beef' \gset
SELECT public.save_operational_record('bbbbbbbb-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','supplier','{"name":"Test supplier"}') AS supplier_id \gset
SELECT public.save_operational_record('bbbbbbbb-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000001','purchase',jsonb_build_object('supplierId',:'supplier_id','status','sent','discountCents',1000,'taxCents',1200,'shippingCents',500,'items',jsonb_build_array(jsonb_build_object('inventoryItemId',:'inventory_id','quantityOrdered',10,'unitPriceCents',1500)))) AS po_id \gset
DO $$ BEGIN IF (SELECT sum(round(i.quantity_ordered*i.unit_price_cents))-p.discount_cents+p.tax_cents+p.shipping_cents FROM public.purchase_orders p JOIN public.purchase_order_items i ON i.purchase_order_id=p.id GROUP BY p.id)<>15700 THEN RAISE EXCEPTION 'FAIL PO total'; END IF; END $$;
SELECT id AS po_item FROM public.purchase_order_items WHERE purchase_order_id=:'po_id' \gset
SELECT public.receive_operational_purchase(:'po_id',jsonb_build_array(jsonb_build_object('itemId',:'po_item','receivedNow',4,'priceVerifiedCents',1500)),'receipt1','partial');
SELECT public.receive_operational_purchase(:'po_id',jsonb_build_array(jsonb_build_object('itemId',:'po_item','receivedNow',4,'priceVerifiedCents',1500)),'receipt1','partial');
DO $$ BEGIN IF (SELECT quantity FROM public.inventory_items WHERE name='Beef')<>14 THEN RAISE EXCEPTION 'FAIL receipt duplicate'; END IF; IF (SELECT status FROM public.purchase_orders LIMIT 1)<>'partially_received' THEN RAISE EXCEPTION 'FAIL partial status'; END IF; END $$;
SELECT public.receive_operational_purchase(:'po_id',jsonb_build_array(jsonb_build_object('itemId',:'po_item','receivedNow',6,'priceVerifiedCents',1500)),'receipt2','complete');
DO $$ BEGIN IF (SELECT quantity FROM public.inventory_items WHERE name='Beef')<>20 OR (SELECT status FROM public.purchase_orders LIMIT 1)<>'received' THEN RAISE EXCEPTION 'FAIL complete receipt'; END IF; END $$;
SELECT public.record_operational_movement('bbbbbbbb-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000001',:'inventory_id','transfer',2,'transfer','transfer1','cccccccc-0000-4000-8000-000000000002');
DO $$ BEGIN IF (SELECT sum(quantity) FROM public.inventory_items WHERE name='Beef')<>20 THEN RAISE EXCEPTION 'FAIL transfer conservation'; END IF; END $$;
SELECT 'PASS: PO formula 15700, partial/complete receipt, repeat receipt, transfer conservation';
