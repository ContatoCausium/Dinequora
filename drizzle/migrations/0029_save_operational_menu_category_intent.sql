-- 0029: saving a menu category requires an explicit intent (create, update or reactivate), checked
-- inside the transaction. A save can no longer overwrite, re-activate or deactivate a category by
-- accident, whatever the client does.
--
-- Root cause (0018, kept by 0027/0028): the category branch of save_operational_menu was one upsert,
--   INSERT ... ON CONFLICT (org_id, client_id) DO UPDATE SET name, description,
--                                                          active = coalesce(payload.active, true)
-- with no way to tell a creation from an edit. Therefore:
--   - creating a category whose id already exists overwrote it (and re-activated it if archived);
--   - two concurrent creations of the same id: the second waited for the first insert, then turned
--     into an UPDATE and silently overwrote it;
--   - an edit waiting behind a concurrent archive re-activated the category it had just archived
--     (the upsert wrote active = true);
--   - "active" in the payload deactivated/re-activated through the save (0028 only refused the
--     deactivation while an active product used the category).
--
-- Contract (category kind only; products are unchanged byte for byte), payload
--   {"op": "create" | "update" | "reactivate", "id": <client id>, "name": ..., "description"?: ...}:
--   create      inserts a NEW active category. If the id exists: category_exists (active) or
--               category_archived (archived). Nothing is overwritten, nothing is re-activated.
--   update      renames / re-describes an ACTIVE category; its active flag is never touched.
--               Unknown id: not_found. Archived: category_archived (reactivate it first).
--   reactivate  re-activates an ARCHIVED category (explicit, owner-only, audited); name and
--               description are not changed. Unknown id: not_found. Already active:
--               category_not_archived.
--   Without "op", with another "op", or with an "active" key: invalid_menu (strict contract: there is
--   no implicit behaviour left). Deactivation exists only through archive_operational_menu (0026),
--   which keeps its category_in_use rule.
-- Every refusal raises before anything is written (one statement-level transaction: no partial
-- change) and before the audit row, so a refused call is never audited. A successful call writes
-- one menu.saved row whose metadata now carries the intent: {"kind": "category", "op": ...}.
-- Product saves keep {"kind": "product"} (jsonb_strip_nulls).
-- Order of checks unchanged: membership (forbidden), permission (menu.edit, permission_denied for
-- staff), organization operational, id/name length (invalid_menu), owner-only (forbidden), then
-- the intent.
--
-- Concurrency (READ COMMITTED):
--   create x create (same id): the second INSERT ... ON CONFLICT DO NOTHING waits for the first;
--     first commits -> the second inserts nothing and is refused with category_exists; first
--     rolls back -> the second creates the category. Exactly one creation, never an overwrite.
--   create x archived id: refused with category_archived (no lock needed: the row is committed).
--   create x an archive/edit of the same id still in progress: the INSERT waits for that
--     transaction (the existing row is being updated), then is refused with category_archived or
--     category_exists according to the committed state. Never an overwrite or a re-activation.
--   update/reactivate lock the category row FOR UPDATE, like the archive (0026) and 0028:
--     update x archive: whichever locks first wins; an update that waited re-reads the row
--     (EvalPlanQual) and, if it was archived, is refused with category_archived;
--     update x reactivate: serialized; the update succeeds only once the category is active;
--     update x product save: the update waits for the product save's FOR SHARE read (0027) and
--     vice versa; neither changes the other's outcome.
-- Lock order: a category save locks at most its own category row and reads no product; a product
-- save locks its product row, then reads the category FOR SHARE; the archive locks the category,
-- then reads products without locking them. No path holds a category lock while waiting for a
-- product lock: no deadlock cycle. No table-level or wider lock is taken.
--
-- Safe rollout: the new client sends "op"; the 0028 function ignores unknown payload keys, so the
-- new client also works against 0028 (create/update/reactivate all reach the old upsert). Update
-- every application build first, then apply 0029. An older build (no "op") gets invalid_menu for
-- category saves (products, archive and reads are unaffected) until it is updated. Rollback: a new
-- forward migration restating the 0028 function; the new client keeps working with it.
--
-- Same signature, SECURITY DEFINER, search_path, permission checks, tenant filters and grants. The
-- new lines use "_" variables and qualified columns (migration policy); the rest keeps its
-- 0018/0027/0028 names on purpose.

CREATE OR REPLACE FUNCTION public.save_operational_menu(_org_id uuid, _kind text, _payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ DECLARE id0 uuid; cid uuid; locs uuid[]; oldlocs uuid[]; g jsonb; o jsonb; _op text; _cat_id uuid; _cat_active boolean; BEGIN
IF auth.uid() IS NULL OR NOT public.is_org_member(_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF; PERFORM public.assert_permission(_org_id, CASE WHEN _kind='product' AND NOT EXISTS(SELECT 1 FROM public.menu_products WHERE org_id=_org_id AND client_id=_payload->>'id') THEN 'menu.create' ELSE 'menu.edit' END); PERFORM public.assert_org_operational(_org_id);
IF length(coalesce(_payload->>'name','')) NOT BETWEEN 1 AND 160 OR length(coalesce(_payload->>'id','')) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'invalid_menu'; END IF;
IF _kind='category' THEN IF NOT public.is_org_owner(_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
_op := _payload->>'op';
IF _op IS NULL OR _op NOT IN ('create','update','reactivate') OR (_payload->'active') IS NOT NULL THEN RAISE EXCEPTION 'invalid_menu'; END IF;
IF _op='create' THEN
  INSERT INTO public.menu_categories(org_id,client_id,name,description,active) VALUES(_org_id,_payload->>'id',_payload->>'name',coalesce(_payload->>'description',''),true) ON CONFLICT(org_id,client_id) DO NOTHING RETURNING id INTO id0;
  IF id0 IS NULL THEN
    SELECT mc.active INTO _cat_active FROM public.menu_categories mc WHERE mc.org_id=_org_id AND mc.client_id=_payload->>'id';
    IF coalesce(_cat_active,true) THEN RAISE EXCEPTION 'category_exists'; END IF; RAISE EXCEPTION 'category_archived';
  END IF;
ELSE
  SELECT mc.id, mc.active INTO _cat_id, _cat_active FROM public.menu_categories mc WHERE mc.org_id=_org_id AND mc.client_id=_payload->>'id' FOR UPDATE OF mc;
  IF _cat_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
  IF _op='update' THEN
    IF NOT _cat_active THEN RAISE EXCEPTION 'category_archived'; END IF;
    UPDATE public.menu_categories mc SET name=_payload->>'name', description=coalesce(_payload->>'description','') WHERE mc.id=_cat_id;
  ELSE
    IF _cat_active THEN RAISE EXCEPTION 'category_not_archived'; END IF;
    UPDATE public.menu_categories mc SET active=true WHERE mc.id=_cat_id;
  END IF;
  id0 := _cat_id;
END IF;
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
ELSE RAISE EXCEPTION 'invalid_kind'; END IF; PERFORM public.write_audit(_org_id,'menu.saved',id0::text,jsonb_strip_nulls(jsonb_build_object('kind',_kind,'op',_op))); RETURN id0; END $function$;

-- Unchanged grants (CREATE OR REPLACE keeps them; restated so the migration is self-describing).
REVOKE ALL ON FUNCTION public.save_operational_menu(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_operational_menu(uuid, text, jsonb) TO authenticated;
