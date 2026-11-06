import { describe, expect, it, vi, beforeEach } from "vitest";
import { saleInputSchema } from "../lib/operational-contracts";

const server = vi.hoisted(() => ({ submit: vi.fn(), change: vi.fn(), fetch: vi.fn() }));
vi.mock("../lib/operational.functions", () => ({
  submitOperationalSale: server.submit,
  changeOperationalOrder: server.change,
  fetchOperationalOrders: server.fetch,
}));
import { finalizeAndPersistSale, getPOSSession } from "../lib/pos-service";
import { persistOrderToSupabase } from "../lib/orders-persistence-service";
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
    taxRateBasisPoints: 825,
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
  it("does not mark sale complete or write local history when server fails", async () => {
    server.submit.mockRejectedValue(new Error("forbidden"));
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
    const result = await finalizeAndPersistSale(session);
    expect(result.session.completedAt).toBeUndefined();
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
      taxRatePercent: 0,
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
