\set ON_ERROR_STOP on
-- 0022: store scope across organizations, users without a permission, and organization features.
-- Disposable local database only. Everything runs in ONE transaction that is rolled back, so the
-- following suite steps see the database exactly as before.
--
--   U1 dual member: OWNER of A (every permission) and STAFF of B with access to store B1 only
--   U2 owner of B · U3 staff of A with store A1 only · U4 no membership · U5 platform admin only
--   P = finance.view (U1 holds it in A, not in B) · Q = orders.view (U1 holds it in both)
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
('a2200000-0000-4000-8000-000000000001','pr2-dual-member@example.test',now()),
('a2200000-0000-4000-8000-000000000002','pr2-owner-b@example.test',now()),
('a2200000-0000-4000-8000-000000000003','pr2-staff-a@example.test',now()),
('a2200000-0000-4000-8000-000000000004','pr2-outsider@example.test',now()),
('a2200000-0000-4000-8000-000000000005','pr2-platform-admin@example.test',now());
INSERT INTO public.organizations(id,slug,name,plan,status) VALUES
('b2200000-0000-4000-8000-000000000001','pr2_a','PR2 A','starter','active'),
('b2200000-0000-4000-8000-000000000002','pr2_b','PR2 B','starter','active');
UPDATE public.subscriptions SET status='active'
 WHERE org_id IN('b2200000-0000-4000-8000-000000000001','b2200000-0000-4000-8000-000000000002');
INSERT INTO public.locations(id,org_id,slug,name) VALUES
('c2200000-0000-4000-8000-000000000001','b2200000-0000-4000-8000-000000000001','pr2_a1','A1'),
('c2200000-0000-4000-8000-000000000002','b2200000-0000-4000-8000-000000000001','pr2_a2','A2'),
('c2200000-0000-4000-8000-000000000003','b2200000-0000-4000-8000-000000000002','pr2_b1','B1');
INSERT INTO public.organization_members(id,org_id,user_id,role) VALUES
('d2200000-0000-4000-8000-000000000001','b2200000-0000-4000-8000-000000000001','a2200000-0000-4000-8000-000000000001','owner'),
('d2200000-0000-4000-8000-000000000002','b2200000-0000-4000-8000-000000000002','a2200000-0000-4000-8000-000000000001','staff'),
('d2200000-0000-4000-8000-000000000003','b2200000-0000-4000-8000-000000000002','a2200000-0000-4000-8000-000000000002','owner'),
('d2200000-0000-4000-8000-000000000004','b2200000-0000-4000-8000-000000000001','a2200000-0000-4000-8000-000000000003','staff');
INSERT INTO public.member_location_access VALUES
('d2200000-0000-4000-8000-000000000002','c2200000-0000-4000-8000-000000000003'),
('d2200000-0000-4000-8000-000000000004','c2200000-0000-4000-8000-000000000001');
INSERT INTO public.user_roles(user_id,role) VALUES ('a2200000-0000-4000-8000-000000000005','platform_admin');

-- The fixture really reproduces the defect: the 0019 rule grants P in A for a store of B.
DO $$ BEGIN
 PERFORM set_config('request.jwt.claim.sub','a2200000-0000-4000-8000-000000000001',true);
 IF NOT (EXISTS(SELECT 1 FROM public.organization_members m WHERE m.org_id='b2200000-0000-4000-8000-000000000001'
              AND m.user_id=auth.uid() AND (m.role='owner' OR 'finance.view'=ANY(m.effective_permissions)))
         AND public.can_access_location('c2200000-0000-4000-8000-000000000003')) THEN
  RAISE EXCEPTION 'FAIL fixture does not reproduce the 0019 cross-organization grant'; END IF;
 IF EXISTS(SELECT 1 FROM public.organization_members WHERE id='d2200000-0000-4000-8000-000000000002' AND 'finance.view'=ANY(effective_permissions)) THEN
  RAISE EXCEPTION 'FAIL fixture: staff of B must not hold finance.view'; END IF;
END $$;

SET ROLE authenticated;
-- 1. Two organizations: a permission of one organization never opens a store of the other.
SELECT set_config('request.jwt.claim.sub','a2200000-0000-4000-8000-000000000001',false);
DO $$ DECLARE A uuid:='b2200000-0000-4000-8000-000000000001'; B uuid:='b2200000-0000-4000-8000-000000000002';
  A1 uuid:='c2200000-0000-4000-8000-000000000001'; A2 uuid:='c2200000-0000-4000-8000-000000000002'; B1 uuid:='c2200000-0000-4000-8000-000000000003';
