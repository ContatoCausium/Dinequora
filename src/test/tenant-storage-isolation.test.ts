import { describe, it, expect, beforeEach } from "vitest";
import {
  listInventory,
  saveInventoryItem,
  deleteInventoryItem,
  toggleInventoryItemActive,
  type InventoryItem,
} from "@/lib/inventory-service";
import { listInventoryMovements, recordInventoryMovement } from "@/lib/inventory-movements-service";
import {
  listProductRecipes,
  saveProductRecipe,
  getProductRecipe,
  duplicateProductRecipe,
  syncRecipeWithInventoryPrices,
  simulateOrderIngredientConsumption,
} from "@/lib/recipes-service";
import {
  listExpenses,
  saveExpense,
  deleteExpense,
  updateExpenseStatus,
} from "@/lib/finance-service";
import { listSuspendedSales, listPosHistory } from "@/lib/pos-service";
import { listOrders } from "@/lib/orders-service";
import { listSuppliers, listPurchaseOrders } from "@/lib/suppliers-purchases-service";
import { saveCategory } from "@/lib/menu-service";
import {
  LEGACY_GLOBAL_KEYS,
  TenantContextError,
  inspectLegacyStore,
  tenantStorageKey,
} from "@/lib/tenant-storage";

const ORG_A = "org_a";
const ORG_B = "org_b";

function item(
  orgId: string,
  locationId: string,
  name: string,
): Omit<InventoryItem, "id" | "updatedAt"> {
  return {
    orgId,
    locationId,
    name,
    category: "produce",
    sku: name.toUpperCase(),
    unit: "kg",
    quantity: 10,
    minQuantity: 1,
    costCents: 100,
    supplier: "S",
    active: true,
  };
}

function recipe(orgId: string, locationId: string | undefined, name: string) {
  return {
    orgId,
    productId: `p-${name}`,
    productName: name,
    locationId,
    servings: 1,
    yieldQuantity: 1,
    yieldUnit: "units",
    ingredients: [],
    totalCostCents: 0,
    costPerServingCents: 0,
    sellingPriceCents: 1000,
    estimatedMarginPercent: 0,
    history: [],
  };
}

beforeEach(() => localStorage.clear());

describe("organization switch", () => {
  it("does not show org A inventory to org B", () => {
    saveInventoryItem(ORG_A, item(ORG_A, "loc_1", "Tomato"));
    expect(listInventory(ORG_A, "all")).toHaveLength(1);
    expect(listInventory(ORG_B, "all")).toHaveLength(0);
  });

  it("stores each organization under its own key", () => {
    saveInventoryItem(ORG_A, item(ORG_A, "loc_1", "Tomato"));
    expect(localStorage.getItem(tenantStorageKey("inventory", ORG_A))).not.toBeNull();
    expect(localStorage.getItem(tenantStorageKey("inventory", ORG_B))).toBeNull();
  });

  it("org B cannot toggle or delete org A items by id", () => {
    const saved = saveInventoryItem(ORG_A, item(ORG_A, "loc_1", "Tomato"));
    toggleInventoryItemActive(saved.id, false, ORG_B);
    deleteInventoryItem(saved.id, ORG_B);
    const stillThere = listInventory(ORG_A, "all").find((i) => i.id === saved.id);
    expect(stillThere?.active).toBe(true);
  });

  it("forces the namespace org on save even if the payload claims another org", () => {
    saveInventoryItem(ORG_B, item(ORG_A, "loc_1", "Spoofed"));
    expect(listInventory(ORG_A, "all")).toHaveLength(0);
    expect(listInventory(ORG_B, "all")[0]?.orgId).toBe(ORG_B);
  });

  it("drops foreign records injected into an org namespace", () => {
    localStorage.setItem(
      tenantStorageKey("inventory", ORG_B),
      JSON.stringify([{ ...item(ORG_A, "loc_1", "Injected"), id: "x", updatedAt: "" }]),
    );
    expect(listInventory(ORG_B, "all")).toHaveLength(0);
  });

  it("isolates recipes and movements between organizations", () => {
    const r = saveProductRecipe(ORG_A, recipe(ORG_A, undefined, "Burger"));
    expect(listProductRecipes(ORG_B)).toHaveLength(0);
    expect(getProductRecipe(ORG_B, r.id)).toBeUndefined();

    const inv = saveInventoryItem(ORG_A, item(ORG_A, "loc_1", "Beef"));
    recordInventoryMovement({
      orgId: ORG_A,
      itemId: inv.id,
      type: "in",
      quantity: 5,
      reason: "r",
      performedBy: "u",
      sourceLocationId: "loc_1",
    });
    expect(listInventoryMovements(ORG_A)).toHaveLength(1);
    expect(listInventoryMovements(ORG_B)).toHaveLength(0);
    expect(() =>
      recordInventoryMovement({
        orgId: ORG_B,
        itemId: inv.id,
        type: "in",
        quantity: 5,
        reason: "r",
        performedBy: "u",
        sourceLocationId: "loc_1",
      }),
    ).toThrow();
  });
});

