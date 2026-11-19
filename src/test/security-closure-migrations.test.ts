// 0034 (platform owner assignment): file-level review aids and the
// generated rollbacks. The database behaviour is covered by scripts/security/admin_assign_owner_integrity.mjs,
// pending_reason_privacy.mjs, security_closure_rollback.mjs, m2_rollback_reapply.mjs and
// src/test/integration/pos-pending-resolution.db.test.ts.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildSecurityClosureRollbackFiles } from "../../scripts/qa/build-m2-rollback.mjs";

const read = (rel: string) =>
  fs.readFileSync(path.resolve(__dirname, "../..", rel), "utf8").replace(/\r\n/g, "\n");
const mig = (name: string) => read(`drizzle/migrations/${name}`);
const M0001 = mig("0001_tenant_hardening_audit_control_center.sql");
const M0034 = mig("0034_platform_owner_assignment_guard.sql");
const journal = JSON.parse(read("drizzle/migrations/meta/_journal.json")) as {
  entries: { idx: number; tag: string; when: number }[];
};

function fn(src: string, header: string, end = "end $$;"): string {
  const start = src.indexOf(header);
  expect(start, header).toBeGreaterThanOrEqual(0);
  expect(src.indexOf(header, start + 1), `${header} defined twice`).toBe(-1);
  return src.slice(start, src.indexOf(end, start) + end.length);
}
const code = (src: string) =>
  src
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
const firstStatement = (src: string) =>
  src
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith("--"));
const order = (src: string, parts: string[]) => {
  let at = -1;
  for (const p of parts) {
    const i = src.indexOf(p, at + 1);
    expect(i, `"${p}" after the previous check`).toBeGreaterThan(at);
    at = i;
  }
};

describe("journal (0034)", () => {
  it("both entries follow 0033 with strictly increasing `when` (the migrator skips an entry at or below the last applied one)", () => {
    const tags = journal.entries.map((e) => e.tag);
    const i = tags.indexOf("0034_platform_owner_assignment_guard");
    expect(tags.slice(i - 1, i + 1)).toEqual([
      "0033_member_grant_integrity_and_pending_hardening",
      "0034_platform_owner_assignment_guard",
    ]);
    for (let k = 1; k < journal.entries.length; k++)
      expect(journal.entries[k]!.when).toBeGreaterThan(journal.entries[k - 1]!.when);
  });
});

