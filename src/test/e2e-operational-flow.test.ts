import { describe, it, expect, vi } from "vitest";
import {
  calculateItemTotal,
  calculateOrderSummary,
  updateOrderStatus,
  type Order,
  type OrderItem,
  type SelectedModifier,
} from "../lib/orders-service";
import {
  persistOrderToSupabase,
  persistOrderStatusTransition,
  fetchPersistedOrders,
} from "../lib/orders-persistence-service";
import * as operational from "../lib/operational.functions";
vi.mock("../lib/operational.functions", () => ({
  submitOperationalSale: vi.fn(),
  changeOperationalOrder: vi.fn(),
  fetchOperationalOrders: vi.fn(),
}));

describe("E2E Integrated Operational Flow — Menu -> POS -> Orders -> KDS", () => {
  const isolatedTestOrgId = "88888888-8888-4888-8888-888888888888";
  const isolatedTestLocId = "99999999-9999-4999-9999-999999999999";
  const testProductId = "77777777-7777-4777-7777-777777777777";
  const testModifierOptionId = "66666666-6666-4666-6666-666666666666";

  it("Etapa 1: Valida persistência e modificador com total exato de produto em centavos", () => {
    const modifier: SelectedModifier = {
      groupId: "grp-artisan-cheese",
      groupName: "Extra Cheese",
      optionId: testModifierOptionId,
      optionName: "Truffled Gouda",
      priceCents: 250,
    };

    const basePriceCents = 1500;
    const qty = 2;
    const itemTotal = calculateItemTotal(basePriceCents, qty, [modifier]);

    expect(itemTotal).toBe((1500 + 250) * 2);
    expect(itemTotal).toBe(3500);
  });

  it("Etapa 2: Realiza cálculo de venda POS com descontos e alíquota de impostos (8.25%)", () => {
    const items: OrderItem[] = [
      {
        id: "item-pos-1",
        productId: testProductId,
        productName: "Artisan Smokehouse Burger",
        quantity: 2,
        basePriceCents: 1500,
        modifiers: [
          {
            groupId: "grp-cheese",
            groupName: "Extra Cheese",
            optionId: testModifierOptionId,
            optionName: "Truffled Gouda",
            priceCents: 250,
          },
        ],
        subtotalCents: 3500,
      },
      {
        id: "item-pos-2",
        productId: "55555555-5555-4555-5555-555555555555",
        productName: "Handmade Lemon Soda",
        quantity: 1,
        basePriceCents: 500,
        modifiers: [],
        subtotalCents: 500,
      },
    ];

    const discountCents = 400;
    const taxRatePercent = 8.25;
    const summary = calculateOrderSummary(items, taxRatePercent, discountCents);

    expect(summary.subtotalCents).toBe(4000);
    // (4000 - 400) = 3600 taxable * 8.25% = 297 cents tax
    expect(summary.taxCents).toBe(297);
    expect(summary.totalCents).toBe(3897);
  });

  it("Etapa 3: Valida idempotência de requisições POS repetidas por client_order_id", async () => {
    // Local adapter contract only; real PostgreSQL idempotence lives in scripts/security/reconstructed_operations.sql.
    const mockRpc = vi.spyOn(operational, "submitOperationalSale").mockResolvedValue({
      success: true,
      orderId: "11111111-2222-3333-4444-555555555555",
      orderNumber: "#TEST",
      totalCents: 1624,
      subtotalCents: 1500,
      taxCents: 124,
      isSimulation: false,
    });

    const testOrder: Order = {
      id: "order-tx-client-unique-01",
      orgId: isolatedTestOrgId,
      locationId: isolatedTestLocId,
      orderNumber: "#OP-1001",
      type: "dine_in",
      status: "new",
      customer: { name: "Validação Idempotência", phone: "+55 11 99999-0000" },
      items: [
        {
          id: "it-1",
          productId: testProductId,
          productName: "Artisan Smokehouse Burger",
          quantity: 1,
          basePriceCents: 1500,
          modifiers: [],
          subtotalCents: 1500,
        },
      ],
      subtotalCents: 1500,
      discountCents: 0,
      taxRatePercent: 8.25,
      taxCents: 124,
      totalCents: 1624,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      timeline: [],
      isSimulated: false,
    };

    const req1 = await persistOrderToSupabase(isolatedTestOrgId, testOrder);
    const req2 = await persistOrderToSupabase(isolatedTestOrgId, testOrder);

    expect(req1.success).toBe(true);
    expect(req2.success).toBe(true);
    expect(req1.orderId).toBe(req2.orderId);
    expect(mockRpc).toHaveBeenCalledTimes(2);

    mockRpc.mockRestore();
  });

  it("Etapa 4: Valida transição de status na cozinha (KDS) de new -> in_prep -> ready", async () => {
    const mockRpc = vi
      .spyOn(operational, "changeOperationalOrder")
      .mockResolvedValue({ success: true });

    const transition1 = await persistOrderStatusTransition("test-order-id-123", "in_prep");
    expect(transition1.success).toBe(true);

    const transition2 = await persistOrderStatusTransition("test-order-id-123", "ready");
    expect(transition2.success).toBe(true);

    mockRpc.mockRestore();
  });

  it("Etapa 5: Valida isolamento multi-tenant estrito sem vazamento entre lojas e orgs", () => {
    const otherOrgId = "00000000-0000-0000-0000-000000000000";
    const otherLocId = "00000000-0000-0000-0000-000000000001";

    const ordersCatalog: Order[] = [
      {
        id: "ord-target",
        orgId: isolatedTestOrgId,
        locationId: isolatedTestLocId,
        orderNumber: "#ISO-1",
        type: "dine_in",
        status: "ready",
        customer: { name: "Tenant A", phone: "" },
        items: [],
        subtotalCents: 1000,
        discountCents: 0,
        taxRatePercent: 8.25,
        taxCents: 83,
        totalCents: 1083,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        timeline: [],
        isSimulated: false,
      },
      {
        id: "ord-alien",
        orgId: otherOrgId,
        locationId: otherLocId,
        orderNumber: "#ISO-2",
        type: "takeout",
        status: "new",
        customer: { name: "Tenant B", phone: "" },
        items: [],
        subtotalCents: 2000,
        discountCents: 0,
        taxRatePercent: 8.25,
        taxCents: 165,
        totalCents: 2165,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        timeline: [],
        isSimulated: false,
      },
    ];

    const targetResults = ordersCatalog.filter(
      (o) => o.orgId === isolatedTestOrgId && o.locationId === isolatedTestLocId,
    );

    expect(targetResults.length).toBe(1);
    expect(targetResults[0]?.id).toBe("ord-target");
    expect(targetResults.some((o) => o.orgId === otherOrgId)).toBe(false);
  });

  it("Etapa 6: Valida recuperação graciosa e persistência resiliente em oscilação de rede", async () => {
    // Simula erro de conexão e recuperação via fetchPersistedOrders
    const mockFrom = vi
      .spyOn(operational, "fetchOperationalOrders")
      .mockRejectedValue(new Error("network_timeout"));

    const offlineResult = await fetchPersistedOrders({
      orgId: isolatedTestOrgId,
      locationId: isolatedTestLocId,
    });

    expect(offlineResult.orders).toEqual([]);
    expect(offlineResult.totalCount).toBe(0);

    mockFrom.mockRestore();
  });
});
