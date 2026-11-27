-- 0030: explicit table privileges for public.permission_profiles.
--
-- Root cause (0018): the migration created permission_profiles, enabled RLS and the read policy
-- profiles_read (SELECT, authenticated: system templates or the member's own organizations), but
-- never granted any table privilege on it. Every other table of public carries its own explicit
-- GRANTs (0000, 0003, 0012, ...). Stacks whose default privileges expose every new table to the API
-- roles (the local Supabase CLI, the QA, the demo, CI) hid the gap; a project without those default
-- privileges (the hosted client preview) gave authenticated and service_role no access at all:
--   - the Team screen (src/lib/org-service.ts, permission profiles) failed with permission denied;
--   - the client-preview seed (scripts/preview/seed-core.mjs) stopped when the owner read the
--     system templates, after the organization and its stores had already been created.
--
-- Result, the same on every database whatever its default privileges were:
--   authenticated  SELECT only; RLS (profiles_read) still decides which rows. Writes keep going
--                  through the SECURITY DEFINER RPCs (save_permission_profile,
--                  archive_permission_profile) and the member-refresh trigger, as before.
--   service_role   all privileges, as on every other table (server scripts, security suite).
--   anon, PUBLIC   nothing (no policy ever gave them a row; now no privilege either).
-- RLS, the policy, the trigger, the RPCs and the multi-tenant rules are not changed.
revoke all on public.permission_profiles from public, anon, authenticated;
grant select on public.permission_profiles to authenticated;
grant all on public.permission_profiles to service_role;