BEGIN
 IF public.has_permission(A,'finance.view',B1) THEN RAISE EXCEPTION 'FAIL A permission opened store of B'; END IF;
 IF public.has_any_permission(A,ARRAY['finance.view','team.view'],B1) THEN RAISE EXCEPTION 'FAIL any: A permission opened store of B'; END IF;
 IF public.has_permission(B,'orders.view',A1) THEN RAISE EXCEPTION 'FAIL B permission opened store of A'; END IF;
 IF public.has_any_permission(B,ARRAY['orders.view'],A1) THEN RAISE EXCEPTION 'FAIL any: B permission opened store of A'; END IF;
 -- controls: legitimate access is unchanged
 IF NOT public.has_permission(A,'finance.view') OR NOT public.has_permission(A,'finance.view',A1)
    OR NOT public.has_permission(A,'finance.view',A2) THEN RAISE EXCEPTION 'FAIL owner lost access in own org'; END IF;
 IF NOT public.has_permission(B,'orders.view',B1) OR NOT public.has_permission(B,'orders.view') THEN RAISE EXCEPTION 'FAIL staff lost access in own store'; END IF;
 IF public.has_permission(B,'finance.view',B1) OR public.has_permission(B,'finance.view') THEN RAISE EXCEPTION 'FAIL staff gained P in B'; END IF;
 IF NOT public.has_any_permission(B,ARRAY['finance.view','orders.view'],B1) THEN RAISE EXCEPTION 'FAIL any in own store'; END IF;
 IF (SELECT array_agg(o) FROM public.orgs_with_any_permission(ARRAY['finance.view']) o) IS DISTINCT FROM ARRAY[A] THEN
  RAISE EXCEPTION 'FAIL orgs_with_any_permission'; END IF;
 IF 'finance.view'=ANY(public.my_permissions(B)) OR NOT 'orders.view'=ANY(public.my_permissions(B)) THEN RAISE EXCEPTION 'FAIL my_permissions B'; END IF;
 IF public.has_any_permission(A,'{}'::text[]) THEN RAISE EXCEPTION 'FAIL empty permission list must be false'; END IF;
END $$;

-- 2. Users without the permission, without the store, without membership, without a session.
SELECT set_config('request.jwt.claim.sub','a2200000-0000-4000-8000-000000000003',false);
DO $$ DECLARE A uuid:='b2200000-0000-4000-8000-000000000001'; B uuid:='b2200000-0000-4000-8000-000000000002';
  A1 uuid:='c2200000-0000-4000-8000-000000000001'; A2 uuid:='c2200000-0000-4000-8000-000000000002';
BEGIN
 IF public.has_permission(A,'finance.view') OR public.has_permission(A,'finance.view',A1) THEN RAISE EXCEPTION 'FAIL staff without P'; END IF;
 IF public.has_permission(A,'orders.view',A2) THEN RAISE EXCEPTION 'FAIL store without access'; END IF;
 IF NOT public.has_permission(A,'orders.view',A1) THEN RAISE EXCEPTION 'FAIL own store'; END IF;
 IF public.has_permission(B,'orders.view') THEN RAISE EXCEPTION 'FAIL non-member org'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','a2200000-0000-4000-8000-000000000004',false);
DO $$ BEGIN
 IF public.has_permission('b2200000-0000-4000-8000-000000000001','orders.view') THEN RAISE EXCEPTION 'FAIL outsider'; END IF;
 IF public.my_permissions('b2200000-0000-4000-8000-000000000001') <> '{}'::text[] THEN RAISE EXCEPTION 'FAIL outsider permissions'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','',false);
DO $$ BEGIN
 IF public.has_permission('b2200000-0000-4000-8000-000000000001','orders.view') THEN RAISE EXCEPTION 'FAIL no session'; END IF;
