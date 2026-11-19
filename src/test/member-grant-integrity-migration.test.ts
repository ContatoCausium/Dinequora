// 0031 lock wait limit and 0033 (M1 and the review's paths, H1, B4): file-level review aids. Each
// redefined function must differ from its previous definition ONLY by the lines marked for 0033; the
// database behaviour is covered by scripts/security/member_grant_integrity.mjs,
// pos_pending_resolution_race.mjs, m2_rollback_reapply.mjs and the integration tests.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (name: string) =>
  fs
    .readFileSync(path.resolve(__dirname, "../../drizzle/migrations", name), "utf8")
    .replace(/\r\n/g, "\n");
const M0018 = read("0018_member_permissions.sql");
const M0031 = read("0031_ledger_day_totals.sql");
const M0032 = read("0032_pos_pending_sale_resolution.sql");
const M0033 = read("0033_member_grant_integrity_and_pending_hardening.sql");

/** The text of one function definition, from its CREATE line to the end of its body. */
function fn(src: string, header: string, end: string): string {
  const start = src.indexOf(header);
  expect(start, header).toBeGreaterThanOrEqual(0);
  expect(src.indexOf(header, start + 1), `${header} defined twice`).toBe(-1);
  return src.slice(start, src.indexOf(end, start) + end.length);
}
/** Lines removed from `before` and added in `after` (compared by content). */
function diff(before: string, after: string) {
  const b = before.split("\n");
  const a = after.split("\n");
  return { removed: b.filter((l) => !a.includes(l)), added: a.filter((l) => !b.includes(l)) };
}
const firstStatement = (src: string) =>
  src
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("--"));
const code = (lines: string[]) => lines.filter((l) => !l.trim().startsWith("--"));

describe("lock wait limit", () => {
  it("is the first statement of 0031 and of 0033 (SET LOCAL: the migration run's transaction)", () => {
    expect(firstStatement(M0031)).toBe("set local lock_timeout = '5s';");
    expect(firstStatement(M0033)).toBe("set local lock_timeout = '5s';");
  });

  it("0033 takes no ACCESS EXCLUSIVE lock on organization_members (no DROP TRIGGER)", () => {
    expect(code(M0033.split("\n")).join("\n")).not.toMatch(/drop\s+trigger/i);
    expect(M0033).toContain("create or replace trigger member_ceiling_grants");
  });

  it("0033 is plain ASCII (no invisible or look-alike characters)", () => {
    const nonAscii = M0033.split("\n").filter((l) => /[^\x20-\x7e]/.test(l.replace(/\t/g, " ")));
    expect(nonAscii).toEqual([]);
  });
});

