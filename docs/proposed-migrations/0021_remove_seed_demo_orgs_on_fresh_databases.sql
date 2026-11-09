-- PROPOSED migration (not in the journal; requires approval before it is added as 0021).
--
-- 0000_auth_orgs_memberships inserts two demo organizations (MARAO BURGERS, Harbor Taco Co.) and
-- 0001 flags them is_demo = true. Every new database therefore starts with demo tenants, including a
-- future production database. Historical migrations are published and are NOT edited; this additive
-- migration removes those seed rows ONLY on a brand-new database, where removal cannot lose data:
--
--   * no auth.users row exists (nobody has ever signed up or been invited), and
--   * the organization is exactly the 0000 seed: slug org_marao / org_harbor, is_demo, created_by is
--     null, no members, no invitations;
--   * operational tables reference organizations with NO ACTION, so any order, menu, stock, finance,
--     supplier, purchase or WhatsApp row makes the DELETE fail instead of silently removing data.
--
-- On any database that has users (the commercial demo, QA stacks, a hosted project in use) this is a
-- no-op and the demo organizations stay exactly as they are. Demo environments that want MARAO and
-- Harbor on a fresh database recreate them with scripts/seeds/demo/seed-demo-orgs.sql.
-- Locations, subscriptions and billing events of the seeds are removed by ON DELETE CASCADE.
DO $$
DECLARE
  removed int;
BEGIN
  IF EXISTS (SELECT 1 FROM auth.users) THEN
    RAISE NOTICE 'seed demo organizations kept: database already has users';
    RETURN;
  END IF;
  DELETE FROM public.organizations o
  WHERE o.slug IN ('org_marao', 'org_harbor')
    AND o.is_demo
    AND o.created_by IS NULL
    AND NOT EXISTS (SELECT 1 FROM public.organization_members m WHERE m.org_id = o.id)
    AND NOT EXISTS (SELECT 1 FROM public.invitations i WHERE i.org_id = o.id);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RAISE NOTICE 'seed demo organizations removed from fresh database: %', removed;
END $$;
