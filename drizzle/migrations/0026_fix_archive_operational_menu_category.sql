-- 0026: archiving a menu category works again.
--
-- Since 0013 (and kept by 0018), archive_operational_menu declared a PL/pgSQL variable named "p"
-- (DECLARE p public.menu_products) and, in the category branch, ran a subquery that aliases
-- public.menu_products as "p" too:
--   SELECT 1 FROM public.menu_products p JOIN public.menu_categories c ON c.id=p.category_id ...
-- PL/pgSQL cannot tell the variable from the alias, so every category archive failed with
--   column reference "p.category_id" is ambiguous (42702)
-- and the Menu screen could not delete a category. The product branch was not affected.
--
-- Same signature, SECURITY DEFINER, search_path, grants, permission checks (member, menu.delete,
-- organization operational, owner-only for categories, store scope for products), tenant filters
-- and audit row (menu.archived) as 0018. Changes:
--   - the variable is renamed to _product and every column in the queries is qualified, so no
--     name can be read as both a variable and a column or alias;
--   - a category that does not exist in the caller's organization is refused with not_found and
--     nothing is written. Before, the UPDATE matched no row and a menu.archived audit row was still
--     recorded for a category that was never archived (the product branch already refused a
--     missing product).
-- Archiving a category that is already archived still succeeds without changing it (same as a
-- product), and a category with an active product is still refused with category_in_use.
-- Products are never modified by a category archive.

CREATE OR REPLACE FUNCTION public.archive_operational_menu(_org_id uuid, _kind text, _client_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _product public.menu_products;
  _category_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_org_member(_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
  PERFORM public.assert_permission(_org_id, 'menu.delete');
  PERFORM public.assert_org_operational(_org_id);
  IF _kind = 'category' THEN
    IF NOT public.is_org_owner(_org_id) THEN RAISE EXCEPTION 'forbidden'; END IF;
    SELECT mc.id INTO _category_id FROM public.menu_categories mc
     WHERE mc.org_id = _org_id AND mc.client_id = _client_id FOR UPDATE;
    IF _category_id IS NULL THEN RAISE EXCEPTION 'not_found'; END IF;
    IF EXISTS (SELECT 1 FROM public.menu_products mp
                WHERE mp.org_id = _org_id AND mp.category_id = _category_id AND mp.active) THEN
      RAISE EXCEPTION 'category_in_use';
    END IF;
    UPDATE public.menu_categories mc SET active = false WHERE mc.id = _category_id;
  ELSIF _kind = 'product' THEN
    SELECT * INTO _product FROM public.menu_products mp
     WHERE mp.org_id = _org_id AND mp.client_id = _client_id FOR UPDATE;
    IF _product.id IS NULL OR (NOT public.is_org_owner(_org_id) AND (cardinality(_product.location_ids) = 0
       OR EXISTS (SELECT 1 FROM unnest(_product.location_ids) AS loc(id) WHERE NOT public.can_operate_location(loc.id)))) THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
    UPDATE public.menu_products mp SET active = false, updated_at = now() WHERE mp.id = _product.id;
  ELSE
    RAISE EXCEPTION 'invalid_kind';
  END IF;
  PERFORM public.write_audit(_org_id, 'menu.archived', _client_id, jsonb_build_object('kind', _kind));
END $function$;

-- Unchanged grants (CREATE OR REPLACE keeps them; restated so the migration is self-describing).
REVOKE ALL ON FUNCTION public.archive_operational_menu(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.archive_operational_menu(uuid, text, text) TO authenticated;
