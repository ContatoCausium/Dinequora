\set ON_ERROR_STOP on
-- Billing, entitlements, subscription gating, suspended organizations, privileged billing tables and
-- team management: the scenarios of the retired scripts/security/regression_locations_team.py
-- (Lovable era, unguarded), now on the guarded suite. Expected values come from billing_plans (no
-- commercial rule is restated here). One transaction ending in ROLLBACK, fresh ids on every run;
-- commercial state changes (plan, trial, status) are made as the database owner, exactly like the
-- operator SQL of the old script, and every user action runs as `authenticated` with RLS.
-- Target guard (scripts/guard/target-guard.mjs): stops here, before any write, unless this database
-- was marked disposable (claim on a new, empty stack, or an explicit adopt of a copy).
DO $$ BEGIN
  IF to_regprocedure('dq_guard.attest(text)') IS NULL THEN
    RAISE EXCEPTION 'refused by the target guard: not a disposable database (no dq_guard marker)';
  END IF;
  PERFORM dq_guard.attest('fixture:billing_entitlements');
END $$;

BEGIN;
SELECT gen_random_uuid() AS owner_a, gen_random_uuid() AS owner_b, gen_random_uuid() AS manager_a,
       gen_random_uuid() AS staff_a, substr(md5(gen_random_uuid()::text), 1, 12) AS run \gset
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
(:'owner_a','bill-owner-a-'||:'run'||'@example.test',now()),
(:'owner_b','bill-owner-b-'||:'run'||'@example.test',now()),
(:'manager_a','bill-manager-a-'||:'run'||'@example.test',now()),
(:'staff_a','bill-staff-a-'||:'run'||'@example.test',now());
-- organizations through the same RPC as the app (trigger: starter trial subscription, entitlements)
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',:'owner_a',false);
SELECT public.create_organization('Billing A '||:'run') AS org_a \gset
SELECT set_config('request.jwt.claim.sub',:'owner_b',false);
SELECT public.create_organization('Billing B '||:'run') AS org_b \gset
RESET ROLE;
SELECT id AS l1 FROM public.locations WHERE org_id=:'org_a' \gset
INSERT INTO public.organization_members(org_id,user_id,role) VALUES (:'org_a',:'manager_a','manager'),(:'org_a',:'staff_a','staff');
INSERT INTO public.member_location_access(member_id,location_id)
  SELECT id,:'l1' FROM public.organization_members WHERE org_id=:'org_a' AND user_id IN (:'manager_a',:'staff_a');
-- rows that must stay invisible to members (so "cannot read" is meaningful)
INSERT INTO public.billing_events(org_id,kind,amount_cents,currency,status,description) VALUES (:'org_a','invoice.paid',4900,'usd','paid','fixture');
INSERT INTO public.stripe_webhook_events(id,type,org_id) VALUES ('evt_fixture_'||:'run','invoice.paid',:'org_a');
SELECT set_config('fx.org_a',:'org_a',true), set_config('fx.org_b',:'org_b',true), set_config('fx.l1',:'l1',true),
       set_config('fx.owner_a',:'owner_a',true), set_config('fx.staff_a',:'staff_a',true),
       set_config('fx.manager_a',:'manager_a',true), set_config('fx.run',:'run',true),
       set_config('fx.bootstrap0',(SELECT count(*)::text FROM public.platform_bootstrap),true) \gset fx_