describe("0034 platform owner assignment", () => {
  const body = fn(M0034, "create or replace function public.admin_assign_owner(");

  it("is pure ASCII and sets the lock wait limit first", () => {
    expect(M0034.split("\n").filter((l) => /[^\x20-\x7e]/.test(l.replace(/\t/g, " ")))).toEqual([]);
    expect(firstStatement(M0034)).toBe("set local lock_timeout = '5s';");
  });

  it("checks in a safe order: role, isolation, note, lock, organization row, active owner, account, self, account lock, platform role", () => {
    order(code(body), [
      "if not public.is_platform_admin() then raise exception 'forbidden'",
      "current_setting('transaction_isolation') not in ('read committed', 'read uncommitted')",
      "raise exception 'verification_required'",
      "pg_advisory_xact_lock(hashtextextended('org_owner:' || _org_id::text, 0))",
      "for no key update",
      "u.deleted_at is null",
      "raise exception 'owner_exists'",
      "email_confirmed_at is not null and deleted_at is null",
      "raise exception 'user_not_found'",
      "raise exception 'user_ambiguous'",
      "raise exception 'self_assignment_forbidden'",
      "pg_advisory_xact_lock(hashtextextended('platform_user:' || _uid::text, 0))",
      "from public.user_roles where user_id = _uid",
      "raise exception 'platform_user_forbidden'",
      "insert into public.organization_members",
      "'platform.owner_assigned'",
    ]);
  });

  it("a platform role is refused for an owner of a customer organization, on every path (trigger), under the same account lock", () => {
    const trg = fn(M0034, "create or replace function public.trg_platform_role_separation()");
    order(code(trg), [
      "raise exception 'isolation_unsupported'",
      "pg_advisory_xact_lock(hashtextextended('platform_user:' || new.user_id::text, 0))",
      "m.role = 'owner' and not o.is_demo",
      "raise exception 'platform_role_owner_conflict'",
    ]);
    expect(trg).toContain("security definer");
    expect(M0034).toContain("create or replace trigger platform_role_separation");
    expect(M0034).toContain("before insert or update of user_id, role on public.user_roles");
    expect(M0034).toContain(
      "revoke all on function public.trg_platform_role_separation() from public, anon, authenticated;",
    );
  });

  it("an account with a platform role never becomes owner of a customer organization, by any path (deferred check at commit)", () => {
    const trg = fn(M0034, "create or replace function public.trg_owner_platform_separation()");
    order(code(trg), [
      "raise exception 'isolation_unsupported'",
      "pg_advisory_xact_lock(hashtextextended('platform_user:' || new.user_id::text, 0))",
      "where m.id = new.id and m.role = 'owner' and not o.is_demo",
      "exists (select 1 from public.user_roles r where r.user_id = new.user_id)",
      "raise exception 'platform_role_owner_conflict'",
    ]);
    expect(trg).toContain("security definer");
    expect(M0034).toContain("create constraint trigger owner_platform_separation");
    expect(M0034).toContain("after insert or update of role on public.organization_members");
    expect(M0034).toContain("deferrable initially deferred");
    // created once, never dropped (idempotent without an ACCESS EXCLUSIVE lock)
    expect(M0034).toContain("if not exists (select 1 from pg_trigger");
  });

  it("admin_set_platform_role: the 0001 body plus one account per e-mail and no grant to a deleted account", () => {
    const before = fn(M0001, "create or replace function public.admin_set_platform_role(");
    const after = fn(M0034, "create or replace function public.admin_set_platform_role(");
    const removed = before.split("\n").filter((l) => !after.split("\n").includes(l));
    expect(removed.map((l) => l.trim())).toEqual([
      "declare _uid uuid;",
      "select id into _uid from auth.users where lower(email) = lower(trim(_email)) and email_confirmed_at is not null;",
      "if _uid is null then raise exception 'user_not_found'; end if;",
    ]);
    expect(after).toContain("raise exception 'user_ambiguous'");
    expect(after).toContain("and (not _grant or deleted_at is null)");
  });

  it("never removes or demotes anyone: the only write is the insert / promotion of the target", () => {
    const c = code(body);
    expect(c).not.toMatch(/delete\s+from/i);
    // no UPDATE statement: the only update is ON CONFLICT ... DO UPDATE (and the FOR NO KEY UPDATE lock)
    expect(c).not.toMatch(/\bupdate\s+public\./i);
    expect(c).toContain("on conflict (org_id, user_id) do update set role = 'owner';");
  });

  it("every other way to become owner takes the same per-organization lock (trigger), not callable by API roles", () => {
    const trg = fn(M0034, "create or replace function public.trg_member_owner_serialize()");
    expect(trg).toContain(
      "pg_advisory_xact_lock(hashtextextended('org_owner:' || new.org_id::text, 0))",
    );
    expect(M0034).toContain(
      "revoke all on function public.trg_member_owner_serialize() from public, anon, authenticated;",
    );
    // CREATE OR REPLACE TRIGGER (SHARE ROW EXCLUSIVE), never DROP TRIGGER (ACCESS EXCLUSIVE)
    expect(code(M0034)).not.toMatch(/drop\s+trigger/i);
    expect(M0034).toContain("create or replace trigger member_owner_serialize");
    expect(M0034).toContain("before insert or update of role on public.organization_members");
    expect(M0034).toContain("for each row when (new.role = 'owner')");
  });

  it("keeps the signature and the grants of 0001", () => {
    expect(M0001).toContain(
      "create or replace function public.admin_assign_owner(_org_id uuid, _email text, _verification_note text)",
    );
    expect(body).toContain(
      "public.admin_assign_owner(_org_id uuid, _email text, _verification_note text)",
    );
    expect(M0034).toContain(
      "revoke all on function public.admin_assign_owner(uuid, text, text) from public, anon;",
    );
    expect(M0034).toContain(
      "grant execute on function public.admin_assign_owner(uuid, text, text) to authenticated;",
    );
  });
});

describe("security closure rollback files", () => {
  const built = buildSecurityClosureRollbackFiles();
  const committed = (name: string) => read(`docs/operations/security-closure/${name}.sql`);

  it("the committed files are exactly the generated ones", () => {
    expect(committed("0034-rollback")).toBe(built["0034-rollback"]);
  });

  it("run inside the runner's transaction: no BEGIN/COMMIT, the lock wait limit first, never CASCADE", () => {
    for (const sql of Object.values(built)) {
      expect(code(sql)).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
      expect(firstStatement(sql)).toBe("set local lock_timeout = '5s';");
      expect(sql).not.toMatch(/cascade/i);
    }
  });

  it("0034 rollback restores the exact 0001 bodies", () => {
    expect(built["0034-rollback"]).toContain(
      fn(M0001, "create or replace function public.admin_assign_owner("),
    );
    expect(built["0034-rollback"]).toContain(
      fn(M0001, "create or replace function public.admin_set_platform_role("),
    );
    // no DROP TRIGGER (ACCESS EXCLUSIVE on organization_members): the three functions become no-ops
    const s = built["0034-rollback"];
    expect(code(s)).not.toMatch(/drop\s+trigger/i);
    for (const [f, ret] of [
      ["trg_member_owner_serialize", "return new;"],
      ["trg_platform_role_separation", "return new;"],
      ["trg_owner_platform_separation", "return null;"],
    ] as const) {
      const body = code(fn(s, `create or replace function public.${f}()`));
      expect(body).toContain(ret);
      expect(body).not.toMatch(/pg_advisory_xact_lock|raise exception/);
    }
    expect(s).toContain("WARNING: this restores the escalation 0034 closed");
  });
});
