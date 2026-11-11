import { describe, expect, it, vi, beforeEach } from "vitest";
import { recipePayloadSchema, saleInputSchema } from "../lib/operational-contracts";

const server = vi.hoisted(() => ({ submit: vi.fn(), change: vi.fn(), fetch: vi.fn() }));
vi.mock("../lib/operational.functions", () => ({
  submitOperationalSale: server.submit,
  changeOperationalOrder: server.change,
  fetchOperationalOrders: server.fetch,
}));
import { getPOSSession } from "../lib/pos-service";
import {
  persistFinalizedPOSSaleAtomic,
  persistOrderToSupabase,
} from "../lib/orders-persistence-service";
import type { Order } from "../lib/orders-service";

describe("Reconstructed operational boundary (local contracts, not live RLS)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });
  const input = {
    orgId: "org-a",
    locationId: "store-a",
    clientOrderId: "sale-1",
    orderType: "dine_in",
    customerName: "Customer",
    discountCents: 0,
    taxRatePpm: 82500,
    items: [{ productId: "p1", quantity: 1, modifiers: [] }],
  };
  it("rejects missing organization before dispatch", () => {
    expect(saleInputSchema.safeParse({ ...input, orgId: "" }).success).toBe(false);
  });
  it("rejects missing store before dispatch", () => {
    expect(saleInputSchema.safeParse({ ...input, locationId: "" }).success).toBe(false);
  });
  it("rejects negative or fractional quantities", () => {
    for (const quantity of [-1, 0, 1.5])
      expect(
        saleInputSchema.safeParse({
          ...input,
          items: [{ productId: "p1", quantity, modifiers: [] }],
        }).success,
      ).toBe(false);
  });
  it("does not confirm the sale or write anything locally when the server fails", async () => {
    server.submit.mockRejectedValue(new Error("forbidden"));
    const session = getPOSSession("org-a", "store-a", "Cashier", undefined, 82500);
    session.cart = [
      {
        id: "i1",
        productId: "p1",
        productName: "Product",
        quantity: 1,
        basePriceCents: 100,
        modifiers: [],
        subtotalCents: 100,
      },
    ];
    const result = await persistFinalizedPOSSaleAtomic(session);
    expect(result.success).toBe(false);
    expect(result.orderId).toBeUndefined();
    expect(result.error).toBe("forbidden");
    expect(localStorage.getItem("servora.pos.history.org-a")).toBeNull();
  });
  it("rejects cross-organization order before calling server", async () => {
    const order: Order = {
      id: "1",
      orgId: "org-b",
      locationId: "store-b",
      orderNumber: "1",
      type: "dine_in",
      status: "new",
      customer: { name: "Customer", phone: "" },
      items: [],
      subtotalCents: 0,
      discountCents: 0,
      taxRatePpm: 0,
      taxCents: 0,
      totalCents: 0,
      createdAt: "",
      updatedAt: "",
      timeline: [],
      isSimulated: false,
    };
    expect(await persistOrderToSupabase("org-a", order)).toEqual({
      success: false,
      error: "organization_mismatch",
    });
    expect(server.submit).not.toHaveBeenCalled();
  });
});

describe("Store sales tax (0025) and recipe payload (0024) contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });
  const sale = {
    orgId: "org-a",
    locationId: "store-a",
    clientOrderId: "sale-1",
    orderType: "dine_in",
    customerName: "Customer",
    discountCents: 0,
    items: [{ productId: "p1", quantity: 1, modifiers: [] }],
  };
  it("the sale carries the displayed rate in whole ppm between 0 and 100%", () => {
    expect(saleInputSchema.safeParse({ ...sale, taxRatePpm: 88750 }).success).toBe(true);
    expect(saleInputSchema.safeParse({ ...sale, taxRatePpm: 0 }).success).toBe(true);
    expect(saleInputSchema.safeParse({ ...sale, taxRatePpm: 1_000_000 }).success).toBe(true);
    expect(saleInputSchema.safeParse({ ...sale, taxRatePpm: 1_000_001 }).success).toBe(false);
    expect(saleInputSchema.safeParse({ ...sale, taxRatePpm: -1 }).success).toBe(false);
    expect(saleInputSchema.safeParse({ ...sale, taxRatePpm: 887.5 }).success).toBe(false);
    expect(saleInputSchema.safeParse({ ...sale, taxRateBasisPoints: 888 }).success).toBe(false);
    expect(saleInputSchema.safeParse(sale).success).toBe(false);
  });
  it("a ticket of a store without a rate is refused before any server call", async () => {
    const session = getPOSSession("org-a", "store-a", "Cashier");
    session.cart = [
      {
        id: "i1",
        productId: "p1",
        productName: "Product",
        quantity: 1,
        basePriceCents: 100,
        modifiers: [],
        subtotalCents: 100,
      },
    ];
    const result = await persistFinalizedPOSSaleAtomic(session);
    expect(result).toEqual({ success: false, error: "tax_rate_not_configured" });
    expect(server.submit).not.toHaveBeenCalled();
  });
  it("the ticket sends exactly the rate it displayed (ppm), as a confirmation", async () => {
    server.submit.mockResolvedValue({ success: true, orderId: "o1" });
    const session = getPOSSession("org-a", "store-a", "Cashier", undefined, 88750);
    session.cart = [
      {
        id: "i1",
        productId: "p1",
        productName: "Product",
        quantity: 1,
        basePriceCents: 100,
        modifiers: [],
        subtotalCents: 100,
      },
    ];
    await persistFinalizedPOSSaleAtomic(session, "cid-1");
    expect(server.submit).toHaveBeenCalledTimes(1);
    expect(server.submit.mock.calls[0]![0].data).toMatchObject({
      taxRatePpm: 88750,
      clientOrderId: "cid-1",
    });
    expect(server.submit.mock.calls[0]![0].data).not.toHaveProperty("taxRateBasisPoints");
  });
  const recipe = {
    productId: "burger",
    productName: "Burger",
    servings: 2,
    yieldQuantity: 2,
    yieldUnit: "units",
    prepInstructions: "grill",
    sellingPriceCents: 1500,
    ingredients: [{ inventoryItemId: "beef", quantity: 0.5, unit: "lb", wastePercentage: 0 }],
  };
  it("a recipe payload is only its definition: cost snapshots are refused", () => {
    expect(recipePayloadSchema.safeParse(recipe).success).toBe(true);
    expect(recipePayloadSchema.safeParse({ ...recipe, id: "r1" }).success).toBe(true);
    expect(
      recipePayloadSchema.safeParse({
        ...recipe,
        ingredients: [{ ...recipe.ingredients[0], unitCostCents: 400, subtotalCostCents: 200 }],
      }).success,
    ).toBe(false);
    expect(
      recipePayloadSchema.safeParse({
        ...recipe,
        ingredients: [{ ...recipe.ingredients[0], name: "Beef", id: "ri-1" }],
      }).success,
    ).toBe(false);
    expect(recipePayloadSchema.safeParse({ ...recipe, totalCostCents: 200 }).success).toBe(false);
    expect(recipePayloadSchema.safeParse({ ...recipe, ingredients: [] }).success).toBe(false);
    expect(recipePayloadSchema.safeParse({ ...recipe, servings: 0 }).success).toBe(false);
    expect(recipePayloadSchema.safeParse({ ...recipe, sellingPriceCents: -1 }).success).toBe(false);
    expect(
      recipePayloadSchema.safeParse({
        ...recipe,
        ingredients: [{ ...recipe.ingredients[0], unit: "handful" }],
      }).success,
    ).toBe(false);
  });
});
