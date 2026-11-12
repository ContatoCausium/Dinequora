-- DEMO seed: the two bundled demonstration organizations (MARAO BURGERS, Harbor Taco Co.).
--
-- Layer: demonstration data. Never run on a production database. Use it on a fresh demo/QA
-- database when migration 0021 removed the 0000 seed rows. Idempotent: existing rows
-- (e.g. the current commercial demo, where 0000 created them) are left untouched.
-- Recreates exactly the state the commercial demo has today (verified 2026-11-09).
--
-- Target guard: runs on a database marked disposable (scripts/guard/target-guard.mjs), or on another
-- local database only with a confirmation that names THAT cluster and this operation, given by the
-- operator for the session: PGOPTIONS="-c dq_guard.confirm=seed-demo:<cluster>", where <cluster> is
-- shown by `bash scripts/ops/db-ops.sh inspect`. No generic setting authorizes it, and a
-- confirmation for one cluster does not work on another.
\set ON_ERROR_STOP on
DO $$
DECLARE h text := encode(sha256(convert_to('dinequora-cluster:' || (SELECT system_identifier::text FROM pg_control_system()), 'UTF8')), 'hex');
BEGIN
  IF to_regprocedure('dq_guard.attest(text)') IS NOT NULL THEN
    PERFORM dq_guard.attest('seed:demo');
  ELSIF current_setting('dq_guard.confirm', true) IS DISTINCT FROM 'seed-demo:' || left(h, 12) THEN
    RAISE EXCEPTION 'refused by the target guard: not a disposable database and no confirmation for this cluster (see the header of this file)';
  END IF;
END $$;
BEGIN;
INSERT INTO public.organizations (slug, name, brand_primary, brand_accent, is_demo, plan, status,
                                  store_limit, store_limit_override, onboarding_step)
VALUES ('org_marao', 'MARAO BURGERS', '#d63c46', '#f2a43a', true, 'starter', 'active', 3, 3, 5),
       ('org_harbor', 'Harbor Taco Co.', '#16707a', '#e8b64c', true, 'starter', 'active', 3, 3, 5)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.locations (org_id, slug, name, status, is_verified, address)
SELECT o.id, v.slug, v.name, v.status, v.verified, v.address
FROM (VALUES
  ('org_marao', 'loc_marao_framingham', 'MARAO Framingham', 'active', true, '61 Hollis St, Framingham, MA 01702'),
  ('org_marao', 'loc_marao_2', 'Location 2', 'placeholder', false, NULL),
  ('org_marao', 'loc_marao_3', 'Location 3', 'placeholder', false, NULL),
  ('org_harbor', 'loc_harbor_1', 'Harbor Taco · Demo Store', 'active', false, NULL)
) AS v(org_slug, slug, name, status, verified, address)
JOIN public.organizations o ON o.slug = v.org_slug AND o.is_demo
WHERE NOT EXISTS (SELECT 1 FROM public.locations l WHERE l.slug = v.slug);

-- The organizations_subscription trigger creates the subscription row; align it with the demo.
UPDATE public.subscriptions s
SET plan_id = 'starter', status = 'active', trial_ends_at = NULL, grace_ends_at = NULL,
    billed_locations = CASE o.slug WHEN 'org_marao' THEN 3 ELSE 1 END
FROM public.organizations o
WHERE s.org_id = o.id AND o.slug IN ('org_marao', 'org_harbor') AND o.is_demo
  AND NOT EXISTS (SELECT 1 FROM public.organization_members m WHERE m.org_id = o.id);
COMMIT;
SELECT 'demo organizations present: ' || string_agg(slug, ', ' ORDER BY slug)
FROM public.organizations WHERE slug IN ('org_marao', 'org_harbor') AND is_demo;