describe("store switch", () => {
  beforeEach(() => {
    saveInventoryItem(ORG_A, item(ORG_A, "loc_1", "Tomato"));
    saveInventoryItem(ORG_A, item(ORG_A, "loc_2", "Onion"));
  });

  it("filters by selected store", () => {
    expect(listInventory(ORG_A, "loc_1").map((i) => i.name)).toEqual(["Tomato"]);
    expect(listInventory(ORG_A, "loc_2").map((i) => i.name)).toEqual(["Onion"]);
  });

  it("returns nothing for an unauthorized explicit store", () => {
    expect(listInventory(ORG_A, "loc_2", ["loc_1"])).toEqual([]);
  });

  it("hides unauthorized stores in the 'all' view", () => {
    expect(listInventory(ORG_A, "all", ["loc_1"]).map((i) => i.name)).toEqual(["Tomato"]);
  });

  it("rejects writes to an unauthorized store", () => {
    expect(() => saveInventoryItem(ORG_A, item(ORG_A, "loc_2", "Garlic"), ["loc_1"])).toThrow(
      TenantContextError,
    );
    const onion = listInventory(ORG_A, "loc_2")[0];
    expect(onion).toBeDefined();
    if (!onion) return;
    expect(() => deleteInventoryItem(onion.id, ORG_A, ["loc_1"])).toThrow(TenantContextError);
    expect(() => toggleInventoryItemActive(onion.id, false, ORG_A, ["loc_1"])).toThrow(
      TenantContextError,
    );
    expect(listInventory(ORG_A, "loc_2")).toHaveLength(1);
  });

  it("scopes store-specific recipes", () => {
    saveProductRecipe(ORG_A, recipe(ORG_A, "loc_1", "Soup"));
    expect(listProductRecipes(ORG_A, "loc_2")).toHaveLength(0);
    expect(listProductRecipes(ORG_A, "loc_1")).toHaveLength(1);
  });
});

describe("missing context", () => {
  it.each(["", "   ", "../evil", "org:with:colons"])("rejects org id %j", (bad) => {
    expect(() => listInventory(bad)).toThrow(TenantContextError);
    expect(() => listProductRecipes(bad)).toThrow(TenantContextError);
    expect(() => listInventoryMovements(bad)).toThrow(TenantContextError);
    expect(() => saveInventoryItem(bad, item(bad, "loc_1", "X"))).toThrow(TenantContextError);
  });

  it("rejects null/undefined org at runtime", () => {
    expect(() => listInventory(undefined as unknown as string)).toThrow(TenantContextError);
  });

  it("only the demo org receives seed data", () => {
    expect(listInventory("demo").length).toBeGreaterThan(0);
    expect(listInventory(ORG_A)).toHaveLength(0);
    expect(listProductRecipes(ORG_A)).toHaveLength(0);
  });
});

describe("legacy global data", () => {
  const legacyItems = [
    { ...item("demo", "loc_1", "LegacyA"), id: "legacy-1", updatedAt: "" },
    { ...item(ORG_A, "loc_1", "LegacyB"), id: "legacy-2", updatedAt: "" },
  ];

  beforeEach(() => {
    localStorage.setItem(LEGACY_GLOBAL_KEYS.inventory, JSON.stringify(legacyItems));
    localStorage.setItem(
      LEGACY_GLOBAL_KEYS.product_recipes,
      JSON.stringify([{ ...recipe(ORG_A, undefined, "Old"), id: "r1", updatedAt: "" }]),
    );
  });

  it("never exposes legacy records, even to the org they claim", () => {
    expect(listInventory(ORG_A).some((i) => i.id.startsWith("legacy"))).toBe(false);
    expect(listInventory("demo").some((i) => i.id.startsWith("legacy"))).toBe(false);
    expect(listProductRecipes(ORG_A)).toHaveLength(0);
  });

  it("never deletes or modifies the legacy key", () => {
    const before = localStorage.getItem(LEGACY_GLOBAL_KEYS.inventory);
    saveInventoryItem(ORG_A, item(ORG_A, "loc_1", "New"));
    listInventory(ORG_B);
    expect(localStorage.getItem(LEGACY_GLOBAL_KEYS.inventory)).toBe(before);
  });

  it("quarantines legacy data reporting only a count", () => {
    listInventory(ORG_A);
    const report = inspectLegacyStore("inventory");
    expect(report.present).toBe(true);
    expect(report.recordCount).toBe(2);
    expect(report.quarantinedAt).not.toBeNull();
    expect(JSON.stringify(report)).not.toContain("LegacyA");
  });
});

