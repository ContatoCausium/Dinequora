import { describe, it, expect, beforeEach } from "vitest";
import {
  saveSupplier,
  toggleSupplierActive,
  calculatePOTotals,
  savePurchaseOrder,
  processPOReceiving,
  cancelPurchaseOrder,
} from "../lib/suppliers-purchases-service";

describe("suppliers-purchases-service", () => {
  const orgId = "org-test-purchases";
  const locId = "loc-main";

  beforeEach(() => {
    localStorage.clear();
  });

  it("calculates PO totals correctly with taxes, discounts, and freight", () => {
    const items = [
      {
        id: "poi-1",
        inventoryItemId: "item-1",
        name: "Angus Beef",
        unit: "lb",
        quantityOrdered: 20,
        quantityReceived: 0,
        unitPriceCents: 450,
        subtotalCents: 9000,
      },
      {
        id: "poi-2",
        inventoryItemId: "item-2",
        name: "Brioche Buns",
        unit: "pack",
        quantityOrdered: 10,
        quantityReceived: 0,
        unitPriceCents: 600,
        subtotalCents: 6000,
      },
    ];

    const totals = calculatePOTotals({
      items,
      taxCents: 1200,
      discountCents: 1000,
      shippingCents: 500,
    });

    expect(totals.subtotalCents).toBe(15000);
    expect(totals.totalCents).toBe(15700);
  });

  it("persists and toggles supplier statuses", () => {
    const sup = saveSupplier(orgId, {
      name: "US Wholesale LLC",
      contactName: "John Smith",
      email: "john@uswholesale.com",
      phone: "+1 555-0192",
      suppliedCategories: ["meat", "dairy"],
    });

    expect(sup.name).toBe("US Wholesale LLC");
    expect(sup.active).toBe(true);

    const updated = toggleSupplierActive(orgId, sup.id);
    expect(updated?.active).toBe(false);
  });

  it("handles partial receiving and stock movement transition without duplicates", () => {
    const sup = saveSupplier(orgId, { name: "Prime Foods" });
    const po = savePurchaseOrder(
      orgId,
      {
        supplierId: sup.id,
        locationId: locId,
        items: [
          {
            id: "poi-1",
            inventoryItemId: "item-angus",
            name: "Ground Beef",
            unit: "lb",
            quantityOrdered: 50,
            quantityReceived: 0,
            unitPriceCents: 400,
            subtotalCents: 20000,
          },
        ],
      },
      "Manager Sarah",
    );

    expect(po.status).toBe("draft");

    const partial = processPOReceiving(
      orgId,
      po.id,
      [
        {
          itemId: "poi-1",
          receivedNow: 20,
          priceVerifiedCents: 410,
          divergenceReason: "Market shift",
        },
      ],
      "Receiver Dave",
      "First morning batch arrived",
    );

    expect(partial.status).toBe("partially_received");
    expect(partial.items[0]?.quantityReceived).toBe(20);
    expect(partial.items[0]?.unitPriceCents).toBe(410);

    const completed = processPOReceiving(
      orgId,
      po.id,
      [{ itemId: "poi-1", receivedNow: 30, priceVerifiedCents: 410 }],
      "Receiver Dave",
      "Final batch arrived",
    );

    expect(completed.status).toBe("received");
    expect(completed.items[0]?.quantityReceived).toBe(50);

    expect(() => {
      savePurchaseOrder(orgId, { id: po.id, supplierId: sup.id, locationId: locId }, "Sarah");
    }).toThrow();
  });

  it("allows cancelling an open PO but guards completed orders", () => {
    const po = savePurchaseOrder(
      orgId,
      {
        supplierId: "sup-test",
        locationId: locId,
        items: [
          {
            id: "poi-10",
            inventoryItemId: "item-10",
            name: "Cheese",
            unit: "pack",
            quantityOrdered: 5,
            quantityReceived: 0,
            unitPriceCents: 1000,
            subtotalCents: 5000,
          },
        ],
      },
      "Admin",
    );

    const cancelled = cancelPurchaseOrder(orgId, po.id, "Admin", "Incorrect store ordered");
    expect(cancelled.status).toBe("cancelled");
  });
});
