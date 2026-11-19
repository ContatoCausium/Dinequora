// 0031 lock wait limit and 0033 (M1, H1, B4): file-level review aids. Each redefined function must
// differ from its previous definition ONLY by the lines marked for 0033; the database behaviour is
// covered by scripts/security/member_grant_integrity.mjs, pos_pending_resolution_race.mjs and the
// integration tests.
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
/** Lines added in `after` (by content), with `before` otherwise kept in order. */
function added(before: string, after: string): string[] {
  const b = before.split("\n");
  const a = after.split("\n");
  const extra = a.filter((l) => !b.includes(l));
  expect(a.filter((l) => !extra.includes(l))).toEqual(b);
  return extra;
}
const firstStatement = (src: string) =>
  src
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("--"));

describe("lock wait limit", () => {
  it("is the first statement of 0031 and of 0033 (SET LOCAL: the migration run's transaction)", () => {
    expect(firstStatement(M0031)).toBe("set local lock_timeout = '5s';");
    expect(firstStatement(M0033)).toBe("set local lock_timeout = '5s';");
  });
});

describe("0033 member grants (M1)", () => {
  it("set_member_access = the 0018 body plus the two request checks", () => {
    const header = "create or replace function public.set_member_access(";
    const extra = added(fn(M0018, header, "end $$;"), fn(M0033, header, "end $$;"));
    expect(extra).toEqual([
      "  -- 0033: an individual grant must be one the tier can hold (never stored inert).",
      "  if _role <> 'owner' and exists (select 1 from unnest(coalesce(_extra, '{}')) p",
      "             where not p = any(public.role_ceiling(_role))) then raise exception 'permission_outside_role'; end if;",
      "  -- 0033: a manager grants only what the manager holds, checked on the request itself.",
      "  if _me.role = 'manager' and exists (select 1 from unnest(coalesce(_extra, '{}')) p",
      "             where not p = any(public.member_permissions(_me.id))) then raise exception 'permission_exceeds_own'; end if;",
    ]);
  });

  it("create_invitation = the 0018 body plus the manager's request check", () => {
    const header = "CREATE OR REPLACE FUNCTION public.create_invitation(";
    const extra = added(fn(M0018, header, "end $function$;"), fn(M0033, header, "end $function$;"));
    expect(extra).toEqual([
      "  -- 0033: a manager invites only with permissions the manager holds (the profile, or the tier defaults).",
      "  if _me.role = 'manager' and exists (select 1 from unnest(public.effective_permissions_for(_role, _profile_id, '{}', '{}')) p",
      "      where not p = any(public.member_permissions(_me.id))) then raise exception 'permission_exceeds_own'; end if;",
    ]);
  });

  it("the invariant trigger is not callable by API roles and fires on role and extras changes", () => {
    expect(M0033).toContain(
      "revoke all on function public.trg_member_extras_within_role() from public, anon, authenticated;",
    );
    expect(M0033).toContain(
      "before insert or update of role, extra_permissions on public.organization_members",
    );
  });
});

describe("0033 pending sale (H1, B4)", () => {
  const ISOLATION =
    "IF current_setting('transaction_isolation') NOT IN ('read committed','read uncommitted') THEN RAISE EXCEPTION 'isolation_unsupported'; END IF;";

  it("create_pos_sale_v2 = the 0032 body plus ONE line, before the key's lock", () => {
    const header = "CREATE OR REPLACE FUNCTION public.create_pos_sale_v2(";
    const after = fn(M0033, header, "$function$;");
    expect(added(fn(M0032, header, "$function$;"), after)).toEqual([ISOLATION]);
    expect(after.indexOf(ISOLATION)).toBeLessThan(after.indexOf("pg_advisory_xact_lock"));
  });

  it("resolve_pending_pos_sale = the 0032 body plus the isolation check and the whitespace trim", () => {
    const header = "create or replace function public.resolve_pending_pos_sale(";
    const before = fn(M0032, header, "end $$;");
    const after = fn(M0033, header, "end $$;");
    const b = before.split("\n");
    const changed = after.split("\n").filter((l) => !b.includes(l));
    // the only line replaced: the justification (btrim → every kind of whitespace)
    expect(before).toContain("  why text := btrim(coalesce(_reason, ''));");
    expect(after).not.toContain("btrim(coalesce(_reason");
    const WS =
      "[[:space:]\\u00a0\\u1680\\u180e\\u2000-\\u200d\\u2028\\u2029\\u202f\\u205f\\u2060\\u3000\\ufeff]+";
    expect(changed).toEqual([
      "  -- 0033 (B4): every kind of leading/trailing whitespace and invisible format character.",
      "  why text := regexp_replace(coalesce(_reason, ''),",
      `    '^${WS}|${WS}$',`,
      "    '', 'g');",
      "  -- 0033 (H1): only READ COMMITTED sees, under the key's lock, a sale committed meanwhile.",
      "  if current_setting('transaction_isolation') not in ('read committed', 'read uncommitted') then",
      "    raise exception 'isolation_unsupported';",
    ]);
    // isolation is checked before anything else, and the lock and order lookup are unchanged
    expect(after.indexOf("isolation_unsupported")).toBeLessThan(
      after.indexOf("auth.uid() is null"),
    );
    expect(after).toContain(
      "perform pg_advisory_xact_lock(hashtextextended(_org_id::text || ':' || k, 0));",
    );
  });
});
