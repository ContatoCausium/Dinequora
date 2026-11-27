// The hosted privilege contract (scripts/qa/api-privileges.hosted.json) and the SQL that puts a test
// stack in the hosted model: offline invariants, so a careless regeneration of the manifest cannot
// quietly widen access. The database side is scripts/security/api_privileges.mjs (suite steps 2c/9b).
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const manifest = JSON.parse(read("scripts/qa/api-privileges.hosted.json")) as {
  defaultPrivilegesOfPostgres: Record<string, string>;
  privileges: string[];
};
const P = manifest.privileges;
const rows = P.map((x) => {
  const [kind, object, role, privilege] = x.split("|");
  return { kind: kind!, object: object!, role: role!, privilege: privilege! };
});

describe("hosted privilege manifest", () => {
  it("is a sorted list of unique kind|object|role|privilege entries for the three API roles", () => {
    expect([...P].sort()).toEqual(P);
    expect(new Set(P).size).toBe(P.length);
    for (const r of rows) {
      expect(["table", "column", "function", "sequence", "schema"]).toContain(r.kind);
      expect(["anon", "authenticated", "service_role"]).toContain(r.role);
    }
  });

  it("the API roles use schema public and none can create objects in it", () => {
    expect(rows.filter((r) => r.kind === "schema").map((r) => `${r.role}:${r.privilege}`)).toEqual([
      "anon:USAGE",
      "authenticated:USAGE",
      "service_role:USAGE",
    ]);
  });

  it("anon executes a closed list of functions: auth.uid() predicates, catalog data, the invitation lookup, trigger functions", () => {
    expect(
      rows
        .filter((r) => r.kind === "function" && r.role === "anon")
        .map((r) => r.object.split("(")[0]),
    ).toEqual([
      "active_store_count",
      "assert_org_operational",
      "can_manage_member",
      "can_manage_org",
      "can_operate_location",
      "get_invitation",
      "handle_new_user",
      "has_platform_role",
      "is_org_member",
      "is_org_owner",
      "org_is_operational",
      "permission_catalog",
      "role_ceiling",
      "role_default_permissions",
      "shares_org_with",
      "trg_invitations_audit",
      "trg_members_audit",
      "trg_subscription_sync",
    ]);
  });

  it("records the default privileges read from the hosted Client Preview: nothing for the API roles but Dxtm on tables", () => {
    expect(manifest.defaultPrivilegesOfPostgres).toEqual({
      S: "postgres=rwU/postgres",
      f: "postgres=X/postgres",
      r: "postgres=arwdDxtm/postgres,anon=Dxtm/postgres,authenticated=Dxtm/postgres,service_role=Dxtm/postgres",
    });
  });

  it("anon reads and writes no table and no column", () => {
    expect(
      rows.filter(
        (r) =>
          r.role === "anon" &&
          r.kind !== "function" &&
          ["SELECT", "INSERT", "UPDATE", "DELETE"].includes(r.privilege),
      ),
    ).toEqual([]);
  });

  it("the only direct write of authenticated, table-level or column-level, is UPDATE on profiles", () => {
    expect(
      rows
        .filter(
          (r) =>
            r.role === "authenticated" &&
            (r.kind === "table" || r.kind === "column") &&
            ["INSERT", "UPDATE", "DELETE"].includes(r.privilege),
        )
        .map((r) => `${r.kind}:${r.object}:${r.privilege}`),
    ).toEqual(["table:profiles:UPDATE"]);
  });

  it("no API role executes a retired sale RPC or a trigger function of the security migrations", () => {
    const blocked = [
      "create_pos_sale(",
      "finalize_pos_sale_atomic(",
      "persist_finalized_pos_sale_atomic(",
      "trg_member_grant_integrity(",
      "trg_member_owner_serialize(",
      "trg_platform_role_separation(",
      "trg_owner_platform_separation(",
    ];
    expect(
      rows.filter((r) => r.kind === "function" && blocked.some((b) => r.object.startsWith(b))),
    ).toEqual([]);
  });

  it("the current sale flow and the resolution RPCs are executable by authenticated only", () => {
    for (const f of [
      "create_pos_sale_v2(",
      "finalize_pos_sale_atomic_v2(",
      "persist_finalized_pos_sale_atomic_v2(",
      "resolve_pending_pos_sale(",
      "list_pending_sale_reasons(",
    ]) {
      const who = rows
        .filter((r) => r.kind === "function" && r.object.startsWith(f))
        .map((r) => r.role);
      expect(who, f).toEqual(["authenticated"]);
    }
  });

  it("justifications: no API privilege on the private store for anon/authenticated; closed keys expose four columns to authenticated", () => {
    expect(
      rows.filter(
        (r) => r.object.startsWith("pos_pending_resolution_reasons") && r.role !== "service_role",
      ),
    ).toEqual([]);
    expect(
      rows
        .filter(
          (r) =>
            r.kind === "column" &&
            r.object.startsWith("pos_sale_key_voids.") &&
            r.role === "authenticated",
        )
        .map((r) => r.object.split(".")[1]),
    ).toEqual(["client_order_id", "created_at", "location_id", "org_id"]);
    expect(P).not.toContain("table|pos_sale_key_voids|authenticated|SELECT");
  });

  it("billing and bootstrap tables are not selectable by signed-in users at the privilege level", () => {
    for (const t of ["stripe_webhook_events", "platform_bootstrap"])
      expect(
        rows.filter((r) => r.object.split(".")[0] === t && r.role !== "service_role"),
        t,
      ).toEqual(
        rows.filter(
          (r) =>
            r.object === t &&
            r.role !== "service_role" &&
            ["TRUNCATE", "REFERENCES", "TRIGGER", "MAINTAIN"].includes(r.privilege),
        ),
      );
    for (const t of ["subscriptions", "billing_plans", "billing_events"])
      expect(P, t).not.toContain(`table|${t}|authenticated|UPDATE`);
  });
});

describe("scripts/qa/hosted-default-privileges.sql", () => {
  const sql = read("scripts/qa/hosted-default-privileges.sql");
  const code = sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

  it("checks the target guard and an empty schema before changing anything", () => {
    const guard = code.indexOf("dq_guard.attest('suite:privilege-model')");
    const first = code.search(/alter default privileges/i);
    expect(guard).toBeGreaterThan(0);
    expect(first).toBeGreaterThan(guard);
    expect(code).toContain("the privilege model is applied before the migrations");
  });

  it("only narrows the default privileges of role postgres in schema public (never grants data access)", () => {
    const statements = code.match(/alter default privileges[^;]+;/gi) ?? [];
    expect(statements).toHaveLength(4);
    for (const s of statements)
      expect(s).toMatch(/^alter default privileges for role postgres in schema public /i);
    const grants = statements.filter((s) => /\bgrant\b/i.test(s));
    expect(grants).toEqual([
      "ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT TRUNCATE, REFERENCES, TRIGGER, MAINTAIN ON TABLES TO anon, authenticated, service_role;",
    ]);
    expect(code).not.toMatch(/\bgrant\s+(all|select|insert|update|delete|execute|usage)\b/i);
  });
});