END $$;
RESET ROLE;
-- assert_permission is internal (only SECURITY DEFINER RPCs call it): same callers, checked as owner.
DO $$ BEGIN
 IF has_function_privilege('authenticated','public.assert_permission(uuid,text,uuid)','execute') THEN RAISE EXCEPTION 'FAIL assert_permission exposed'; END IF;
 PERFORM set_config('request.jwt.claim.sub','a2200000-0000-4000-8000-000000000001',true);
 BEGIN PERFORM public.assert_permission('b2200000-0000-4000-8000-000000000001','finance.view','c2200000-0000-4000-8000-000000000003'); RAISE EXCEPTION 'FAIL assert cross-org store';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'permission_denied' THEN RAISE; END IF; END;
 PERFORM public.assert_permission('b2200000-0000-4000-8000-000000000001','finance.view','c2200000-0000-4000-8000-000000000001');
 PERFORM set_config('request.jwt.claim.sub','a2200000-0000-4000-8000-000000000003',true);
 BEGIN PERFORM public.assert_permission('b2200000-0000-4000-8000-000000000001','finance.view','c2200000-0000-4000-8000-000000000001'); RAISE EXCEPTION 'FAIL assert without P';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'permission_denied' THEN RAISE; END IF; END;
 PERFORM set_config('request.jwt.claim.sub','',true);
END $$;
SET ROLE anon;
DO $$ BEGIN
 BEGIN PERFORM public.has_permission('b2200000-0000-4000-8000-000000000001','orders.view'); RAISE EXCEPTION 'FAIL anon execute';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN PERFORM 1 FROM public.org_features; RAISE EXCEPTION 'FAIL anon reads org_features';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;
RESET ROLE;

-- 3. Features: new features start disabled; a permission mapped to a disabled feature counts for
--    nobody (owners included); only platform admins switch a feature, per organization, audited.
DO $$ BEGIN
 IF (SELECT count(*) FROM public.feature_catalog) < 1 OR EXISTS(SELECT 1 FROM public.feature_catalog WHERE default_enabled) THEN
  RAISE EXCEPTION 'FAIL every catalog feature must start disabled'; END IF;
 IF EXISTS(SELECT 1 FROM public.org_features WHERE enabled) THEN RAISE EXCEPTION 'FAIL a feature is enabled after migration'; END IF;
 IF public.org_feature_enabled('b2200000-0000-4000-8000-000000000002','cloud_printing')
    OR public.org_feature_enabled('b2200000-0000-4000-8000-000000000002','no_such_feature') THEN RAISE EXCEPTION 'FAIL default/unknown feature'; END IF;
 IF has_function_privilege('authenticated','public.org_feature_enabled(uuid,text)','execute')
    OR has_function_privilege('authenticated','public.permission_feature_enabled(uuid,text)','execute')
    OR has_function_privilege('authenticated','public.location_in_org(uuid,uuid)','execute')
    OR has_function_privilege('anon','public.admin_set_org_feature(uuid,text,boolean)','execute') THEN
  RAISE EXCEPTION 'FAIL helper grants'; END IF;
END $$;
-- Test-only mapping (rolled back): reports.view requires the "integrations" feature.
INSERT INTO public.feature_permissions(permission,feature) VALUES ('reports.view','integrations');

SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','a2200000-0000-4000-8000-000000000001',false);
DO $$ DECLARE A uuid:='b2200000-0000-4000-8000-000000000001'; A1 uuid:='c2200000-0000-4000-8000-000000000001';
BEGIN
 IF public.has_permission(A,'reports.view') OR public.has_permission(A,'reports.view',A1) THEN RAISE EXCEPTION 'FAIL owner passed a disabled feature'; END IF;
 IF public.has_any_permission(A,ARRAY['reports.view']) THEN RAISE EXCEPTION 'FAIL any passed a disabled feature'; END IF;
 IF NOT public.has_any_permission(A,ARRAY['reports.view','orders.view']) THEN RAISE EXCEPTION 'FAIL unrelated permission blocked'; END IF;
 IF 'reports.view'=ANY(public.my_permissions(A)) OR NOT 'orders.view'=ANY(public.my_permissions(A)) THEN RAISE EXCEPTION 'FAIL my_permissions with disabled feature'; END IF;
 IF EXISTS(SELECT 1 FROM public.orgs_with_any_permission(ARRAY['reports.view'])) THEN RAISE EXCEPTION 'FAIL RLS orgs with disabled feature'; END IF;
 BEGIN PERFORM public.admin_set_org_feature(A,'integrations',true); RAISE EXCEPTION 'FAIL owner switched a feature';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'forbidden' THEN RAISE; END IF; END;
 BEGIN INSERT INTO public.org_features(org_id,feature,enabled) VALUES (A,'integrations',true); RAISE EXCEPTION 'FAIL direct insert org_features';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN UPDATE public.feature_catalog SET default_enabled=true; RAISE EXCEPTION 'FAIL direct update feature_catalog';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 BEGIN DELETE FROM public.feature_permissions; RAISE EXCEPTION 'FAIL direct delete feature_permissions';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END $$;

