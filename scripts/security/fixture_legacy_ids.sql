-- Rows with the literal ids the former reconstructed_* fixtures COMMITTED (Test A/B, still present in
-- databases where those fixtures ran). Prepended by security-suite.sh step 3b to the operations
-- fixture in the SAME transaction: the fixture must still pass, and its ROLLBACK discards these too.
-- Never run on its own.
BEGIN;
INSERT INTO auth.users(id,email,email_confirmed_at) VALUES ('aaaaaaaa-0000-4000-8000-000000000001','owner-a@example.test',now()),('aaaaaaaa-0000-4000-8000-000000000002','owner-b@example.test',now()),('aaaaaaaa-0000-4000-8000-000000000003','staff-a@example.test',now());
INSERT INTO public.organizations(id,slug,name,plan,status) VALUES ('bbbbbbbb-0000-4000-8000-000000000001','test_a','Test A','starter','active'),('bbbbbbbb-0000-4000-8000-000000000002','test_b','Test B','starter','active');
INSERT INTO public.locations(id,org_id,slug,name) VALUES ('cccccccc-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000001','test_a1','A1'),('cccccccc-0000-4000-8000-000000000002','bbbbbbbb-0000-4000-8000-000000000001','test_a2','A2'),('cccccccc-0000-4000-8000-000000000003','bbbbbbbb-0000-4000-8000-000000000002','test_b1','B1');
INSERT INTO public.organization_members(id,org_id,user_id,role) VALUES ('dddddddd-0000-4000-8000-000000000001','bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000001','owner'),('dddddddd-0000-4000-8000-000000000003','bbbbbbbb-0000-4000-8000-000000000001','aaaaaaaa-0000-4000-8000-000000000003','staff');
