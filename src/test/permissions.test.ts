import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  PERMISSION_CATALOG,
  effectivePermissions,
  isPermissionDenied,
  roleCeiling,
  roleDefaults,
} from "@/lib/permissions";
import { requiredFor } from "@/lib/route-permissions";

const migration = (name: string) =>
  fs.readFileSync(path.resolve(__dirname, "../../drizzle/migrations", name), "utf8");
const MIGRATION = migration("0018_member_permissions.sql");
/** 0020 added inventory.costs. */
const COSTS_MIGRATION = migration("0020_inventory_cost_permission.sql");
/** Latest definition of the catalog (0032 added orders.resolve_pending). */
const PENDING_MIGRATION = migration("0032_pos_pending_sale_resolution.sql");
/** Latest definition of the catalog (0037 added the tables module). */
const TABLES_MIGRATION = migration("0037_dining_room_tables.sql");

describe("permission catalog parity with the database", () => {
  it("TS catalog equals the latest public.permission_catalog() (migration 0037)", () => {
    const body = TABLES_MIGRATION.slice(
      TABLES_MIGRATION.indexOf("function public.permission_catalog()"),
    );
    const literal = body.slice(body.indexOf("array["), body.indexOf("]::text[]"));
    const sqlCatalog = [...literal.matchAll(/'([a-z]+\.[a-z_]+)'/g)].map((m) => m[1]);
    expect(sqlCatalog).toEqual([...PERMISSION_CATALOG]);
  });

  it("system profiles only reference catalog permissions within their tier", () => {
    const seed = MIGRATION.slice(
      MIGRATION.indexOf("insert into public.permission_profiles"),
      MIGRATION.indexOf("on conflict do nothing"),
    );
    for (const row of seed.split("(null,").slice(1)) {
      const tier = /'(manager|staff)'/.exec(row)?.[1] as "manager" | "staff";
      const perms = [...row.matchAll(/'([a-z]+\.[a-z_]+)'/g)].map((m) => m[1]!);
      for (const p of perms) expect(roleCeiling(tier)).toContain(p);
    }
  });
});

describe("pending POS sale resolution permission (migration 0032)", () => {
  it("is its own permission, never orders.refund", () => {
    expect(PERMISSION_CATALOG).toContain("orders.resolve_pending");
    expect(PERMISSION_CATALOG).toContain("orders.refund");
  });
  it("owner always; manager only by explicit grant; staff never (not even through a grant)", () => {
    expect(roleDefaults("owner")).toContain("orders.resolve_pending");
    expect(roleCeiling("manager")).toContain("orders.resolve_pending");
    expect(roleDefaults("manager")).not.toContain("orders.resolve_pending");
    expect(roleCeiling("staff")).not.toContain("orders.resolve_pending");
    expect(
      effectivePermissions({ role: "manager", profilePermissions: null, extra: [], revoked: [] }),
    ).not.toContain("orders.resolve_pending");
    expect(
      effectivePermissions({
        role: "manager",
        profilePermissions: null,
        extra: ["orders.resolve_pending"],
        revoked: [],
      }),
    ).toContain("orders.resolve_pending");
    expect(
      effectivePermissions({
        role: "staff",
        profilePermissions: ["orders.resolve_pending"],
        extra: ["orders.resolve_pending"],
        revoked: [],
      }),
    ).not.toContain("orders.resolve_pending");
  });
  it("mirrors the database tier rules and grants it only to the org_admin template", () => {
    const ceiling = PENDING_MIGRATION.slice(
      PENDING_MIGRATION.indexOf("function public.role_ceiling"),
    );
    expect(ceiling.slice(0, ceiling.indexOf("$;"))).toContain("p <> 'orders.resolve_pending'");
    const defaults = PENDING_MIGRATION.slice(
      PENDING_MIGRATION.indexOf("function public.role_default_permissions"),
    );
    expect(defaults.slice(0, defaults.indexOf("$;"))).toContain(
      "p <> 'suppliers.edit' and p <> 'orders.resolve_pending'",
    );
    expect(PENDING_MIGRATION).toMatch(/where is_system and key = 'org_admin'/);
    expect(PENDING_MIGRATION).not.toMatch(/key in \(/);
  });
});

describe("tables permissions (migration 0037)", () => {
  const TABLES = ["tables.view", "tables.status", "tables.manage"] as const;
  it("are behind the table_service feature", () => {
    for (const p of TABLES) expect(TABLES_MIGRATION).toContain(`('${p}', 'table_service')`);
  });
  it("owner and manager hold all three by default; staff none by default, all three grantable", () => {
    for (const p of TABLES) {
      expect(roleDefaults("owner")).toContain(p);
      expect(roleDefaults("manager")).toContain(p);
      expect(roleDefaults("staff")).not.toContain(p);
      expect(roleCeiling("staff")).toContain(p);
    }
  });
  it("0037 does not redefine the tier ceiling or the defaults (they derive from the catalog)", () => {
    expect(TABLES_MIGRATION).not.toMatch(/function public\.role_ceiling/);
    expect(TABLES_MIGRATION).not.toMatch(/function public\.role_default_permissions/);
  });
  it("system profiles: org_admin and manager all three, cashier view + status", () => {
    expect(TABLES_MIGRATION).toMatch(
      /array\['tables\.view','tables\.status','tables\.manage'\]\) p order by p\)\s+where is_system and key in \('org_admin','manager'\)/,
    );
    expect(TABLES_MIGRATION).toMatch(
      /array\['tables\.view','tables\.status'\]\) p order by p\)\s+where is_system and key = 'cashier'/,
    );
  });
});

