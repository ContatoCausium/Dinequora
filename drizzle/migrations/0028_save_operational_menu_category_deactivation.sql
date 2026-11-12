-- 0028: saving a category can no longer deactivate it while it still has active products (issue #18).
--
-- The category branch of save_operational_menu (0018, kept by 0027) upserted the category with
-- active = coalesce(payload.active, true) and no check, so an owner calling the RPC directly with
-- {"active": false} deactivated a category that active products still use. That bypassed the
-- category_in_use rule of archive_operational_menu (0026) and the invariant "no active product in an
-- inactive category" that 0027 protects against concurrency (the menu then lists active products
-- whose category is not listed). The Menu screen never sends "active" for a category (its server
-- function only forwards id, name and description), so this was reachable only through a direct call.
--
-- Change, in the category branch only (still owner-only, checked before anything else):
--   1. the existing category row, if any, is locked FOR UPDATE (the same lock as the archive), which
--      conflicts with the FOR SHARE read of a product save (0027);
--   2. if the category would end up INACTIVE (payload "active" false) while an active product of
--      this organization uses it, the save is refused with category_in_use and nothing is written
--      (no category change, no audit row);
--   3. otherwise the upsert runs exactly as before: deactivating a category with no active product
--      (none at all, or only inactive ones) is allowed, re-saving with "active" omitted or true
--      re-activates it, renaming works as before.
-- Concurrency with a product save into the same category:
--   - product save first: the deactivation waits for its FOR SHARE, then (new statement, fresh
--     snapshot) sees the committed active product and refuses with category_in_use;
--   - deactivation first: the product save waits at its FOR SHARE read; when the deactivation
--     commits, the row is re-read under READ COMMITTED, it is inactive, and the save refuses with
--     category_required (or proceeds if the deactivation rolled back).
-- Lock order: a category save locks only its category row (it reads products without locking
-- them); a product save locks its product row, then the category; the archive locks the category.
-- No path locks a category and then waits for a product, so there is no deadlock cycle.
--
-- Everything else of the function is byte-for-byte the body of 0027 (same signature, SECURITY
-- DEFINER, search_path, permission checks, tenant filters, product branch with its FOR SHARE read,
-- audit row) and the grants are restated unchanged. The new lines qualify every column (migration
-- policy); the rest keeps its 0018/0027 names on purpose.