-- refusal helper: runs _sql as the CURRENT role and requires an error whose message contains _code
CREATE FUNCTION pg_temp.refused(_label text, _sql text, _code text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE _sql; EXCEPTION WHEN OTHERS THEN
    IF _code IS NULL OR position(_code in SQLERRM) > 0 OR SQLSTATE = _code THEN RETURN; END IF;
    RAISE EXCEPTION 'FAIL %: refused with "%" (%), expected %', _label, SQLERRM, SQLSTATE, _code;
  END;
  RAISE EXCEPTION 'FAIL %: was accepted', _label;
END $f$;
GRANT EXECUTE ON FUNCTION pg_temp.refused(text,text,text) TO authenticated, anon;
CREATE FUNCTION pg_temp.q(_s text) RETURNS text LANGUAGE sql AS $f$ SELECT replace(replace(replace(replace(replace(replace(replace(_s,
  '{A}', current_setting('fx.org_a')), '{B}', current_setting('fx.org_b')), '{L1}', current_setting('fx.l1')),
  '{L2}', coalesce(current_setting('fx.l2', true), '')), '{L3}', coalesce(current_setting('fx.l3', true), '')),
  '{STAFF}', coalesce(current_setting('fx.staff_member', true), '')), '{OWNERM}', coalesce(current_setting('fx.owner_member', true), '')) $f$;
GRANT EXECUTE ON FUNCTION pg_temp.q(text) TO authenticated, anon;
SELECT set_config('fx.staff_member', (SELECT id::text FROM public.organization_members WHERE org_id=:'org_a' AND user_id=:'staff_a'), true),
       set_config('fx.manager_member', (SELECT id::text FROM public.organization_members WHERE org_id=:'org_a' AND user_id=:'manager_a'), true),
       set_config('fx.owner_member', (SELECT id::text FROM public.organization_members WHERE org_id=:'org_a' AND user_id=:'owner_a'), true) \gset fx_

-- ======================================================== 1. plan entitlements and store limits
DO $$ DECLARE a uuid := current_setting('fx.org_a')::uuid; BEGIN
  IF (SELECT plan_id || '/' || status FROM public.subscriptions WHERE org_id = a) IS DISTINCT FROM 'starter/trialing' THEN
    RAISE EXCEPTION 'FAIL new organization is not on a starter trial'; END IF;
  IF (SELECT store_limit FROM public.organizations WHERE id = a) IS DISTINCT FROM (SELECT default_store_limit FROM public.billing_plans WHERE id = 'starter') THEN
    RAISE EXCEPTION 'FAIL new organization does not get the starter allowance'; END IF;
END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',:'owner_a',false);
SELECT pg_temp.refused('starter: second store', pg_temp.q($$SELECT public.create_location('{A}','Second','1 Main St','America/New_York','')$$), 'store_limit');
RESET ROLE;
UPDATE public.subscriptions SET plan_id='growth' WHERE org_id=:'org_a';   -- operator: upgrade
DO $$ BEGIN IF (SELECT store_limit FROM public.organizations WHERE id=current_setting('fx.org_a')::uuid) IS DISTINCT FROM (SELECT default_store_limit FROM public.billing_plans WHERE id='growth') OR (SELECT plan FROM public.organizations WHERE id=current_setting('fx.org_a')::uuid)::text <> 'growth' THEN RAISE EXCEPTION 'FAIL upgrade does not raise the allowance'; END IF; END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',:'owner_a',false);
SELECT public.create_location(:'org_a','Second '||:'run','1 Main St','America/New_York','') AS l2 \gset
SELECT pg_temp.refused('invalid timezone', pg_temp.q($$SELECT public.create_location('{A}','Bad tz','','Mars/Base','')$$), 'invalid_timezone');
SELECT public.create_location(:'org_a','Third '||:'run','','America/Chicago','') AS l3 \gset
SELECT set_config('fx.l2',:'l2',true), set_config('fx.l3',:'l3',true) \gset fx_
SELECT pg_temp.refused('growth: store over the limit', pg_temp.q($$SELECT public.create_location('{A}','Fourth','','America/Chicago','')$$), 'store_limit');
SELECT public.set_location_status(:'l3','inactive');
SELECT public.create_location(:'org_a','Fourth '||:'run','','America/Chicago','');  -- the inactive store freed a slot
SELECT public.update_location(:'l3','Third '||:'run','3 Main St','','America/Chicago','{}'::jsonb);
SELECT pg_temp.refused('reactivation over the limit', pg_temp.q($$SELECT public.set_location_status('{L3}','active')$$), 'store_limit');
RESET ROLE;
UPDATE public.subscriptions SET plan_id='starter' WHERE org_id=:'org_a';  -- operator: downgrade
DO $$ BEGIN IF (SELECT count(*) FROM public.locations WHERE org_id=current_setting('fx.org_a')::uuid AND status='active') <> 3 THEN RAISE EXCEPTION 'FAIL downgrade changed the existing stores'; END IF; END $$;
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',:'owner_a',false);
SELECT pg_temp.refused('downgrade: reactivation over the limit', pg_temp.q($$SELECT public.set_location_status('{L3}','active')$$), 'store_limit');
RESET ROLE;
UPDATE public.organizations SET store_limit_override=5 WHERE id=:'org_a'; SELECT public.sync_org_entitlements(:'org_a');  -- operator override
DO $$ BEGIN IF (SELECT store_limit FROM public.organizations WHERE id=current_setting('fx.org_a')::uuid) <> 5 THEN RAISE EXCEPTION 'FAIL operator override not applied'; END IF; END $$;
UPDATE public.organizations SET store_limit_override=NULL WHERE id=:'org_a'; SELECT public.sync_org_entitlements(:'org_a');

-- ======================================================== 2. subscription state gates writes
CREATE FUNCTION pg_temp.owner_write_as(_label text, _state text, _expect text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  EXECUTE format('UPDATE public.subscriptions SET %s WHERE org_id = %L', _state, current_setting('fx.org_a'));
  EXECUTE 'SET LOCAL ROLE authenticated';
  PERFORM set_config('request.jwt.claim.sub', current_setting('fx.owner_a'), true);
  IF _expect IS NULL THEN
    PERFORM public.update_location(current_setting('fx.l2')::uuid, 'Second', '1 Main St', '', 'America/New_York', '{}'::jsonb);
  ELSE
    PERFORM pg_temp.refused(_label, pg_temp.q($$SELECT public.update_location('{L2}','Second','1 Main St','','America/New_York','{}'::jsonb)$$), _expect);
  END IF;
  EXECUTE 'RESET ROLE';
END $f$;
SELECT pg_temp.owner_write_as('active subscription (control)', $$status='active', plan_id='growth', trial_ends_at=NULL, grace_ends_at=NULL$$, NULL);
SELECT pg_temp.owner_write_as('trial still running (control)', $$status='trialing', trial_ends_at=now()+interval '7 days'$$, NULL);
SELECT pg_temp.owner_write_as('expired trial', $$status='trialing', trial_ends_at=now()-interval '1 day'$$, 'subscription_inactive');
SELECT pg_temp.owner_write_as('canceled subscription', $$status='canceled', trial_ends_at=now()+interval '14 days'$$, 'subscription_inactive');
SELECT pg_temp.owner_write_as('unpaid subscription', $$status='unpaid'$$, 'subscription_inactive');
SELECT pg_temp.owner_write_as('expired grace', $$status='grace', grace_ends_at=now()-interval '1 hour'$$, 'subscription_inactive');
SELECT pg_temp.owner_write_as('grace still running (control)', $$status='grace', grace_ends_at=now()+interval '1 day'$$, NULL);
UPDATE public.subscriptions SET status='trialing', plan_id='starter', trial_ends_at=now()+interval '14 days', grace_ends_at=NULL WHERE org_id=:'org_a';

-- ======================================================== 3. billing is owner-only and read-only for users
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',:'manager_a',false);
DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.subscriptions WHERE org_id=current_setting('fx.org_a')::uuid) OR EXISTS (SELECT 1 FROM public.billing_events WHERE org_id=current_setting('fx.org_a')::uuid) THEN RAISE EXCEPTION 'FAIL a manager reads billing'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub',:'owner_b',false);
DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.subscriptions WHERE org_id=current_setting('fx.org_a')::uuid) OR EXISTS (SELECT 1 FROM public.billing_events WHERE org_id=current_setting('fx.org_a')::uuid) THEN RAISE EXCEPTION 'FAIL another tenant reads billing'; END IF; END $$;
SELECT set_config('request.jwt.claim.sub',:'owner_a',false);
DO $$ BEGIN IF (SELECT status FROM public.subscriptions WHERE org_id=current_setting('fx.org_a')::uuid) IS DISTINCT FROM 'trialing' THEN RAISE EXCEPTION 'FAIL the owner cannot read the own subscription'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.billing_events WHERE org_id=current_setting('fx.org_a')::uuid) THEN RAISE EXCEPTION 'FAIL the owner cannot read the own billing history'; END IF; END $$;
-- privileged writes as the owner (RLS has no write policy: refused or no row touched)
UPDATE public.subscriptions SET status='active', plan_id='enterprise' WHERE org_id=:'org_a';
UPDATE public.billing_plans SET default_store_limit=99 WHERE id='starter';
DO $$ BEGIN BEGIN UPDATE public.organizations SET store_limit_override=99, store_limit=99, plan='enterprise' WHERE id=current_setting('fx.org_a')::uuid; EXCEPTION WHEN insufficient_privilege THEN NULL; END; END $$;
SELECT pg_temp.refused('owner fabricates payment history', pg_temp.q($$INSERT INTO public.billing_events(org_id,kind,amount_cents) VALUES ('{A}','invoice.paid',1)$$), '42501');
SELECT pg_temp.refused('owner inserts a subscription', pg_temp.q($$INSERT INTO public.subscriptions(org_id,plan_id) VALUES ('{B}','enterprise')$$), NULL);
SELECT pg_temp.refused('owner pre-seeds a webhook id', $$INSERT INTO public.stripe_webhook_events(id,type) VALUES ('evt_x','x')$$, '42501');
SELECT pg_temp.refused('owner applies a Stripe event', pg_temp.q($$SELECT public.billing_apply_stripe_event('evt_fake','invoice.paid','{A}',NULL,NULL,'active','enterprise',NULL,NULL,NULL,100,'usd')$$), '42501');
SELECT pg_temp.refused('owner changes the own plan', pg_temp.q($$SELECT public.admin_set_subscription('{A}','enterprise','active','self upgrade')$$), 'forbidden');
SELECT pg_temp.refused('owner calls the admin plan change', pg_temp.q($$SELECT public.admin_update_organization('{A}',NULL,'enterprise',50,'self')$$), 'forbidden');
SELECT pg_temp.refused('user bootstraps a platform admin', pg_temp.q($$SELECT public.bootstrap_first_platform_admin(auth.uid(),'trying to self-bootstrap')$$), '42501');
DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.stripe_webhook_events) OR EXISTS (SELECT 1 FROM public.platform_bootstrap) THEN RAISE EXCEPTION 'FAIL users read webhook or bootstrap rows'; END IF; END $$;
RESET ROLE; SET ROLE anon;
DO $$ BEGIN
  BEGIN IF EXISTS (SELECT 1 FROM public.stripe_webhook_events) OR EXISTS (SELECT 1 FROM public.platform_bootstrap) OR EXISTS (SELECT 1 FROM public.billing_events) OR EXISTS (SELECT 1 FROM public.subscriptions) THEN RAISE EXCEPTION 'FAIL anon reads billing rows'; END IF;
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
SELECT pg_temp.refused('anon bootstraps a platform admin', $$SELECT public.bootstrap_first_platform_admin('00000000-0000-4000-8000-000000000000','x')$$, '42501');
RESET ROLE;
DO $$ DECLARE a uuid := current_setting('fx.org_a')::uuid; BEGIN
  IF (SELECT status || '/' || plan_id FROM public.subscriptions WHERE org_id = a) <> 'trialing/starter' THEN RAISE EXCEPTION 'FAIL the owner changed the own subscription'; END IF;
  IF (SELECT default_store_limit FROM public.billing_plans WHERE id = 'starter') = 99 THEN RAISE EXCEPTION 'FAIL a user edited a plan'; END IF;
  IF (SELECT store_limit_override IS NOT NULL OR store_limit = 99 OR plan::text = 'enterprise' FROM public.organizations WHERE id = a) THEN RAISE EXCEPTION 'FAIL the owner changed the own entitlements'; END IF;
  IF (SELECT count(*) FROM public.billing_events WHERE org_id = a) <> 1 OR EXISTS (SELECT 1 FROM public.subscriptions WHERE org_id = current_setting('fx.org_b')::uuid AND plan_id = 'enterprise') THEN RAISE EXCEPTION 'FAIL a privileged billing row was written'; END IF;
  IF EXISTS (SELECT 1 FROM public.stripe_webhook_events WHERE id IN ('evt_x', 'evt_fake')) OR (SELECT count(*) FROM public.platform_bootstrap) <> current_setting('fx.bootstrap0')::bigint THEN RAISE EXCEPTION 'FAIL a webhook or bootstrap row was written'; END IF;
