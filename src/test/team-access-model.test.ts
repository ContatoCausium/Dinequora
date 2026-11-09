import { describe, expect, it } from "vitest";

import {
  KNOWN_AUDIT_ACTIONS,
  MATRIX_COLUMNS,
  capToTier,
  cellState,
  computeAdjustments,
  diffPermissions,
  errorCode,
  exceedingOwn,
  humanizeAction,
  inheritedPermissions,
  matrixRows,
  togglePermission,
} from "@/components/team/access-model";
import {
  PERMISSION_CATALOG,
  effectivePermissions,
  roleCeiling,
  roleDefaults,
} from "@/lib/permissions";
import en from "@/locales/en-US/team.json";
import pt from "@/locales/pt-BR/team.json";

const CASHIER = ["pos.view", "pos.sell", "orders.view", "kds.view"];

describe("matrix layout", () => {
  it("covers every catalog permission exactly once", () => {
    const placed = matrixRows().flatMap((r) => [
      ...Object.values(r.cells).filter((p): p is NonNullable<typeof p> => p !== null),
      ...r.other,
    ]);
    expect(placed.sort()).toEqual([...PERMISSION_CATALOG].sort());
    expect(matrixRows()).toHaveLength(14);
    expect(MATRIX_COLUMNS).toEqual(["view", "create", "edit", "delete", "approve", "other"]);
  });

  it("puts module-specific actions in Other and leaves missing cells blank", () => {
    const pos = matrixRows().find((r) => r.module === "pos")!;
    expect(pos.cells.view).toBe("pos.view");
    expect(pos.cells.create).toBeNull();
    expect(pos.other).toEqual(["pos.sell", "pos.discount"]);
    const purchases = matrixRows().find((r) => r.module === "purchases")!;
    expect(purchases.cells.approve).toBe("purchases.approve");
    expect(purchases.other).toEqual(["purchases.receive", "purchases.cancel"]);
  });
});

describe("computeAdjustments", () => {
  it("is empty when the desired set equals the profile", () => {
    expect(computeAdjustments("staff", CASHIER, CASHIER)).toEqual({ extra: [], revoked: [] });
  });

  it("computes extra and revoked relative to the selected profile", () => {
    const desired = ["pos.view", "pos.sell", "orders.view", "orders.refund"];
    expect(computeAdjustments("staff", CASHIER, desired)).toEqual({
      extra: ["orders.refund"],
      revoked: ["kds.view"],
    });
  });

  it("uses tier defaults when there is no profile", () => {
    const desired = roleDefaults("staff").filter((p) => p !== "pos.discount");
    expect(computeAdjustments("staff", null, [...desired, "expenses.view"])).toEqual({
      extra: ["expenses.view"],
      revoked: ["pos.discount"],
    });
  });

  it("drops anything above the tier ceiling", () => {
    const r = computeAdjustments("staff", CASHIER, [...CASHIER, "team.manage", "settings.billing"]);
    expect(r).toEqual({ extra: [], revoked: [] });
    const m = computeAdjustments("manager", null, [...roleDefaults("manager"), "settings.billing"]);
    expect(m.extra).toEqual([]);
  });

  it("never adjusts owners", () => {
    expect(computeAdjustments("owner", null, [])).toEqual({ extra: [], revoked: [] });
  });

  it("round-trips through effectivePermissions (mirror of the SQL)", () => {
    const desired = ["pos.view", "inventory.adjust", "reports.export"];
    const adj = computeAdjustments("staff", CASHIER, desired);
    expect(
      effectivePermissions({ role: "staff", profilePermissions: CASHIER, ...adj }).sort(),
    ).toEqual([...desired].sort());
  });
});

