\set ON_ERROR_STOP on
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','aaaaaaaa-0000-4000-8000-000000000001',false);
SELECT id AS inv_id FROM public.inventory_items WHERE location_id='cccccccc-0000-4000-8000-000000000001' AND name='Beef' \gset
SELECT public.record_operational_movement('bbbbbbbb-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000001',:'inv_id','in',1,'repeat','move-repeat');
SELECT public.record_operational_movement('bbbbbbbb-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000001',:'inv_id','in',1,'repeat','move-repeat');
DO $$ BEGIN
 BEGIN PERFORM public.record_operational_movement('bbbbbbbb-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000001',(SELECT id FROM public.inventory_items WHERE location_id='cccccccc-0000-4000-8000-000000000001' AND name='Beef'),'in',2,'repeat','move-repeat'); RAISE EXCEPTION 'FAIL movement replay conflict'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'idempotency_conflict' THEN RAISE; END IF; END;
 IF (SELECT count(*) FROM public.inventory_movements WHERE client_event_id='move-repeat')<>1 THEN RAISE EXCEPTION 'FAIL movement duplicate'; END IF;
 BEGIN PERFORM public.save_operational_record('bbbbbbbb-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','whatsapp','{"kind":"contact","consentGranted":false}'); RAISE EXCEPTION 'FAIL missing consent'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'consent_required' THEN RAISE; END IF; END;
 BEGIN PERFORM public.save_operational_record('bbbbbbbb-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','whatsapp','{"kind":"message","status":"sent"}'); RAISE EXCEPTION 'FAIL fake delivery'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'provider_unavailable' THEN RAISE; END IF; END;
END $$;
SELECT set_config('request.jwt.claim.sub','',false);
DO $$ BEGIN BEGIN PERFORM public.create_pos_sale('bbbbbbbb-0000-4000-8000-000000000001','cccccccc-0000-4000-8000-000000000001','dine_in','none',_client_order_id=>'no-auth'); RAISE EXCEPTION 'FAIL missing auth'; EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE; END IF; END; END $$;
RESET ROLE;
SELECT 'PASS: movement idempotence/conflict, consent enforcement, fake delivery denial, missing auth';