END $$;

-- ======================================================== 4. team management and tenant scope
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',:'owner_b',false);
SELECT pg_temp.refused('other tenant adds a store', pg_temp.q($$SELECT public.create_location('{A}','Evil','','America/Chicago','')$$), 'forbidden');
SELECT pg_temp.refused('other tenant edits a store', pg_temp.q($$SELECT public.update_location('{L1}','Hacked','','','America/Chicago','{}'::jsonb)$$), 'forbidden');
SELECT pg_temp.refused('other tenant assigns stores', pg_temp.q($$SELECT public.set_member_locations('{STAFF}','{}'::uuid[])$$), 'forbidden');
SELECT set_config('request.jwt.claim.sub',:'manager_a',false);
SELECT pg_temp.refused('manager adds a store', pg_temp.q($$SELECT public.create_location('{A}','Mgr store','','America/Chicago','')$$), 'forbidden');
SELECT pg_temp.refused('manager invites a manager', pg_temp.q($$SELECT public.create_invitation('{A}','x-'||current_setting('fx.run')||'@example.test','manager',ARRAY['{L1}']::uuid[])$$), 'forbidden');
SELECT pg_temp.refused('manager invites into another store', pg_temp.q($$SELECT public.create_invitation('{A}','y-'||current_setting('fx.run')||'@example.test','staff',ARRAY['{L2}']::uuid[])$$), 'forbidden');
SELECT pg_temp.refused('manager assigns staff outside the own scope', pg_temp.q($$SELECT public.set_member_locations('{STAFF}',ARRAY['{L1}','{L2}']::uuid[])$$), 'forbidden');
SELECT pg_temp.refused('manager elevates self', $$SELECT public.set_member_role(current_setting('fx.manager_member')::uuid,'owner')$$, 'forbidden');
SELECT pg_temp.refused('manager changes a role', pg_temp.q($$SELECT public.set_member_role('{STAFF}','manager')$$), 'forbidden');
SELECT pg_temp.refused('manager reassigns store managers', pg_temp.q($$SELECT public.set_location_managers('{L2}','{}'::uuid[])$$), 'forbidden');
SELECT set_config('request.jwt.claim.sub',:'staff_a',false);
SELECT pg_temp.refused('staff assigns own stores', pg_temp.q($$SELECT public.set_member_locations('{STAFF}',ARRAY['{L1}','{L2}']::uuid[])$$), 'forbidden');
SELECT pg_temp.refused('staff elevates self', pg_temp.q($$SELECT public.set_member_role('{STAFF}','owner')$$), 'forbidden');
SELECT set_config('request.jwt.claim.sub',:'owner_a',false);
SELECT pg_temp.refused('last owner demotes self', pg_temp.q($$SELECT public.set_member_role('{OWNERM}','manager')$$), 'last_owner');
SELECT pg_temp.refused('last owner leaves', pg_temp.q($$SELECT public.remove_member('{OWNERM}')$$), 'last_owner');
SELECT public.set_member_locations(current_setting('fx.staff_member')::uuid, ARRAY[:'l1',:'l2']::uuid[]);
SELECT public.set_member_role(current_setting('fx.staff_member')::uuid, 'manager');
SELECT public.set_location_managers(:'l2', ARRAY[current_setting('fx.manager_member')::uuid]);
RESET ROLE; SET ROLE anon;
SELECT pg_temp.refused('anonymous adds a store', pg_temp.q($$SELECT public.create_location('{A}','Anon','','America/Chicago','')$$), NULL);
RESET ROLE;
DO $$ DECLARE acts text[] := ARRAY(SELECT DISTINCT action FROM public.audit_logs WHERE org_id = current_setting('fx.org_a')::uuid); a text; BEGIN
  FOREACH a IN ARRAY ARRAY['location.created','location.status_changed','member.locations_changed','member.role_changed','location.managers_changed'] LOOP
    IF NOT a = ANY(acts) THEN RAISE EXCEPTION 'FAIL not audited: %', a; END IF;
  END LOOP;
