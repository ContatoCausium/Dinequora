\set ON_ERROR_STOP on
-- Demo reconstruction check (disposable QA/CI database only).
--
-- Runs after scripts/seeds/demo/seed-demo-orgs.sql has been applied twice to a database where
-- migration 0021 removed the 0000 seeds. The expected state is the commercial demo as read on
-- 2026-11-09 (identical to the original 0000-0020 seed). The check fails when:
--   1. the demonstration organizations are not exactly org_harbor and org_marao (an extra or a
--      missing is_demo organization fails);
--   2. either organization differs from the expected row in ANY column except id and created_at;
--   3. the stores of either organization are not exactly the expected stores, compared in every
--      column except id, org_id, created_at and updated_at (added, missing, moved or edited stores);
--   4. either organization does not have exactly one subscription equal to the expected one in every
--      column except org_id and updated_at (plan, status, billed stores, trial/grace/cancel dates,
--      billing periods and Stripe ids included);
--   5. any row in any table of the public or storage schemas, other than these organization, store
--      and subscription rows, mentions either organization or any of its stores (id or slug) in a
--      uuid, text, varchar, char, json or jsonb column. This covers members, invitations, permission
--      profiles, store access, billing events, Stripe webhook events, audit logs and every
--      operational table, including tables added later.
-- Not compared, by design: ids and created_at/updated_at timestamps, which differ on every rebuild.
-- Running the seed twice and passing checks 1-4 proves the seed does not duplicate rows.
DO $$
DECLARE
  expected constant jsonb := $json$[
    {"slug": "org_harbor",
     "organization": {"slug": "org_harbor", "name": "Harbor Taco Co.", "brand_primary": "#16707a",
                      "brand_accent": "#e8b64c", "created_by": null, "status": "active",
                      "plan": "starter", "store_limit": 3, "suspended_reason": null, "is_demo": true,
                      "store_limit_override": 3, "logo_url": null, "previous_brand": null,
                      "company_name": "", "company_address": "", "onboarding_step": 5},
     "locations": [
       {"slug": "loc_harbor_1", "name": "Harbor Taco · Demo Store", "address": null, "phone": null,
        "timezone": "America/New_York", "status": "active", "hours": {}, "is_verified": false,
        "tax_rate_ppm": null}],
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
        "timezone": "America/New_York", "status": "placeholder", "hours": {}, "is_verified": false,
        "tax_rate_ppm": null},
       {"slug": "loc_marao_3", "name": "Location 3", "address": null, "phone": null,
        "timezone": "America/New_York", "status": "placeholder", "hours": {}, "is_verified": false,
        "tax_rate_ppm": null},
       {"slug": "loc_marao_framingham", "name": "MARAO Framingham",
        "address": "61 Hollis St, Framingham, MA 01702", "phone": null,
        "timezone": "America/New_York", "status": "active", "hours": {}, "is_verified": true,
        "tax_rate_ppm": null}],
     "subscription": {"plan_id": "starter", "status": "active", "billed_locations": 3,
                      "trial_ends_at": null, "current_period_start": null, "current_period_end": null,
                      "grace_ends_at": null, "cancel_at_period_end": false, "canceled_at": null,
                      "stripe_customer_id": null, "stripe_subscription_id": null}}
  ]$json$;
  e jsonb;
  org public.organizations;
  loc_ids uuid[];
  patterns text[];
  col record;
  hits bigint;
  refs text;
  demo_slugs text;
BEGIN
  -- 1. exactly the two demonstration organizations
  SELECT coalesce(string_agg(slug, ',' ORDER BY slug), '') INTO demo_slugs
    FROM public.organizations WHERE is_demo;
  IF demo_slugs <> 'org_harbor,org_marao' THEN
    RAISE EXCEPTION 'FAIL demo organizations: expected exactly org_harbor,org_marao, found "%"', demo_slugs;
  END IF;

  FOR e IN SELECT value FROM jsonb_array_elements(expected) LOOP
    SELECT * INTO org FROM public.organizations WHERE slug = e->>'slug';
    -- 2. organization, every column except id/created_at
    IF (to_jsonb(org) - 'id' - 'created_at') IS DISTINCT FROM e->'organization' THEN
      RAISE EXCEPTION 'FAIL demo organizations: % differs from the expected demo row', e->>'slug';
    END IF;
    -- 3. stores, every column except id/org_id/created_at/updated_at; exact set
    IF (SELECT coalesce(jsonb_agg(to_jsonb(l) - 'id' - 'org_id' - 'created_at' - 'updated_at'
                                  ORDER BY l.slug), '[]'::jsonb)
          FROM public.locations l WHERE l.org_id = org.id) IS DISTINCT FROM e->'locations' THEN
      RAISE EXCEPTION 'FAIL demo locations: the stores of % differ from the expected demo stores', e->>'slug';
    END IF;
    -- 4. exactly one subscription, every column except org_id/updated_at
    IF (SELECT coalesce(jsonb_agg(to_jsonb(x) - 'org_id' - 'updated_at'), '[]'::jsonb)
          FROM public.subscriptions x WHERE x.org_id = org.id)
       IS DISTINCT FROM jsonb_build_array(e->'subscription') THEN
      RAISE EXCEPTION 'FAIL demo subscriptions: the subscription of % differs from the expected one', e->>'slug';
    END IF;
    -- 5. nothing else mentions the organization or its stores
    SELECT coalesce(array_agg(l.id), '{}') INTO loc_ids FROM public.locations l WHERE l.org_id = org.id;
    SELECT array_agg('%' || tok || '%') INTO patterns
      FROM (SELECT org.id::text AS tok UNION ALL SELECT org.slug
            UNION ALL SELECT l.id::text FROM public.locations l WHERE l.org_id = org.id
            UNION ALL SELECT l.slug FROM public.locations l WHERE l.org_id = org.id) t;
    refs := NULL;
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
      RAISE EXCEPTION 'FAIL demo references: % is mentioned by other data: %', e->>'slug', refs;
    END IF;
  END LOOP;
END $$;
SELECT ' PASS: demo seed applied twice: exactly MARAO (3 stores) and Harbor (1 store), every column, '
    || 'subscription and billing period as in the demo, nothing else references them';
