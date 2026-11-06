import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  listInventory,
  saveInventoryItem,
  deleteInventoryItem,
  toggleInventoryItemActive,
  isExpiringSoon,
  computeInventoryMetrics,
  type InventoryItem,
} from "@/lib/inventory-service";
import { supabaseAuth } from "@/lib/auth/supabase-adapter";
import { supabase } from "@/integrations/supabase/client";

// Mock Supabase client to test authentication calls
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithPassword: vi.fn(),
      signUp: vi.fn(),
      getUser: vi.fn(),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
      resend: vi.fn(),
      resetPasswordForEmail: vi.fn(),
      updateUser: vi.fn(),
      signOut: vi.fn(),
    },
  },
}));

describe("Authentication Provider Validation (Supabase Integration)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses real supabase.auth.signInWithPassword when logging in", async () => {
    (supabase.auth.signInWithPassword as any).mockResolvedValueOnce({
      data: { session: {} },
      error: null,
    });
    await supabaseAuth.signIn("owner@test.com", "password123");
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({
      email: "owner@test.com",
      password: "password123",
    });
  });

  it("uses real supabase.auth.signUp when creating account with metadata and redirect", async () => {
    (supabase.auth.signUp as any).mockResolvedValueOnce({
      data: { user: { id: "u-123", identities: [{ id: "id-1" }] }, session: {} },
      error: null,
    });

    const res = await supabaseAuth.signUp({
      email: "newuser@test.com",
      password: "SuperSecret89!",
      fullName: "Chef John",
      language: "pt-BR",
    });

    expect(supabase.auth.signUp).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "newuser@test.com",
        password: "SuperSecret89!",
        options: expect.objectContaining({
          data: { full_name: "Chef John", preferred_language: "pt-BR" },
        }),
      }),
    );
    expect(res.needsVerification).toBe(false);
  });
});

describe("Inventory Multi-Unit & Safety Isolation Validation", () => {
  beforeEach(() => {
    if (typeof window !== "undefined") {
      localStorage.clear();
    }
  });

  it("isolates items by tenant orgId", () => {
    saveInventoryItem("org_tenant_A", {
      orgId: "org_tenant_A",
      locationId: "loc_A1",
      name: "Organic Flour",
      category: "bakery",
      sku: "FLOUR-01",
      unit: "kg",
      quantity: 50,
      minQuantity: 10,
      costCents: 120,
      supplier: "Grain Mill",
      active: true,
    });

    saveInventoryItem("org_tenant_B", {
      orgId: "org_tenant_B",
      locationId: "loc_B1",
      name: "Brioche Buns",
      category: "bakery",
      sku: "BUN-01",
      unit: "units",
      quantity: 200,
      minQuantity: 20,
      costCents: 50,
      supplier: "Gold Bakery",
      active: true,
    });

    const tenantAItems = listInventory("org_tenant_A");
    expect(tenantAItems.some((i) => i.name === "Organic Flour")).toBe(true);
    expect(tenantAItems.some((i) => i.name === "Brioche Buns")).toBe(false);
  });

  it("filters inventory correctly by locationId for multi-unit restaurants", () => {
    const item1 = saveInventoryItem("org_multi", {
      orgId: "org_multi",
      locationId: "downtown",
      name: "Tomatoes",
      category: "produce",
      sku: "TOM-01",
      unit: "lb",
      quantity: 20,
      minQuantity: 5,
      costCents: 150,
      supplier: "Farm Fresh",
      active: true,
    });

    saveInventoryItem("org_multi", {
      orgId: "org_multi",
      locationId: "uptown",
      name: "Lettuce",
      category: "produce",
      sku: "LET-01",
      unit: "lb",
      quantity: 30,
      minQuantity: 10,
      costCents: 90,
      supplier: "Farm Fresh",
      active: true,
    });

    const downtownItems = listInventory("org_multi", "downtown");
    expect(downtownItems.length).toBe(1);
    expect(downtownItems[0]?.sku).toBe("TOM-01");

    const allItems = listInventory("org_multi", "all");
    expect(allItems.length).toBe(2);
  });

  it("detects expiring items and computes inventory metrics accurately", () => {
    const futureExp = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    expect(isExpiringSoon(futureExp, 7)).toBe(true);

    const farFutureExp = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    expect(isExpiringSoon(farFutureExp, 7)).toBe(false);

    const mockItems: InventoryItem[] = [
      {
        id: "1",
        orgId: "t1",
        locationId: "l1",
        name: "Beef",
        category: "meat",
        sku: "SKU-1",
        unit: "lb",
        quantity: 10,
        minQuantity: 5,
        costCents: 500, // 10 * 500 = 5000 cents
        supplier: "Meat Co",
        active: true,
        updatedAt: new Date().toISOString(),
      },
      {
        id: "2",
        orgId: "t1",
        locationId: "l1",
        name: "Cheese",
        category: "dairy",
        sku: "SKU-2",
        unit: "lb",
        quantity: 2,
        minQuantity: 10, // low stock
        costCents: 300, // 2 * 300 = 600 cents
        supplier: "Dairy Co",
        active: true,
        updatedAt: new Date().toISOString(),
      },
      {
        id: "3",
        orgId: "t1",
        locationId: "l1",
        name: "Salt",
        category: "dry_goods",
        sku: "SKU-3",
        unit: "kg",
        quantity: 0, // out of stock
        minQuantity: 5,
        costCents: 100,
        supplier: "Spice Co",
        active: true,
        updatedAt: new Date().toISOString(),
      },
    ];

    const metrics = computeInventoryMetrics(mockItems);
    expect(metrics.totalValueCents).toBe(5600);
    expect(metrics.lowStockCount).toBe(1);
    expect(metrics.outOfStockCount).toBe(1);
    expect(metrics.totalItems).toBe(3);
  });

  it("safely toggles and deletes inventory items", () => {
    const item = saveInventoryItem("org_test", {
      orgId: "org_test",
      locationId: "loc_1",
      name: "Napkins",
      category: "packaging",
      sku: "NAP-01",
      unit: "pack",
      quantity: 50,
      minQuantity: 10,
      costCents: 15,
      supplier: "Paper Inc",
      active: true,
    });

    toggleInventoryItemActive(item.id, false, "org_test");
    let list = listInventory("org_test", "loc_1");
    expect(list.find((i) => i.id === item.id)?.active).toBe(false);

    deleteInventoryItem(item.id, "org_test");
    list = listInventory("org_test", "loc_1");
    expect(list.some((i) => i.id === item.id)).toBe(false);
  });
});