describe("0033 member grants", () => {
  it("set_member_access = the 0018 body plus the request checks and the revocation rule", () => {
    const header = "create or replace function public.set_member_access(";
    const { removed, added } = diff(fn(M0018, header, "end $$;"), fn(M0033, header, "end $$;"));
    // the only line replaced: revocations now keep entries no longer in the catalog
    expect(removed).toEqual([
      "         revoked_permissions = case when _role = 'owner' then '{}' else array(select distinct p from unnest(coalesce(_revoked, '{}')) p) end",
    ]);
    expect(code(added)).toEqual([
      "  if array_position(coalesce(_extra, '{}') || coalesce(_revoked, '{}'), null) is not null then",
      "    raise exception 'invalid_permission'; end if;",
      "  if _role <> 'owner' and exists (select 1 from unnest(coalesce(_extra, '{}')) p",
      "             where not p = any(public.role_ceiling(_role))) then raise exception 'permission_outside_role'; end if;",
      "  if _me.role = 'manager' and exists (select 1 from unnest(coalesce(_extra, '{}')) p",
      "             where not p = any(public.member_permissions(_me.id))) then raise exception 'permission_exceeds_own'; end if;",
      "    if _me.role = 'manager' and exists (select 1 from unnest(_p.permissions) p",
      "        where p = any(public.role_ceiling(_role)) and not p = any(public.member_permissions(_me.id))) then",
      "      raise exception 'permission_exceeds_own'; end if;",
      "         revoked_permissions = case when _role = 'owner' then '{}' else array(select distinct p from unnest(coalesce(_revoked, '{}')",
      "           || array(select r from unnest(_t.revoked_permissions) r where not r = any(public.permission_catalog()))) p) end",
    ]);
  });

  it("create_invitation = the 0018 body plus the manager's request check", () => {
    const header = "CREATE OR REPLACE FUNCTION public.create_invitation(";
    const { removed, added } = diff(
      fn(M0018, header, "end $function$;"),
      fn(M0033, header, "end $function$;"),
    );
    expect(removed).toEqual([]);
    expect(code(added)).toEqual([
      "  if _me.role = 'manager' and exists (select 1 from unnest(public.effective_permissions_for(_role, _profile_id, '{}', '{}')) p",
      "      where not p = any(public.member_permissions(_me.id))) then raise exception 'permission_exceeds_own'; end if;",
    ]);
  });

  it("save_permission_profile = the 0018 body plus the pending-invitation tier check", () => {
    const header = "create or replace function public.save_permission_profile(";
    const { removed, added } = diff(fn(M0018, header, "end $$;"), fn(M0033, header, "end $$;"));
    expect(removed).toEqual([]);
    expect(code(added)).toEqual([
      "    if exists (select 1 from public.invitations where profile_id = _pid and role <> _tier",
      "                 and accepted_at is null and revoked_at is null) then",
    ]);
  });

  it("the integrity trigger is not callable by API roles and fires on role, profile and grant changes", () => {
    expect(M0033).toContain(
      "revoke all on function public.trg_member_grant_integrity() from public, anon, authenticated;",
    );
    expect(M0033).toContain(
      "before insert or update of role, profile_id, extra_permissions on public.organization_members",
    );
    // the data clean-up never changes an effective permission set (it aborts instead)
    expect(M0033).toContain("raise exception 'member % would change effective permissions");
  });
});

describe("0033 pending sale (H1, B4)", () => {
  const ISOLATION =
    "IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN RAISE EXCEPTION 'isolation_unsupported'; END IF;";

  it("create_pos_sale_v2 = the 0032 body plus ONE line, before the key's lock", () => {
    const header = "CREATE OR REPLACE FUNCTION public.create_pos_sale_v2(";
    const after = fn(M0033, header, "$function$;");
    const { removed, added } = diff(fn(M0032, header, "$function$;"), after);
    expect(removed).toEqual([]);
    expect(added).toEqual([ISOLATION]);
    expect(after.indexOf(ISOLATION)).toBeLessThan(after.indexOf("pg_advisory_xact_lock"));
  });

  it("resolve_pending_pos_sale = the 0032 body plus isolation, organization, store and justification checks", () => {
    const header = "create or replace function public.resolve_pending_pos_sale(";
    const before = fn(M0032, header, "end $$;");
    const after = fn(M0033, header, "end $$;");
    const { removed, added } = diff(before, after);
    expect(removed).toEqual([
      "  why text := btrim(coalesce(_reason, ''));",
      "  if length(why) not between 10 and 500 then raise exception 'reason_required'; end if;",
    ]);
    const body = code(added).join("\n");
    expect(body).toContain("raise exception 'isolation_unsupported'");
    expect(body).toContain("perform public.assert_org_operational(_org_id);");
    expect(body).toContain(
      "if o.location_id <> _location_id then raise exception 'location_forbidden'; end if;",
    );
    expect(body).toContain(
      "if v.location_id <> _location_id then raise exception 'location_forbidden'; end if;",
    );
    expect(body).toContain(
      "why := regexp_replace(coalesce(_reason, ''), '^' || ws || '+|' || ws || '+$', '', 'g');",
    );
    expect(body).toContain("'[^[:alnum:]]', '', 'g')) < 5 then");
    // order: isolation before everything, the organization check before the lock, lock unchanged
    expect(after.indexOf("isolation_unsupported")).toBeLessThan(
      after.indexOf("auth.uid() is null"),
    );
    expect(after.indexOf("assert_org_operational")).toBeLessThan(
      after.indexOf("pg_advisory_xact_lock"),
    );
    expect(after).toContain(
      "perform pg_advisory_xact_lock(hashtextextended(_org_id::text || ':' || k, 0));",
    );
  });
});