describe("cellState / togglePermission", () => {
  const inherited = new Set<string>(inheritedPermissions("staff", CASHIER));

  it("labels inherited, added, removed, off and unavailable cells", () => {
    const desired = new Set(["pos.view", "orders.view", "kds.view", "menu.view"]);
    expect(cellState("pos.view", "staff", inherited, desired)).toBe("inherited");
    expect(cellState("pos.sell", "staff", inherited, desired)).toBe("removed");
    expect(cellState("menu.view", "staff", inherited, desired)).toBe("added");
    expect(cellState("menu.edit", "staff", inherited, desired)).toBe("off");
    expect(cellState("team.view", "staff", inherited, desired)).toBe("unavailable");
    expect(cellState("settings.billing", "manager", new Set(), new Set())).toBe("unavailable");
    expect(cellState("settings.billing", "owner", new Set(), new Set())).toBe("inherited");
  });

  it("toggles within the ceiling and ignores unavailable permissions", () => {
    const d = new Set(CASHIER);
    expect(togglePermission("staff", d, "pos.sell").has("pos.sell")).toBe(false);
    expect(togglePermission("staff", d, "menu.view").has("menu.view")).toBe(true);
    expect(togglePermission("staff", d, "team.invite").has("team.invite")).toBe(false);
    expect(d).toEqual(new Set(CASHIER)); // input untouched
  });
});

describe("diff and guards", () => {
  it("diffs saved vs. desired in catalog order", () => {
    expect(
      diffPermissions(["pos.view", "kds.view"], ["kds.view", "menu.view", "dashboard.view"]),
    ).toEqual({ granted: ["dashboard.view", "menu.view"], removed: ["pos.view"] });
  });

  it("finds permissions a manager would grant beyond their own", () => {
    expect(exceedingOwn(["pos.view", "team.manage"], new Set(["pos.view"]))).toEqual([
      "team.manage",
    ]);
  });

  it("caps profile permissions to the tier", () => {
    expect(capToTier("staff", ["team.view", "pos.view"])).toEqual(["pos.view"]);
    expect(capToTier("manager", roleCeiling("owner"))).toEqual(roleCeiling("manager"));
  });
});

describe("errors and activity labels", () => {
  it("maps backend messages to stable codes", () => {
    expect(errorCode(new Error("last_owner"))).toBe("last_owner");
    expect(errorCode({ message: "ERROR: permission_exceeds_own" })).toBe("permission_exceeds_own");
    expect(errorCode(new Error("profile_tier_in_use"))).toBe("profile_tier_in_use");
    expect(errorCode(new Error("boom"))).toBe("unknown");
    expect(errorCode(null)).toBe("unknown");
  });

  it("every error code has a translation in both languages", () => {
    for (const code of [
      "forbidden",
      "permission_denied",
      "permission_exceeds_own",
      "invalid_permission",
      "invalid_profile",
      "profile_tier_mismatch",
      "profile_tier_in_use",
      "profile_in_use",
      "last_owner",
      "invalid_location",
      "unknown",
    ]) {
      expect((en.errors as Record<string, string>)[code], code).toBeTruthy();
      expect((pt.errors as Record<string, string>)[code], code).toBeTruthy();
    }
  });

  it("every known audit action and permission label is translated", () => {
    const get = (o: unknown, path: string) =>
      path.split(".").reduce<unknown>((a, k) => (a as Record<string, unknown>)?.[k], o);
    for (const a of KNOWN_AUDIT_ACTIONS) {
      expect(typeof get(en.activity.actions, a), a).toBe("string");
      expect(typeof get(pt.activity.actions, a), a).toBe("string");
    }
    for (const p of PERMISSION_CATALOG) {
      const [m, act] = p.split(".") as [string, string];
      expect(get(en.perm.modules, m), p).toBeTruthy();
      expect(get(en.perm.actions, act), p).toBeTruthy();
      expect(get(pt.perm.modules, m), p).toBeTruthy();
      expect(get(pt.perm.actions, act), p).toBeTruthy();
    }
  });

  it("humanizes unknown keys without dotted ids", () => {
    expect(humanizeAction("orders.item_ready")).toBe("Orders: item ready");
    expect(humanizeAction("api.pos_finalize")).toBe("Api: pos finalize");
    expect(humanizeAction("")).toBe("—");
    expect(humanizeAction("x.y.z")).not.toContain(".");
  });
});
