ALTER TABLE public.inventory_movements ADD COLUMN request_hash text;
-- Verify identical replays before accepting an inventory event key.
DO $hardening$
DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('public.record_operational_movement(uuid,uuid,uuid,text,numeric,text,text,uuid)'::regprocedure);
 definition:=replace(definition,'d numeric; mid uuid; BEGIN','d numeric; mid uuid; fingerprint text; BEGIN');
 definition:=replace(definition,'PERFORM pg_advisory_xact_lock','fingerprint:=md5(jsonb_build_object(''org'',_org_id,''location'',_location_id,''item'',_item_id,''type'',_type,''quantity'',_quantity,''reason'',_reason,''target'',_target_location_id)::text); PERFORM pg_advisory_xact_lock');
 definition:=replace(definition,'IF prior.reason<>_reason THEN','IF prior.request_hash IS DISTINCT FROM fingerprint THEN');
 definition:=replace(definition,',_reason,auth.uid()) RETURNING id INTO mid;',',_reason,auth.uid()) RETURNING id INTO mid; UPDATE public.inventory_movements SET request_hash=fingerprint WHERE id=mid;');
 EXECUTE definition;
END $hardening$;
-- Never expose raw cross-store group scopes to restricted menu readers.
-- Embedded modifiers remain product-owned JSON, validated at save and checked against server prices on sale.
DO $menu_validation$
DECLARE definition text;
BEGIN
 definition:=pg_get_functiondef('public.save_operational_menu(uuid,text,jsonb)'::regprocedure);
 definition:=replace(definition,'FOR g IN SELECT * FROM jsonb_array_elements(coalesce(_payload->''modifierGroups'',''[]'')) LOOP',
 'IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(_payload->''modifierGroups'',''[]'')) AS groups(value) GROUP BY groups.value->>''id'' HAVING count(*)>1) THEN RAISE EXCEPTION ''duplicate_modifier_group''; END IF; FOR g IN SELECT * FROM jsonb_array_elements(coalesce(_payload->''modifierGroups'',''[]'')) LOOP');
 definition:=replace(definition,'FOR o IN SELECT * FROM jsonb_array_elements(g->''options'') LOOP',
 'IF jsonb_typeof(g->''options'') IS DISTINCT FROM ''array'' OR EXISTS(SELECT 1 FROM jsonb_array_elements(g->''options'') AS options(value) GROUP BY options.value->>''id'' HAVING count(*)>1) THEN RAISE EXCEPTION ''duplicate_modifier_option''; END IF; FOR o IN SELECT * FROM jsonb_array_elements(g->''options'') LOOP');
 definition:=replace(definition,'OR (o->>''priceCents'')::int<0','OR o->>''priceCents'' IS NULL OR (o->>''priceCents'')::int<0');
 EXECUTE definition;
END $menu_validation$;