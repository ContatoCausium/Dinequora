-- 0027: saving a product can no longer put it, active, into a category that is being archived
-- (issue #15).
--
-- save_operational_menu (0018) read the product's category with
--   SELECT id INTO cid FROM public.menu_categories WHERE org_id=... AND client_id=... AND active;
-- without a lock. archive_operational_menu (0026) locks the category FOR UPDATE, checks that no
-- active product uses it and sets active=false. With the two running concurrently:
--   save reads the category (active) -> archive locks it, finds no active product, archives it and
--   commits -> save inserts the product; its foreign-key check (FOR KEY SHARE on the category) only
--   waits for the archive and then passes, because the archived row still exists
-- leaving an ACTIVE product in an ARCHIVED category (the menu then lists the product without its
-- category, and the category_in_use rule is bypassed).
--
-- Change: that one read takes FOR SHARE on the category row (FOR SHARE conflicts with the
-- archive's FOR UPDATE; two saves into the same category still share it):
--   - save first: the archive waits until the save commits, then sees the active product and
--     refuses with category_in_use (or archives normally if the save rolled back);
--   - archive first: the save waits until the archive ends; under READ COMMITTED the locked row is
--     re-read, "active" is now false, no row qualifies and the save refuses with category_required
--     (or proceeds normally if the archive rolled back).
-- Lock order (no new deadlock): save locks [its own product row FOR UPDATE, when it exists] then
-- [the category row FOR SHARE]; archive locks only [the category row FOR UPDATE] and never locks a
-- product row; saving a category locks only its category row. With a single contended row per
-- pair there is no cycle.
--
-- Everything else of the function is byte-for-byte the body of 0018 (same signature, SECURITY
-- DEFINER, search_path, permission checks, tenant filters, audit row and grants); the changed read
-- qualifies its columns (migration policy). The rest of the body keeps its 0018 names on purpose:
-- none of them is ambiguous and rewriting the whole function is out of scope.

CREATE OR REPLACE FUNCTION public.save_operational_menu(_org_id uuid, _kind text, _payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ DECLARE id0 uuid; cid uuid; locs uuid[]; oldlocs uuid[]; g jsonb; o jsonb; BEGIN
IF auth.uid() IS NULL OR NOT public.is_org_member(_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF; PERFORM public.assert_permission(_org_id, CASE WHEN _kind='product' AND NOT EXISTS(SELECT 1 FROM public.menu_products WHERE org_id=_org_id AND client_id=_payload->>'id') THEN 'menu.create' ELSE 'menu.edit' END); PERFORM public.assert_org_operational(_org_id);
IF length(coalesce(_payload->>'name','')) NOT BETWEEN 1 AND 160 OR length(coalesce(_payload->>'id','')) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_menu'; END IF;
IF _kind='category' THEN IF NOT public.is_org_owner(_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
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
