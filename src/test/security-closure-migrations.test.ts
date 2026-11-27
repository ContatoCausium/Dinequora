// 0034 (platform owner assignment) and 0035 (justification privacy): file-level review aids and the
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
const M0019 = mig("0019_permission_performance.sql");
const M0033 = mig("0033_member_grant_integrity_and_pending_hardening.sql");
const M0034 = mig("0034_platform_owner_assignment_guard.sql");
const M0035 = mig("0035_pending_sale_reason_privacy.sql");
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

describe("journal (0034, 0035)", () => {
  it("both entries follow 0033 with strictly increasing `when` (the migrator skips an entry at or below the last applied one)", () => {
    const tags = journal.entries.map((e) => e.tag);
    const i = tags.indexOf("0034_platform_owner_assignment_guard");
    expect(tags.slice(i - 1, i + 2)).toEqual([
      "0033_member_grant_integrity_and_pending_hardening",
      "0034_platform_owner_assignment_guard",
      "0035_pending_sale_reason_privacy",
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

describe("0035 justification privacy", () => {
  it("is pure ASCII, sets the lock wait limit first and is idempotent (re-run by the M2 re-application)", () => {
    expect(M0035.split("\n").filter((l) => /[^\x20-\x7e]/.test(l.replace(/\t/g, " ")))).toEqual([]);
    expect(firstStatement(M0035)).toBe("set local lock_timeout = '5s';");
    const c = code(M0035);
    expect(c).not.toMatch(/create table (?!if not exists)/i);
    expect(c).not.toMatch(/create index (?!if not exists)/i);
    expect(c).not.toMatch(/create policy/i);
    expect(c).not.toMatch(/drop\s+trigger/i);
    expect(c).not.toMatch(/drop\s+table\s+(?!if exists pg_temp\.)/i); // only its own temporary tables
    // no ACCESS EXCLUSIVE lock on the closed keys, read by every sale
    expect(c).not.toMatch(/alter\s+table\s+public\.pos_sale_key_voids/i);
  });

  it("replaces the function and the policy BEFORE moving the texts (the move runs last, under the policy's lock)", () => {
    const fnAt = M0035.indexOf("create or replace function public.resolve_pending_pos_sale(");
    const policyAt = M0035.indexOf('alter policy "Org managers read org audit"');
    const moveAt = M0035.indexOf("create temporary table m2r_move");
    expect(fnAt).toBeGreaterThan(0);
    expect(policyAt).toBeGreaterThan(fnAt);
    expect(moveAt).toBeGreaterThan(policyAt);
  });

  it("the private store has no API privilege and no policy", () => {
    expect(M0035).toContain(
      "alter table public.pos_pending_resolution_reasons enable row level security;",
    );
    expect(M0035).toContain(
      "revoke all on table public.pos_pending_resolution_reasons from public, anon, authenticated;",
    );
    expect(code(M0035)).not.toMatch(
      /grant [^;]*pos_pending_resolution_reasons[^;]*to (anon|authenticated)/i,
    );
  });

  it("closed keys: the API reads four structured columns, never the text", () => {
    expect(M0035).toContain("revoke select on table public.pos_sale_key_voids from authenticated;");
    expect(M0035).toContain(
      "grant select (org_id, client_order_id, location_id, created_at) on table public.pos_sale_key_voids to authenticated;",
    );
  });

  it("the resolution RPC differs from 0033 only where it stores the text", () => {
    const header = "create or replace function public.resolve_pending_pos_sale(";
    const before = fn(M0033, header).split("\n");
    const after = fn(M0035, header).split("\n");
    const removed = before.filter((l) => !after.includes(l));
    const added = after.filter((l) => !before.includes(l));
    expect(removed.map((l) => l.trim())).toEqual([
      "jsonb_build_object('order_id', o.id, 'order_status', o.status, 'paid', paid, 'reason', why,",
      "'requested_location_id', _location_id));",
      "values (_org_id, k, _location_id, auth.uid(), why, _amount_cents, _attempts, _last_attempt_at);",
      "jsonb_build_object('reason', why, 'amount_cents', _amount_cents, 'attempts', _attempts,",
      "'last_attempt_at', _last_attempt_at));",
    ]);
    const addedCode = added.filter((l) => !l.trim().startsWith("--"));
    expect(addedCode.join("\n")).not.toMatch(/'reason',/);
    expect(addedCode.join("\n")).toContain("'[moved to pos_pending_resolution_reasons]',");
    expect(
      addedCode.join("\n").match(/insert into public\.pos_pending_resolution_reasons/g),
    ).toHaveLength(2);
    // every check of 0033 is still there, unchanged
    for (const kept of [
      "raise exception 'isolation_unsupported'",
      "perform public.assert_permission(_org_id, 'orders.resolve_pending', _location_id);",
      "perform public.assert_org_operational(_org_id);",
      "perform pg_advisory_xact_lock(hashtextextended(_org_id::text || ':' || k, 0));",
      "if o.location_id <> _location_id then raise exception 'location_forbidden'; end if;",
      "if v.location_id <> _location_id then raise exception 'location_forbidden'; end if;",
    ])
      expect(after.join("\n")).toContain(kept);
  });

  it("the reader requires membership of tier owner/manager, a store of the organization and the permission at that store", () => {
    const body = code(fn(M0035, "create or replace function public.list_pending_sale_reasons("));
    order(body, [
      "if auth.uid() is null then raise exception 'forbidden'",
      "_me := public.my_member(_org_id);",
      "_me.role not in ('owner', 'manager') then raise exception 'forbidden'",
      "public.location_in_org(_location_id, _org_id)",
      "public.has_permission(_org_id, 'orders.resolve_pending', _location_id)",
      "where r.org_id = _org_id",
      "and r.location_id = _location_id",
      "limit least(greatest(coalesce(_limit, 50), 1), 200)",
    ]);
    expect(body).toMatch(/\bstable\b/);
    expect(body).not.toMatch(/\b(insert|update|delete)\b/i);
    expect(M0035).toContain(
      "revoke all on function public.list_pending_sale_reasons(uuid, uuid, text, integer) from public, anon;",
    );
  });

  it("moves the stored texts (never deletes a row), verifies and audits the move", () => {
    const c = code(M0035);
    expect(c).not.toMatch(/delete\s+from\s+public\./i);
    expect(c).toContain("raise exception 'pending_reason_move_incomplete'");
    expect(c).toContain("'pos.pending_reasons_moved'");
    expect(c).toContain("set metadata = (a.metadata - 'reason')");
  });

  it("the activity log keeps the 0019 condition and adds the store scope", () => {
    const prev = fn(
      M0019,
      'alter policy "Org managers read org audit" on public.audit_logs using (',
      "])));",
    );
    expect(prev).toContain("orgs_with_any_permission(array['team.activity'])");
    const now = fn(
      M0035,
      'alter policy "Org managers read org audit" on public.audit_logs using (',
      ");\n",
    );
    expect(now).toContain(
      "org_id in (select public.orgs_with_any_permission(array['team.activity']))",
    );
    // evaluated once per statement (hashed subplan), not one function call per row
    expect(now).toContain(
      "and (location_id is null or location_id in (select public.audit_visible_location_ids())));",
    );
    const helper = code(
      fn(M0035, "create or replace function public.audit_visible_location_ids()", "$$;"),
    );
    expect(helper).toContain("m.user_id = auth.uid()");
    expect(helper).toContain("where m.role = 'owner'");
    expect(helper).toContain("a.member_id = m.id and a.location_id = l.id");
  });
});

describe("security closure rollback files", () => {
  const built = buildSecurityClosureRollbackFiles();
  const committed = (name: string) => read(`docs/operations/security-closure/${name}.sql`);

  it("the committed files are exactly the generated ones", () => {
    expect(committed("0034-rollback")).toBe(built["0034-rollback"]);
    expect(committed("0035-rollback")).toBe(built["0035-rollback"]);
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

  it("0035 rollback: exact 0033 body only if the function still exists, 0019 policy, and an explicit WARNING", () => {
    const s = built["0035-rollback"];
    const body = fn(M0033, "create or replace function public.resolve_pending_pos_sale(");
    expect(s).toContain(body.slice(0, -1)); // inside EXECUTE, without its final semicolon
    expect(s).toContain(
      "if to_regprocedure('public.resolve_pending_pos_sale(uuid, uuid, text, text, integer, integer, timestamptz)') is not null then",
    );
    expect(s).toContain(
      fn(M0019, 'alter policy "Org managers read org audit" on public.audit_logs using (', "])));"),
    );
    expect(s).toContain("drop function if exists public.audit_visible_location_ids();");
    expect(s).toContain("WARNING: until 0035 is applied again this WIDENS ACCESS for new events");
    // outside the restored function body: no write, no privilege, no touch of the private store
    const c = code(s.replace(body.slice(0, -1), ""));
    expect(c).not.toMatch(/pos_pending_resolution_reasons/);
    expect(c).not.toMatch(/\bgrant\b|\brevoke\b/i);
    expect(c).not.toMatch(/^\s*(update|insert|delete)\b/im);
  });
});
