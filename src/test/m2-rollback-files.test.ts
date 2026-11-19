// The M2 rollback / re-application SQL is generated from the migrations (scripts/qa/build-m2-rollback.mjs)
// and must match the committed files; its safety properties are checked here, its behaviour on a
// disposable database by the rollback rehearsal (docs/operations/m2-rollback/README.md).
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildM2RollbackFiles } from "../../scripts/qa/build-m2-rollback.mjs";

const DIR = path.resolve(__dirname, "../../docs/operations/m2-rollback");
const committed = (name: string) =>
  fs.readFileSync(path.join(DIR, `${name}.sql`), "utf8").replace(/\r\n/g, "\n");
const built = buildM2RollbackFiles();
const statements = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");

describe("M2 rollback files", () => {
  it("the committed files are exactly the generated ones (no drift from the migrations)", () => {
    expect(committed("rollback")).toBe(built.rollback);
    expect(committed("reapply")).toBe(built.reapply);
  });

  it("run inside the runner's single transaction: no BEGIN/COMMIT, a lock wait limit first", () => {
    for (const sql of [built.rollback, built.reapply]) {
      expect(statements(sql)).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
      expect(statements(sql).trim().split("\n")[0]).toBe("set local lock_timeout = '5s';");
    }
  });

  it("rollback: never CASCADE, keeps the closed keys and the revocations", () => {
    const s = statements(built.rollback);
    expect(s).not.toMatch(/cascade/i);
    expect(s).not.toMatch(/drop\s+table/i);
    expect(s).not.toMatch(/pos_sale_key_voids/);
    expect(s).not.toMatch(/revoked_permissions\s*=/);
  });

  it("rollback: strips orders.resolve_pending from EVERY profile (system and custom) and every grant", () => {
    const s = statements(built.rollback);
    const profiles = s.slice(s.indexOf("update public.permission_profiles"));
    const stmt = profiles.slice(0, profiles.indexOf(";"));
    expect(stmt).toContain("array_remove(permissions, 'orders.resolve_pending')");
    expect(stmt).not.toMatch(/is_system|key\s*=/);
    expect(s).toContain(
      "set extra_permissions = array_remove(extra_permissions, 'orders.resolve_pending')",
    );
    expect(s).toContain("drop function if exists public.resolve_pending_pos_sale(");
    expect(s).not.toMatch(/'orders\.resolve_pending'\]/); // not in the restored catalog
  });

  it("reapply: grants the permission to the system org_admin profile only", () => {
    const updates =
      statements(built.reapply).match(/update public\.permission_profiles[\s\S]*?;/g) ?? [];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain("where is_system and key = 'org_admin'");
    expect(built.reapply).toContain("create table if not exists public.pos_sale_key_voids (");
    expect(built.reapply).toContain(
      "drop policy if exists pos_voids_read on public.pos_sale_key_voids;",
    );
  });
});
