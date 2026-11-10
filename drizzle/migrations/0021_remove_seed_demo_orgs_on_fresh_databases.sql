-- 0021: keep fictional organizations out of brand-new databases, without ever discarding data.
--
-- 0000_auth_orgs_memberships inserts two demonstration organizations (MARAO BURGERS, Harbor Taco
-- Co.) and 0001/0003 flag and configure them, so every new database (including a future production
-- database) starts with fictional tenants. Historical migrations are immutable; this additive
-- migration removes a seed organization ONLY when it is provably untouched. Policy: anything that
-- is not exactly the original seed is treated as legitimate data and the organization is KEPT.
--
-- A seed organization is removed only if ALL of the following hold:
--   1. the database has no auth.users row at all (otherwise the whole migration is a no-op);
--   2. the organization row equals the original seed in EVERY column except id and created_at
--      (an unknown or changed column means "keep");
--   3. its stores are exactly the original seed stores: same set, every column except id, org_id,
--      created_at and updated_at unchanged, and no store updated after creation;
--   4. it has exactly one subscription, equal to the original in every column except org_id and
--      updated_at (plan, status, billed stores, trial/grace/cancel dates, billing periods, Stripe ids);
--   5. no row in any table of the public or storage schemas mentions the organization or its stores
--      (id or slug) in any uuid, text, varchar, char, json or jsonb column, other than the seed rows
--      themselves. The scan is driven by the catalog, so it covers CASCADE, SET NULL and NO ACTION
--      references, tables without a foreign key and tables added later: members, invitations,
--      permission profiles, store access, billing events, Stripe webhook events, audit logs and
--      every operational table.
-- Any check that fails, and any error while checking, keeps the organization and raises a NOTICE
-- with the reason. Because of check 5, the delete can only cascade to the seed's own stores and
-- subscription, and no audit row is ever detached from its organization; a post-condition verifies
-- this and undoes the delete otherwise.
--
-- Demonstration environments recreate both organizations with scripts/seeds/demo/seed-demo-orgs.sql.
DO $$
DECLARE
  seeds constant jsonb := $json$[
    {"slug": "org_harbor",
     "organization": {"slug": "org_harbor", "name": "Harbor Taco Co.", "brand_primary": "#16707a",
                      "brand_accent": "#e8b64c", "created_by": null, "status": "active",
                      "plan": "starter", "store_limit": 3, "suspended_reason": null, "is_demo": true,
                      "store_limit_override": 3, "logo_url": null, "previous_brand": null,
                      "company_name": "", "company_address": "", "onboarding_step": 5},
     "locations": [
       {"slug": "loc_harbor_1", "name": "Harbor Taco · Demo Store", "address": null, "phone": null,
        "timezone": "America/New_York", "status": "active", "hours": {}, "is_verified": false}],
     "subscription": {"plan_id": "starter", "status": "active", "billed_locations": 1,
                      "trial_ends_at": null, "current_period_start": null, "current_period_end": null,
                      "grace_ends_at": null, "cancel_at_period_end": false, "canceled_at": null,
                      "stripe_customer_id": null, "stripe_subscription_id": null}},
    {"slug": "org_marao",
     "organization": {"slug": "org_marao", "name": "MARAO BURGERS", "brand_primary": "#d63c46",
                      "brand_accent": "#f2a43a", "created_by": null, "status": "active",
                      "plan": "starter", "store_limit": 3, "suspended_reason": null, "is_demo": true,
                      "store_limit_override": 3, "logo_url": null, "previous_brand": null,
                      "company_name": "", "company_address": "", "onboarding_step": 5},
     "locations": [
       {"slug": "loc_marao_2", "name": "Location 2", "address": null, "phone": null,
        "timezone": "America/New_York", "status": "placeholder", "hours": {}, "is_verified": false},
       {"slug": "loc_marao_3", "name": "Location 3", "address": null, "phone": null,
        "timezone": "America/New_York", "status": "placeholder", "hours": {}, "is_verified": false},
       {"slug": "loc_marao_framingham", "name": "MARAO Framingham",
        "address": "61 Hollis St, Framingham, MA 01702", "phone": null,
        "timezone": "America/New_York", "status": "active", "hours": {}, "is_verified": true}],
     "subscription": {"plan_id": "starter", "status": "active", "billed_locations": 3,
                      "trial_ends_at": null, "current_period_start": null, "current_period_end": null,
                      "grace_ends_at": null, "cancel_at_period_end": false, "canceled_at": null,
                      "stripe_customer_id": null, "stripe_subscription_id": null}}
  ]$json$;
  s jsonb;
  org public.organizations;
  loc_ids uuid[];
  patterns text[];
  col record;
  hits bigint;
  refs text;
  reason text;
  removed int := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users) THEN
    RAISE NOTICE '0021: seed demo organizations kept: the database already has users';
    RETURN;
  END IF;

  FOR s IN SELECT value FROM jsonb_array_elements(seeds) LOOP
    BEGIN
      reason := NULL;
      refs := NULL;

      SELECT * INTO org FROM public.organizations WHERE slug = s->>'slug' FOR UPDATE;
      IF NOT FOUND THEN
        RAISE NOTICE '0021: organization % not present: nothing to do', s->>'slug';
        CONTINUE;
      END IF;

      -- 2. organization identical to the original seed
      IF (to_jsonb(org) - 'id' - 'created_at') IS DISTINCT FROM s->'organization' THEN
        reason := 'the organization differs from the original seed';
      -- 3. exactly the original stores, unchanged and never updated
      ELSIF (SELECT coalesce(jsonb_agg(to_jsonb(l) - 'id' - 'org_id' - 'created_at' - 'updated_at'
                                       ORDER BY l.slug), '[]'::jsonb)
               FROM public.locations l WHERE l.org_id = org.id) IS DISTINCT FROM s->'locations' THEN
        reason := 'its stores differ from the original seed (added, removed or edited)';
      ELSIF EXISTS (SELECT 1 FROM public.locations l
                     WHERE l.org_id = org.id AND l.updated_at IS DISTINCT FROM l.created_at) THEN
        reason := 'a store was updated after it was created';
      -- 4. exactly the original subscription
      ELSIF (SELECT coalesce(jsonb_agg(to_jsonb(x) - 'org_id' - 'updated_at'), '[]'::jsonb)
               FROM public.subscriptions x WHERE x.org_id = org.id)
            IS DISTINCT FROM jsonb_build_array(s->'subscription') THEN
        reason := 'its subscription differs from the original seed';
      END IF;

      -- 5. nothing else mentions the organization or its stores
      IF reason IS NULL THEN
        SELECT coalesce(array_agg(l.id), '{}') INTO loc_ids FROM public.locations l WHERE l.org_id = org.id;
        SELECT array_agg('%' || tok || '%') INTO patterns
          FROM (SELECT org.id::text AS tok UNION ALL SELECT org.slug
                UNION ALL SELECT l.id::text FROM public.locations l WHERE l.org_id = org.id
                UNION ALL SELECT l.slug FROM public.locations l WHERE l.org_id = org.id) t;
        FOR col IN
          SELECT n.nspname AS sch, c.relname AS tbl, a.attname AS att
            FROM pg_attribute a
            JOIN pg_class c ON c.oid = a.attrelid
            JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname IN ('public', 'storage') AND c.relkind IN ('r', 'p')
             AND a.attnum > 0 AND NOT a.attisdropped
             AND a.atttypid IN ('uuid'::regtype, 'uuid[]'::regtype, 'text'::regtype, 'text[]'::regtype,
                                'varchar'::regtype, 'bpchar'::regtype, 'json'::regtype, 'jsonb'::regtype)
           ORDER BY 1, 2, 3
        LOOP
          EXECUTE format(
            'SELECT count(*) FROM %I.%I x WHERE x.%I::text LIKE ANY ($1) AND NOT (%s)',
            col.sch, col.tbl, col.att,
            CASE WHEN col.sch = 'public' AND col.tbl = 'organizations' THEN 'x.id = $2'
                 WHEN col.sch = 'public' AND col.tbl = 'locations' THEN 'x.id = ANY ($3)'
                 WHEN col.sch = 'public' AND col.tbl = 'subscriptions' THEN 'x.org_id = $2'
                 ELSE 'false' END)
          INTO hits USING patterns, org.id, loc_ids;
          IF hits > 0 THEN
            refs := concat_ws(', ', refs, format('%s.%s.%s (%s)', col.sch, col.tbl, col.att, hits));
          END IF;
        END LOOP;
        IF refs IS NOT NULL THEN
          reason := 'other data references it: ' || refs;
        END IF;
      END IF;

      IF reason IS NOT NULL THEN
        RAISE NOTICE '0021: organization % kept: %', org.slug, reason;
        CONTINUE;
      END IF;

      DELETE FROM public.organizations WHERE id = org.id;
      IF EXISTS (SELECT 1 FROM public.locations WHERE id = ANY (loc_ids) OR org_id = org.id)
         OR EXISTS (SELECT 1 FROM public.subscriptions WHERE org_id = org.id) THEN
        RAISE EXCEPTION 'post-condition failed: seed rows survived the delete';
      END IF;
      removed := removed + 1;
      RAISE NOTICE '0021: seed demo organization % removed from a fresh database (% stores, 1 subscription)',
        org.slug, cardinality(loc_ids);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '0021: organization % kept: the seed could not be verified safely (%)',
        s->>'slug', SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE '0021: % seed demo organization(s) removed', removed;
END $$;