describe("inventory cost permission (migration 0020)", () => {
  it("is a separate permission that staff may receive but do not get by default", () => {
    expect(PERMISSION_CATALOG).toContain("inventory.costs");
    expect(roleCeiling("staff")).toContain("inventory.costs");
    expect(roleDefaults("staff")).not.toContain("inventory.costs");
    expect(roleDefaults("staff")).toContain("inventory.view");
  });
  it("managers and owners keep cost visibility", () => {
    expect(roleDefaults("manager")).toContain("inventory.costs");
    expect(roleDefaults("owner")).toContain("inventory.costs");
    expect(
      effectivePermissions({
        role: "owner",
        profilePermissions: [],
        extra: [],
        revoked: ["inventory.costs"],
      }),
    ).toContain("inventory.costs");
  });
  it("grants it only to the admin, manager, stock and finance templates", () => {
    const keys = /key in \(([^)]*)\)/.exec(COSTS_MIGRATION)?.[1];
    expect(keys).toBe("'org_admin','manager','stock','finance'");
  });
  it("hides the cost columns from client roles and exposes them only through gated functions", () => {
    expect(COSTS_MIGRATION).toMatch(
      /revoke select on public\.inventory_items from anon, authenticated/,
    );
    expect(COSTS_MIGRATION).toMatch(
      /revoke select on public\.inventory_movements from anon, authenticated/,
    );
    const grants = [...COSTS_MIGRATION.matchAll(/grant select \(([^)]*)\)/g)].map((m) => m[1]!);
    expect(grants).toHaveLength(2);
    for (const cols of grants) expect(cols).not.toMatch(/cost/);
    for (const fn of ["inventory_item_costs", "inventory_movement_costs"]) {
      const body = COSTS_MIGRATION.slice(COSTS_MIGRATION.indexOf(`function public.${fn}(`));
      expect(body.slice(0, body.indexOf("end $$"))).toContain(
        "has_permission(_org_id, 'inventory.costs')",
      );
    }
  });
});

describe("tier rules", () => {
  it("staff can never hold team or settings permissions", () => {
    expect(
      roleCeiling("staff").some((p) => p.startsWith("team.") || p.startsWith("settings.")),
    ).toBe(false);
  });
  it("managers never get branding or billing; owners get everything", () => {
    expect(roleCeiling("manager")).not.toContain("settings.billing");
    expect(roleCeiling("manager")).not.toContain("settings.branding");
    expect(roleCeiling("owner")).toEqual([...PERMISSION_CATALOG]);
  });
  it("tier defaults keep pre-0018 behaviour", () => {
    expect(roleDefaults("staff")).toEqual(
      expect.arrayContaining(["pos.sell", "kds.operate", "orders.update"]),
    );
    expect(roleDefaults("staff")).not.toContain("finance.view");
    expect(roleDefaults("manager")).toContain("finance.view");
    expect(roleDefaults("manager")).not.toContain("suppliers.edit");
  });
});

describe("effective permissions", () => {
  it("profile + extra − revoked, capped by the tier ceiling", () => {
    const eff = effectivePermissions({
      role: "staff",
      profilePermissions: ["pos.view", "pos.sell", "pos.discount"],
      extra: ["orders.refund", "team.manage", "settings.billing"],
      revoked: ["pos.discount"],
    });
    expect(eff).toEqual(["pos.view", "pos.sell", "orders.refund"]);
  });
  it("falls back to tier defaults without a profile", () => {
    expect(
      effectivePermissions({ role: "manager", profilePermissions: null, extra: [], revoked: [] }),
    ).toEqual(roleDefaults("manager"));
  });
  it("owners always have the full catalog", () => {
    expect(
      effectivePermissions({
        role: "owner",
        profilePermissions: [],
        extra: [],
        revoked: ["pos.sell"],
      }),
    ).toEqual([...PERMISSION_CATALOG]);
  });
  it("recognizes backend permission errors", () => {
    expect(isPermissionDenied(new Error("permission_denied"))).toBe(true);
    expect(isPermissionDenied(new Error("permission_exceeds_own"))).toBe(true);
    expect(isPermissionDenied(new Error("forbidden"))).toBe(false);
  });
});

describe("route permissions", () => {
  it("maps modules to the permissions that open them", () => {
    expect(requiredFor("/finance")).toEqual(["finance.view", "expenses.view"]);
    expect(requiredFor("/settings/billing")).toEqual(["settings.billing"]);
    expect(requiredFor("/pos")).toEqual(["pos.view"]);
    expect(requiredFor("/")).toBeNull();
    expect(requiredFor("/locations")).toBeNull();
    expect(requiredFor("/possible")).toBeNull(); // prefix match is segment-aware
  });
});