SELECT set_config('request.jwt.claim.sub','a2200000-0000-4000-8000-000000000005',false);
DO $$ DECLARE A uuid:='b2200000-0000-4000-8000-000000000001'; BEGIN
 BEGIN PERFORM public.admin_set_org_feature(A,'no_such_feature',true); RAISE EXCEPTION 'FAIL unknown feature';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_feature' THEN RAISE; END IF; END;
 BEGIN PERFORM public.admin_set_org_feature(A,'integrations',null); RAISE EXCEPTION 'FAIL null switch';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'invalid_feature' THEN RAISE; END IF; END;
 BEGIN PERFORM public.admin_set_org_feature('00000000-0000-4000-8000-000000000000','integrations',true); RAISE EXCEPTION 'FAIL unknown org';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'not_found' THEN RAISE; END IF; END;
 IF public.has_permission(A,'reports.view') THEN RAISE EXCEPTION 'FAIL platform admin has tenant permission'; END IF;
 PERFORM public.admin_set_org_feature(A,'integrations',true);
END $$;

SELECT set_config('request.jwt.claim.sub','a2200000-0000-4000-8000-000000000001',false);
DO $$ DECLARE A uuid:='b2200000-0000-4000-8000-000000000001'; BEGIN
 IF NOT public.has_permission(A,'reports.view') OR NOT 'reports.view'=ANY(public.my_permissions(A))
    OR NOT EXISTS(SELECT 1 FROM public.orgs_with_any_permission(ARRAY['reports.view']) o WHERE o=A) THEN
  RAISE EXCEPTION 'FAIL enabled feature not applied'; END IF;
 IF (SELECT count(*) FROM public.org_features WHERE org_id=A AND enabled) <> 1 THEN RAISE EXCEPTION 'FAIL member reads own features'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','a2200000-0000-4000-8000-000000000002',false);
DO $$ BEGIN
 IF public.has_permission('b2200000-0000-4000-8000-000000000002','reports.view') THEN RAISE EXCEPTION 'FAIL feature leaked to another org'; END IF;
 IF EXISTS(SELECT 1 FROM public.org_features WHERE org_id='b2200000-0000-4000-8000-000000000001') THEN RAISE EXCEPTION 'FAIL reads other org features'; END IF;
END $$;

SELECT set_config('request.jwt.claim.sub','a2200000-0000-4000-8000-000000000005',false);
SELECT public.admin_set_org_feature('b2200000-0000-4000-8000-000000000001','integrations',false);
SELECT set_config('request.jwt.claim.sub','a2200000-0000-4000-8000-000000000001',false);
DO $$ BEGIN
 IF public.has_permission('b2200000-0000-4000-8000-000000000001','reports.view') THEN RAISE EXCEPTION 'FAIL disabled again'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub','',false);
RESET ROLE;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.audit_logs WHERE org_id='b2200000-0000-4000-8000-000000000001' AND target='integrations'
       AND actor_id='a2200000-0000-4000-8000-000000000005' AND action IN('feature.enabled','feature.disabled')) <> 2 THEN
  RAISE EXCEPTION 'FAIL feature switches are not audited'; END IF;
 IF (SELECT updated_by FROM public.org_features WHERE org_id='b2200000-0000-4000-8000-000000000001' AND feature='integrations')
    IS DISTINCT FROM 'a2200000-0000-4000-8000-000000000005'::uuid THEN RAISE EXCEPTION 'FAIL updated_by'; END IF;
END $$;
SELECT 'PASS: cross-organization store denied both ways (has/any/assert/RLS orgs), no permission, no store, no membership, no session, anon, features off by default, disabled feature blocks owners, per-org switch by platform admin only, audited, direct writes denied';
ROLLBACK;