END $$;

-- ======================================================== 5. a suspended organization cannot write
UPDATE public.organizations SET status='suspended' WHERE id=:'org_a';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub',:'owner_a',false);
SELECT pg_temp.refused('suspended: add a store', pg_temp.q($$SELECT public.create_location('{A}','While suspended','','America/Chicago','')$$), 'org_suspended');
SELECT pg_temp.refused('suspended: edit a store', pg_temp.q($$SELECT public.update_location('{L1}','Edit','','','America/Chicago','{}'::jsonb)$$), 'org_suspended');
SELECT pg_temp.refused('suspended: invite', pg_temp.q($$SELECT public.create_invitation('{A}','z-'||current_setting('fx.run')||'@example.test','staff','{}'::uuid[])$$), 'org_suspended');
SELECT pg_temp.refused('suspended: change a role', pg_temp.q($$SELECT public.set_member_role('{STAFF}','staff')$$), 'org_suspended');
SELECT pg_temp.refused('suspended: assign stores', pg_temp.q($$SELECT public.set_member_locations('{STAFF}','{}'::uuid[])$$), 'org_suspended');
DO $$ BEGIN IF public.can_operate_location(current_setting('fx.l1')::uuid) THEN RAISE EXCEPTION 'FAIL a suspended organization can operate'; END IF; END $$;
RESET ROLE;

ROLLBACK;
SELECT set_config('fx.left_org', :'org_a', false), set_config('fx.left_user', :'owner_a', false) \gset fx_
DO $$ BEGIN IF EXISTS (SELECT 1 FROM public.organizations WHERE id = current_setting('fx.left_org')::uuid) OR EXISTS (SELECT 1 FROM auth.users WHERE id = current_setting('fx.left_user')::uuid) THEN RAISE EXCEPTION 'FAIL rollback: rows of this run remained'; END IF; END $$;
SELECT 'PASS: billing (regression_locations_team scenarios): plan allowance from billing_plans, starter/growth limits, invalid timezone, inactive store frees a slot, reactivation and downgrade respect the limit, operator override; expired trial, canceled, unpaid and expired grace block writes (active, running trial and grace allowed); billing owner-only (manager and other tenant read nothing), no user write to subscriptions, plans, entitlements, payment history, webhook ids, Stripe events, admin plan RPCs or bootstrap; anon reads nothing; cross-tenant, manager and staff team limits, last owner, audit trail; suspended organization blocks writes; nothing kept (ROLLBACK)';