describe("stock movements — store authorization", () => {
  it("rejects movements from an unauthorized source store", () => {
    const inv = saveInventoryItem(ORG_A, item(ORG_A, "loc_2", "Beef"));
    expect(() =>
      recordInventoryMovement({
        orgId: ORG_A,
        itemId: inv.id,
        type: "out",
        quantity: 1,
        reason: "r",
        performedBy: "u",
        sourceLocationId: "loc_2",
        allowedLocationIds: ["loc_1"],
      }),
    ).toThrow(TenantContextError);
    expect(listInventory(ORG_A, "loc_2")[0]?.quantity).toBe(10);
  });

  it("rejects a source store that does not own the item", () => {
    const inv = saveInventoryItem(ORG_A, item(ORG_A, "loc_2", "Beef"));
    expect(() =>
      recordInventoryMovement({
        orgId: ORG_A,
        itemId: inv.id,
        type: "out",
        quantity: 1,
        reason: "r",
        performedBy: "u",
        sourceLocationId: "loc_1",
        allowedLocationIds: ["loc_1"],
      }),
    ).toThrow();
    expect(listInventory(ORG_A, "loc_2")[0]?.quantity).toBe(10);
  });

  it("rejects transfers into an unauthorized store", () => {
    const inv = saveInventoryItem(ORG_A, item(ORG_A, "loc_1", "Beef"));
    expect(() =>
      recordInventoryMovement({
        orgId: ORG_A,
        itemId: inv.id,
        type: "transfer",
        quantity: 1,
        reason: "r",
        performedBy: "u",
        sourceLocationId: "loc_1",
        targetLocationId: "loc_3",
        allowedLocationIds: ["loc_1", "loc_2"],
      }),
    ).toThrow(TenantContextError);
    expect(listInventory(ORG_A, "loc_3")).toHaveLength(0);
  });

  it("hides movements of unauthorized stores, including the receiving side of transfers", () => {
    const inv = saveInventoryItem(ORG_A, item(ORG_A, "loc_1", "Beef"));
    recordInventoryMovement({
      orgId: ORG_A,
      itemId: inv.id,
      type: "transfer",
      quantity: 2,
      reason: "r",
      performedBy: "u",
      sourceLocationId: "loc_1",
      targetLocationId: "loc_2",
    });
    expect(listInventoryMovements(ORG_A)).toHaveLength(2);
    const scoped = listInventoryMovements(ORG_A, undefined, ["loc_1"]);
    expect(scoped).toHaveLength(1);
    expect(scoped[0]?.sourceLocationId).toBe("loc_1");
    expect(listInventoryMovements(ORG_A, { locationId: "loc_2" }, ["loc_1"])).toEqual([]);
  });

  it("requires organization context to record movements", () => {
    expect(() =>
      recordInventoryMovement({
        orgId: "",
        itemId: "x",
        type: "in",
        quantity: 1,
        reason: "r",
        performedBy: "u",
        sourceLocationId: "loc_1",
      }),
    ).toThrow(TenantContextError);
  });
});

describe("recipes — store authorization", () => {
  it("hides store recipes of unauthorized stores but keeps org-wide recipes visible", () => {
    saveProductRecipe(ORG_A, recipe(ORG_A, "loc_1", "Soup"));
    saveProductRecipe(ORG_A, recipe(ORG_A, "loc_2", "Stew"));
    saveProductRecipe(ORG_A, recipe(ORG_A, undefined, "House sauce"));
    const names = listProductRecipes(ORG_A, "all", ["loc_1"])
      .map((r) => r.productName)
      .sort();
    expect(names).toEqual(["House sauce", "Soup"]);
    expect(listProductRecipes(ORG_A, "loc_2", ["loc_1"])).toEqual([]);
  });

  it("blocks get/edit/duplicate of a recipe from an unauthorized store", () => {
    const stew = saveProductRecipe(ORG_A, recipe(ORG_A, "loc_2", "Stew"));
    expect(getProductRecipe(ORG_A, stew.id, ["loc_1"])).toBeUndefined();
    expect(() =>
      saveProductRecipe(ORG_A, { ...stew, locationId: "loc_1" }, "u", ["loc_1"]),
    ).toThrow(TenantContextError);
    expect(() => duplicateProductRecipe(ORG_A, stew.id, "u", ["loc_1"])).toThrow();
    expect(getProductRecipe(ORG_A, stew.id)?.locationId).toBe("loc_2");
  });

  it("store-restricted callers cannot create or edit org-wide recipes", () => {
    expect(() =>
      saveProductRecipe(ORG_A, recipe(ORG_A, undefined, "Global"), "u", ["loc_1"]),
    ).toThrow(TenantContextError);
    expect(listProductRecipes(ORG_A)).toHaveLength(0);
  });

  it("isolates recipe sync and consumption simulation by organization", () => {
    const r = saveProductRecipe(ORG_A, recipe(ORG_A, "loc_1", "Soup"));
    expect(() => syncRecipeWithInventoryPrices(ORG_B, r.id)).toThrow();
    expect(simulateOrderIngredientConsumption(ORG_B, "loc_1", [r.id])).toEqual([]);
  });
});

