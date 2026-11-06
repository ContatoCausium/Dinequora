import { describe, it, expect, beforeEach } from "vitest";
import {
  listMenuItems,
  saveMenuItem,
  deleteMenuItem,
  duplicateMenuItem,
  listCategories,
  saveCategory,
  deleteCategory,
  type MenuItem,
} from "@/lib/menu-service";
import {
  listSuppliers,
  saveSupplier,
  toggleSupplierActive,
  listPurchaseOrders,
  savePurchaseOrder,
  processPOReceiving,
  cancelPurchaseOrder,
} from "@/lib/suppliers-purchases-service";
import {
  listSuspendedSales,
  suspendSale,
  removeSuspendedSale,
  listPosHistory,
  recordCompletedSale,
  getPOSSession,
  resumeSession,
  type SuspendedSale,
  type CompletedPosSale,
} from "@/lib/pos-service";
import { listOrders, updateOrderStatus, toggleOrderItemReady } from "@/lib/orders-service";
import { TenantContextError } from "@/lib/tenant-storage";

const A = "org_a";
const B = "org_b";

beforeEach(() => localStorage.clear());

function menuItem(id: string, locationIds: string[], orgId = A): MenuItem {
  return {
    id,
    orgId,
    name: id,
    description: "",
    category: "mains",
    priceCents: 1000,
    prepTimeMinutes: 5,
    active: true,
    locationIds,
    modifierGroups: [],
    createdAt: "2026-01-01T00:00:00.000Z",
  } as unknown as MenuItem;
}

