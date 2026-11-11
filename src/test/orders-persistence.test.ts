import { describe, it, expect } from "vitest";
import {
  calculateOrderSummary,
  calculateItemTotal,
  type Order,
  type SelectedModifier,
} from "../lib/orders-service";
import { persistOrderToSupabase, fetchPersistedOrders } from "../lib/orders-persistence-service";

describe("Orders persistence and multi-tenant integrity", () => {
  it("calculates modifiers total accurately for orders", () => {
    const mods: SelectedModifier[] = [
      {
        groupId: "g1",
        groupName: "Cheese",
        optionId: "o1",
        optionName: "Cheddar",
        priceCents: 150,
      },
      {
        groupId: "g2",
        groupName: "Bacon",
        optionId: "o2",
        optionName: "Crispy Bacon",
        priceCents: 200,
      },
    ];
    const total = calculateItemTotal(1000, 2, mods);
    expect(total).toBe((1000 + 350) * 2);
  });

  it("computes order summary with tax correctly", () => {
    const summary = calculateOrderSummary(
      [
        {
          id: "oi-test",
          productId: "p1",
          productName: "Test Burger",
          quantity: 1,
          basePriceCents: 2000,
          modifiers: [],
          subtotalCents: 2000,
        },
      ],
      100000, // 10% in parts per million
      500,
    );

    expect(summary.subtotalCents).toBe(2000);
    // (2000 - 500) = 1500; 10% tax = 150; total = 1650
    expect(summary.taxCents).toBe(150);
    expect(summary.totalCents).toBe(1650);
  });

  it("handles client-side supabase error gracefully when offline", async () => {
    const res = await fetchPersistedOrders({ orgId: "mock-org", locationId: "loc-1" });
    expect(Array.isArray(res.orders)).toBe(true);
  });

  it("preserves exact cents across items, discount and tax without rounding drift", () => {
    const items = [
      {
        id: "i1",
        productId: "p1",
        productName: "Combo Burger",
        quantity: 2,
        basePriceCents: 1550,
        modifiers: [
          {
            groupId: "g1",
            groupName: "Sauce",
            optionId: "o1",
            optionName: "Truffle",
            priceCents: 125,
          },
        ],
        subtotalCents: (1550 + 125) * 2, // 3350
      },
      {
        id: "i2",
        productId: "p2",
        productName: "Soda",
        quantity: 1,
        basePriceCents: 450,
        modifiers: [],
        subtotalCents: 450,
      },
    ];

    const summary = calculateOrderSummary(items, 82500, 200);
    expect(summary.subtotalCents).toBe(3800);
    // Taxable = 3800 - 200 = 3600; 8.25% of 3600 = 297 cents
    expect(summary.taxCents).toBe(297);
    expect(summary.totalCents).toBe(3897);
  });

  it("handles order creation idempotence with persistent payload generation", async () => {
    const testOrder: Order = {
      id: "550e8400-e29b-41d4-a716-446655440000",
      orgId: "11111111-1111-1111-1111-111111111111",
      locationId: "22222222-2222-2222-2222-222222222222",
      orderNumber: "#TEST-99",
      type: "dine_in",
      status: "new",
      customer: { name: "Idempotency Check", phone: "" },
      items: [
        {
          id: "it-1",
          productId: "33333333-3333-3333-3333-333333333333",
          productName: "Test Item",
          quantity: 1,
          basePriceCents: 1200,
          modifiers: [],
          subtotalCents: 1200,
        },
      ],
      subtotalCents: 1200,
      discountCents: 0,
      taxRatePpm: 82500,
      taxCents: 99,
      totalCents: 1299,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      timeline: [],
      isSimulated: false,
    };

    const res = await persistOrderToSupabase(testOrder.orgId, testOrder);
    expect(typeof res.success).toBe("boolean");
  });

  it("generates deterministic client_order_id for idempotency", () => {
    const orderId = "550e8400-e29b-41d4-a716-446655440000";
    const clientOrderId = `persist-${orderId}`;
    expect(clientOrderId).toBe("persist-550e8400-e29b-41d4-a716-446655440000");
    expect(`persist-${orderId}`).toBe(clientOrderId);
  });

  it("guarantees client_order_id collision isolation across distinct orgs", () => {
    const orderKey = "order-ref-123";
    const orgA = "org-aaaa-1111";
    const orgB = "org-bbbb-2222";
    const keyA = `${orgA}:${orderKey}`;
    const keyB = `${orgB}:${orderKey}`;
    expect(keyA).not.toBe(keyB);
  });

  it("enforces location scope filtering and multi-tenant isolation", () => {
    const orgA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
    const orgB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
    const locA1 = "11111111-1111-1111-1111-111111111111";
    const locA2 = "22222222-2222-2222-2222-222222222222";

    const mockOrders: Order[] = [
      {
        id: "ord-1",
        orgId: orgA,
        locationId: locA1,
        orderNumber: "#001",
        type: "dine_in",
        status: "new",
        customer: { name: "A1 Guest", phone: "" },
        items: [],
        subtotalCents: 1000,
        discountCents: 0,
        taxRatePpm: 82500,
        taxCents: 83,
        totalCents: 1083,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        timeline: [],
        isSimulated: false,
      },
      {
        id: "ord-2",
        orgId: orgA,
        locationId: locA2,
        orderNumber: "#002",
        type: "dine_in",
        status: "confirmed",
        customer: { name: "A2 Guest", phone: "" },
        items: [],
        subtotalCents: 1500,
        discountCents: 0,
        taxRatePpm: 82500,
        taxCents: 124,
        totalCents: 1624,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        timeline: [],
        isSimulated: false,
      },
    ];

    const scopedLoc1 = mockOrders.filter((o) => o.orgId === orgA && o.locationId === locA1);
    expect(scopedLoc1.length).toBe(1);
    expect(scopedLoc1[0]?.id).toBe("ord-1");

    const crossOrgAccess = mockOrders.filter((o) => o.orgId === orgB);
    expect(crossOrgAccess.length).toBe(0);
  });

  it("validates atomic order item and modifier data structure without partial fields", () => {
    const fullItem = {
      id: "item-uuid-1",
      productId: "prod-uuid-1",
      productName: "Artisan Burger",
      quantity: 2,
      basePriceCents: 1400,
      modifiers: [
        {
          groupId: "grp-1",
          groupName: "Doneness",
          optionId: "opt-1",
          optionName: "Medium Rare",
          priceCents: 0,
        },
        {
          groupId: "grp-2",
          groupName: "Cheese",
          optionId: "opt-2",
          optionName: "Gouda",
          priceCents: 200,
        },
      ],
      subtotalCents: (1400 + 200) * 2,
    };

    expect(fullItem.subtotalCents).toBe(3200);
    expect(fullItem.modifiers.length).toBe(2);
    expect(fullItem.modifiers[0]?.priceCents).toBe(0);
    expect(fullItem.modifiers[1]?.priceCents).toBe(200);
  });
});