CREATE OR REPLACE FUNCTION public.save_operational_menu(_org_id uuid, _kind text, _payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ DECLARE id0 uuid; cid uuid; locs uuid[]; oldlocs uuid[]; g jsonb; o jsonb; BEGIN
IF auth.uid() IS NULL OR NOT public.is_org_member(_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF; PERFORM public.assert_permission(_org_id, CASE WHEN _kind='product' AND NOT EXISTS(SELECT 1 FROM public.menu_products WHERE org_id=_org_id AND client_id=_payload->>'id') THEN 'menu.create' ELSE 'menu.edit' END); PERFORM public.assert_org_operational(_org_id);
IF length(coalesce(_payload->>'name','')) NOT BETWEEN 1 AND 160 OR length(coalesce(_payload->>'id','')) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_menu'; END IF;
IF _kind='category' THEN IF NOT public.is_org_owner(_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
PERFORM 1 FROM public.menu_categories mc WHERE mc.org_id=_org_id AND mc.client_id=_payload->>'id' FOR UPDATE OF mc;
IF NOT coalesce((_payload->>'active')::boolean,true) AND EXISTS(SELECT 1 FROM public.menu_categories mc JOIN public.menu_products mp ON mp.org_id=mc.org_id AND mp.category_id=mc.id WHERE mc.org_id=_org_id AND mc.client_id=_payload->>'id' AND mp.active) THEN RAISE EXCEPTION 'category_in_use'; END IF;
INSERT INTO public.menu_categories(org_id,client_id,name,description,active) VALUES(_org_id,_payload->>'id',_payload->>'name',coalesce(_payload->>'description',''),coalesce((_payload->>'active')::boolean,true)) ON CONFLICT(org_id,client_id) DO UPDATE SET name=EXCLUDED.name,description=EXCLUDED.description,active=EXCLUDED.active RETURNING id INTO id0;
ELSIF _kind='product' THEN
SELECT coalesce(array_agg(value::uuid),'{}') INTO locs FROM jsonb_array_elements_text(coalesce(_payload->'locationIds','[]'));
IF EXISTS(SELECT 1 FROM unnest(locs) x WHERE NOT EXISTS(SELECT 1 FROM public.locations WHERE id=x AND org_id=_org_id) OR NOT public.can_operate_location(x)) THEN RAISE EXCEPTION 'forbidden'; END IF;
IF cardinality(locs)=0 AND NOT public.is_org_owner(_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
SELECT location_ids INTO oldlocs FROM public.menu_products WHERE org_id=_org_id AND client_id=_payload->>'id' FOR UPDATE;
IF oldlocs IS NOT NULL AND NOT public.is_org_owner(_org_id) AND (cardinality(oldlocs)=0 OR EXISTS(SELECT 1 FROM unnest(oldlocs) x WHERE NOT public.can_operate_location(x))) THEN RAISE EXCEPTION 'forbidden'; END IF;
SELECT mc.id INTO cid FROM public.menu_categories mc WHERE mc.org_id=_org_id AND mc.client_id=_payload->>'category' AND mc.active FOR SHARE OF mc; IF cid IS NULL THEN RAISE EXCEPTION 'category_required'; END IF;
IF jsonb_typeof(coalesce(_payload->'modifierGroups','[]'))<>'array' THEN RAISE EXCEPTION 'invalid_modifiers'; END IF;
IF EXISTS(SELECT 1 FROM jsonb_array_elements(coalesce(_payload->'modifierGroups','[]')) AS groups(value) GROUP BY groups.value->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'duplicate_modifier_group'; END IF; FOR g IN SELECT * FROM jsonb_array_elements(coalesce(_payload->'modifierGroups','[]')) LOOP
IF coalesce(g->>'id','')='' OR coalesce((g->>'minSelections')::int,0)<0 OR coalesce((g->>'maxSelections')::int,1)<greatest(coalesce((g->>'minSelections')::int,0),CASE WHEN coalesce((g->>'required')::boolean,false) THEN 1 ELSE 0 END) THEN RAISE EXCEPTION 'invalid_modifiers'; END IF;
IF jsonb_typeof(g->'options') IS DISTINCT FROM 'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(g->'options') AS options(value) GROUP BY options.value->>'id' HAVING count(*)>1) THEN RAISE EXCEPTION 'duplicate_modifier_option'; END IF; FOR o IN SELECT * FROM jsonb_array_elements(g->'options') LOOP IF coalesce(o->>'id','')='' OR o->>'priceCents' IS NULL OR (o->>'priceCents')::int<0 THEN RAISE EXCEPTION 'invalid_modifiers'; END IF; END LOOP; END LOOP;
INSERT INTO public.menu_products(org_id,client_id,category_id,name,description,price_cents,prep_time_minutes,image_url,notes,active,location_ids,modifier_groups) VALUES(_org_id,_payload->>'id',cid,_payload->>'name',coalesce(_payload->>'description',''),(_payload->>'priceCents')::int,coalesce((_payload->>'prepTimeMinutes')::int,10),_payload->>'imageUrl',_payload->>'notes',coalesce((_payload->>'active')::boolean,true),locs,coalesce(_payload->'modifierGroups','[]')) ON CONFLICT(org_id,client_id) DO UPDATE SET category_id=EXCLUDED.category_id,name=EXCLUDED.name,description=EXCLUDED.description,price_cents=EXCLUDED.price_cents,prep_time_minutes=EXCLUDED.prep_time_minutes,image_url=EXCLUDED.image_url,notes=EXCLUDED.notes,active=EXCLUDED.active,location_ids=EXCLUDED.location_ids,modifier_groups=EXCLUDED.modifier_groups,updated_at=now() RETURNING id INTO id0;
ELSE RAISE EXCEPTION 'invalid_kind'; END IF; PERFORM public.write_audit(_org_id,'menu.saved',id0::text,jsonb_build_object('kind',_kind)); RETURN id0; END $function$;

-- Unchanged grants (CREATE OR REPLACE keeps them; restated so the migration is self-describing).
REVOKE ALL ON FUNCTION public.save_operational_menu(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_operational_menu(uuid, text, jsonb) TO authenticated;