describe("finance expenses — isolation", () => {
  const exp = (orgId: string, locationId: string, description: string) => ({
    orgId,
    locationId,
    description,
    category: "rent" as const,
    recurrence: "fixed" as const,
    status: "pending" as const,
    amountCents: 1000,
    currency: "usd" as const,
    dueDate: "2026-10-01",
    competencyDate: "2026-10-01",
    responsiblePerson: "x",
    isSimulation: false,
  });

  it("does not show one organization's expenses to another", () => {
    saveExpense(exp(ORG_A, "loc_1", "Rent A"));
    expect(listExpenses(ORG_B)).toHaveLength(0);
    expect(listExpenses(ORG_A)).toHaveLength(1);
  });

  it("does not leak synthetic default expenses into real organizations", () => {
    expect(listExpenses(ORG_A)).toHaveLength(0);
    expect(listExpenses("demo").length).toBeGreaterThan(0);
  });

  it("org B cannot delete or change status of org A expenses", () => {
    const a = saveExpense(exp(ORG_A, "loc_1", "Rent A"));
    expect(deleteExpense(a.id, ORG_B)).toBe(false);
    expect(updateExpenseStatus(a.id, "paid", ORG_B)).toBeNull();
    expect(listExpenses(ORG_A)[0]?.status).toBe("pending");
  });

  it("enforces store authorization on reads and writes", () => {
    const a2 = saveExpense(exp(ORG_A, "loc_2", "Rent loc 2"));
    saveExpense(exp(ORG_A, "all", "Shared"));
    expect(listExpenses(ORG_A, "all", ["loc_1"]).map((e) => e.description)).toEqual(["Shared"]);
    expect(listExpenses(ORG_A, "loc_2", ["loc_1"])).toEqual([]);
    expect(() => saveExpense(exp(ORG_A, "loc_2", "X"), ["loc_1"])).toThrow(TenantContextError);
    expect(() => deleteExpense(a2.id, ORG_A, ["loc_1"])).toThrow(TenantContextError);
    expect(() => updateExpenseStatus(a2.id, "paid", ORG_A, ["loc_1"])).toThrow(TenantContextError);
  });

  it("requires organization context and quarantines the legacy global key", () => {
    expect(() => listExpenses("")).toThrow(TenantContextError);
    expect(() => saveExpense(exp("", "loc_1", "X"))).toThrow(TenantContextError);
    localStorage.setItem(
      LEGACY_GLOBAL_KEYS.finance_expenses,
      JSON.stringify([{ ...exp(ORG_A, "loc_1", "Old"), id: "old" }]),
    );
    expect(listExpenses(ORG_A)).toHaveLength(0);
    expect(inspectLegacyStore("finance_expenses").recordCount).toBe(1);
    expect(localStorage.getItem(LEGACY_GLOBAL_KEYS.finance_expenses)).not.toBeNull();
  });
});

describe("POS, orders, menu and purchases — context and store filters", () => {
  it("POS suspended sales and history no longer show loc-1 records in other stores", () => {
    localStorage.setItem(
      "servora.pos.suspended.org_a",
      JSON.stringify([{ id: "s1", locationId: "loc-1" }]),
    );
    localStorage.setItem(
      "servora.pos.history.org_a",
      JSON.stringify([{ id: "h1", locationId: "loc-1" }]),
    );
    expect(listSuspendedSales(ORG_A, "loc_2")).toEqual([]);
    expect(listPosHistory(ORG_A, "loc_2")).toEqual([]);
  });

  it("orders no longer show loc-1 records in other stores", () => {
    localStorage.setItem(
      "servora.orders.org_a",
      JSON.stringify([{ id: "o1", locationId: "loc-1" }]),
    );
    expect(listOrders(ORG_A, "loc_2")).toEqual([]);
  });

  it.each(["", "../x"])(
    "rejects missing/invalid org context (%j) instead of using a shared key",
    (bad) => {
      expect(() => listSuppliers(bad)).toThrow(TenantContextError);
      expect(() => listPurchaseOrders(bad)).toThrow(TenantContextError);
      expect(() => listPosHistory(bad)).toThrow(TenantContextError);
      expect(() => listOrders(bad)).toThrow(TenantContextError);
      expect(() => saveCategory(bad, { id: "c", name: "C" } as never)).toThrow(TenantContextError);
      expect(localStorage.getItem("servora_suppliers_")).toBeNull();
    },
  );
});