function suspended(id: string, locationId: string, orgId = A): SuspendedSale {
  return {
    id,
    orgId,
    locationId,
    attendantName: "x",
    customerName: "c",
    orderType: "dine_in",
    items: [],
    discountCents: 0,
    taxRatePercent: 0,
    suspendedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as SuspendedSale;
}

describe("Menu — store scope", () => {
  beforeEach(() => {
    saveMenuItem(A, menuItem("global", []));
    saveMenuItem(A, menuItem("store1", ["loc_1"]));
    saveMenuItem(A, menuItem("store2", ["loc_2"]));
  });

  it("restricted callers see org-wide items and items of their stores only", () => {
    expect(
      listMenuItems(A, ["loc_1"])
        .map((i) => i.id)
        .sort(),
    ).toEqual(["global", "store1"]);
    expect(listMenuItems(A).map((i) => i.id)).toHaveLength(3);
  });

  it("blocks writes to unauthorized or org-wide items for restricted callers", () => {
    expect(() => saveMenuItem(A, menuItem("store2", ["loc_1"]), ["loc_1"])).toThrow(
      TenantContextError,
    );
    expect(() => saveMenuItem(A, menuItem("new", []), ["loc_1"])).toThrow(TenantContextError);
    expect(() => saveMenuItem(A, menuItem("multi", ["loc_1", "loc_2"]), ["loc_1"])).toThrow(
      TenantContextError,
    );
    expect(() => deleteMenuItem(A, "store2", ["loc_1"])).toThrow(TenantContextError);
    expect(() => duplicateMenuItem(A, "store2", ["loc_1"])).not.toThrow();
    expect(
      listMenuItems(A)
        .map((i) => i.id)
        .sort(),
    ).toEqual(["global", "store1", "store2"]);
  });

  it("restricted callers cannot change organization-wide categories", () => {
    expect(() => saveCategory(A, { id: "c", name: "C" } as never, ["loc_1"])).toThrow(
      TenantContextError,
    );
    expect(() => deleteCategory(A, "c", ["loc_1"])).toThrow(TenantContextError);
    expect(listCategories(A)).toEqual([]);
  });

  it("forces the namespace organization on save and isolates organizations", () => {
    saveMenuItem(B, menuItem("spoof", [], A));
    expect(listMenuItems(A).some((i) => i.id === "spoof")).toBe(false);
    expect(listMenuItems(B)[0]?.orgId).toBe(B);
  });

  it("rejects missing context on writes", () => {
    expect(() => saveMenuItem("", menuItem("x", []))).toThrow(TenantContextError);
    expect(() => deleteMenuItem("", "x")).toThrow(TenantContextError);
  });
});

describe("Purchases — demo seed and store scope", () => {
  it("real organizations start without example suppliers; demo keeps them", () => {
    expect(listSuppliers(A)).toEqual([]);
    expect(localStorage.getItem("servora_suppliers_org_a")).toBeNull();
    expect(listSuppliers("demo").length).toBeGreaterThan(0);
  });

  it("keeps suppliers already saved (including old example rows) instead of deleting them", () => {
    localStorage.setItem(
      "servora_suppliers_org_a",
      JSON.stringify([{ id: "sup-usfoods", orgId: "default", name: "US Foods" }]),
    );
    expect(listSuppliers(A).map((s) => s.id)).toEqual(["sup-usfoods"]);
  });

  it("restricted callers cannot change organization-wide suppliers", () => {
    const s = saveSupplier(A, { name: "Fresh" });
    expect(() => saveSupplier(A, { name: "X" }, ["loc_1"])).toThrow(TenantContextError);
    expect(() => toggleSupplierActive(A, s.id, ["loc_1"])).toThrow(TenantContextError);
    expect(listSuppliers(A)[0]?.active).toBe(true);
  });

  it("isolates purchase orders by store and organization", () => {
    const sup = saveSupplier(A, { name: "Fresh" });
    expect(() =>
      savePurchaseOrder(A, { supplierId: sup.id, locationId: "loc_2", items: [] }, "u", ["loc_1"]),
    ).toThrow(TenantContextError);
    const po2 = savePurchaseOrder(A, { supplierId: sup.id, locationId: "loc_2", items: [] }, "u");
    savePurchaseOrder(A, { supplierId: sup.id, locationId: "loc_1", items: [] }, "u");

    expect(listPurchaseOrders(A, "all", ["loc_1"]).map((p) => p.locationId)).toEqual(["loc_1"]);
    expect(listPurchaseOrders(A, "loc_2", ["loc_1"])).toEqual([]);
    expect(listPurchaseOrders(B)).toEqual([]);

    expect(() => cancelPurchaseOrder(A, po2.id, "u", "r", ["loc_1"])).toThrow();
    expect(() => processPOReceiving(A, po2.id, [], "u", undefined, ["loc_1"])).toThrow();
    expect(() => cancelPurchaseOrder(B, po2.id, "u", "r")).toThrow();
    expect(listPurchaseOrders(A, "loc_2")[0]?.status).toBe(po2.status);
  });
});

describe("POS — store scope", () => {
  it("hides suspended sales and history of unauthorized stores", () => {
    suspendSale(A, suspended("s1", "loc_1"));
    suspendSale(A, suspended("s2", "loc_2"));
    expect(listSuspendedSales(A, "all", ["loc_1"]).map((s) => s.id)).toEqual(["s1"]);
    expect(listSuspendedSales(A, "loc_2", ["loc_1"])).toEqual([]);
    expect(listSuspendedSales(B)).toEqual([]);
  });

  it("blocks suspending, removing and resuming sales of unauthorized stores", () => {
    suspendSale(A, suspended("s2", "loc_2"));
    expect(() => suspendSale(A, suspended("s3", "loc_2"), ["loc_1"])).toThrow(TenantContextError);
    expect(() => removeSuspendedSale(A, "s2", ["loc_1"])).toThrow(TenantContextError);
    expect(resumeSession(A, "s2", ["loc_1"])).toBeNull();
    expect(listSuspendedSales(A).map((s) => s.id)).toEqual(["s2"]);
  });

  it("refuses to open a POS session or record a sale in an unauthorized store", () => {
    expect(() => getPOSSession(A, "loc_2", "c", ["loc_1"])).toThrow(TenantContextError);
    const sale = {
      id: "h1",
      orderNumber: "#1",
      orgId: A,
      locationId: "loc_2",
    } as unknown as CompletedPosSale;
    expect(() => recordCompletedSale(A, sale, ["loc_1"])).toThrow(TenantContextError);
    expect(listPosHistory(A)).toEqual([]);
  });

  it("rejects missing context", () => {
    expect(() => listSuspendedSales("")).toThrow(TenantContextError);
    expect(() => getPOSSession("", "loc_1", "c")).toThrow(TenantContextError);
  });
});

describe("Orders/KDS — demo seed and store scope", () => {
  it("does not generate example orders for real organizations", () => {
    expect(listOrders(A)).toEqual([]);
    expect(localStorage.getItem("servora.orders.org_a")).toBeNull();
    expect(listOrders("demo").length).toBeGreaterThan(0);
  });

  it("keeps existing orders and enforces store scope on reads and KDS updates", () => {
    const order = (id: string, locationId: string) => ({
      id,
      orgId: A,
      locationId,
      orderNumber: id,
      status: "new",
      items: [{ id: "i1", isItemReady: false }],
      timeline: [],
      isSimulated: true,
    });
    localStorage.setItem(
      "servora.orders.org_a",
      JSON.stringify([order("o1", "loc_1"), order("o2", "loc_2")]),
    );
    expect(listOrders(A, "all", ["loc_1"]).map((o) => o.id)).toEqual(["o1"]);
    expect(updateOrderStatus(A, "o2", "in_prep", "u", undefined, ["loc_1"])).toBeNull();
    expect(toggleOrderItemReady(A, "o2", "i1", ["loc_1"])).toBeNull();
    expect(listOrders(A, "loc_2")[0]?.status).toBe("new");
    expect(listOrders(B)).toEqual([]);
  });
});
