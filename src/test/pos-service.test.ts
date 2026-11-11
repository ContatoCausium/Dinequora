import { describe, it, expect, beforeEach } from "vitest";
import {
  calculateChange,
  getPOSSession,
  addItemToCart,
  updateCartItemQuantity,
  removeItemFromCart,
  applyDiscount,
  suspendSession,
  resumeSession,
  simulatePayment,
  listSuspendedSales,
  posTaxConfigured,
  savePOSSession,
  type POSSession,
} from "../lib/pos-service";
import { MenuItem } from "../lib/menu-service";

// The store's configured sales-tax rate (parts per million): 8.88%, as the audited receipts.
const STORE_RATE_PPM = 88800;

const mockItem: MenuItem = {
  id: "test-item-1",
  orgId: "org-test",
  name: "Smash Cheeseburger",
  description: "Classic beef burger",
  category: "burgers",
  priceCents: 1200,
  prepTimeMinutes: 8,
  active: true,
  locationIds: [],
  modifierGroups: [],
  createdAt: new Date().toISOString(),
};

describe("POS Service calculations and lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("calculates change correctly for cash transactions", () => {
    expect(calculateChange(2000, 1500)).toBe(500);
    expect(calculateChange(1000, 1500)).toBe(0);
    expect(calculateChange(1500, 1500)).toBe(0);
  });

  it("adds items to cart and computes tax and total accurately", () => {
    let session = getPOSSession("org-test", "loc-1", "Attendant Bob", undefined, STORE_RATE_PPM);
    expect(session.cart.length).toBe(0);
    expect(session.totalCents).toBe(0);

    session = addItemToCart(session, mockItem, [], 2);
    expect(session.cart.length).toBe(1);
    expect(session.subtotalCents).toBe(2400);
    // 8.88% (88,800 ppm, the store's configured rate) of 2400 cents = 213 cents
    expect(session.taxCents).toBe(213);
    expect(session.totalCents).toBe(2613);
  });

  it("updates item quantities and removes items when needed", () => {
    let session = getPOSSession("org-test", "loc-1", "Bob", undefined, STORE_RATE_PPM);
    session = addItemToCart(session, mockItem, [], 1);
    const itemId = session.cart[0]!.id;

    session = updateCartItemQuantity(session, itemId, 3);
    expect(session.subtotalCents).toBe(3600);

    session = removeItemFromCart(session, itemId);
    expect(session.cart.length).toBe(0);
    expect(session.totalCents).toBe(0);
  });

  it("applies authorized discounts correctly against taxable subtotal", () => {
    let session = getPOSSession("org-test", "loc-1", "Bob", undefined, STORE_RATE_PPM);
    session = addItemToCart(session, mockItem, [], 1);
    expect(session.subtotalCents).toBe(1200);

    session = applyDiscount(session, 200);
    // Taxable base = 1000, 8.88% of 1000 = 89
    expect(session.discountCents).toBe(200);
    expect(session.taxCents).toBe(89);
    expect(session.totalCents).toBe(1089);
  });

  it("suspends and resumes sales maintaining ticket state", () => {
    let session = getPOSSession("org-test", "loc-1", "Bob", undefined, STORE_RATE_PPM);
    session = addItemToCart(session, mockItem, [], 2);
    suspendSession(session);

    const suspended = listSuspendedSales("org-test", "loc-1");
    expect(suspended.length).toBe(1);
    expect(suspended[0]!.items.length).toBe(1);

    const resumed = resumeSession("org-test", session.id, undefined, STORE_RATE_PPM);
    expect(resumed).not.toBeNull();
    expect(resumed!.cart.length).toBe(1);
    expect(resumed!.subtotalCents).toBe(2400);

    expect(listSuspendedSales("org-test", "loc-1").length).toBe(0);
  });

  it("computes cash change at checkout without writing any local sales history", () => {
    let session = getPOSSession("org-test", "loc-1", "Bob", undefined, STORE_RATE_PPM);
    session = addItemToCart(session, mockItem, [], 1);
    const paid = simulatePayment(session, "cash", 2000);
    expect(paid.changeDueCents).toBe(calculateChange(2000, paid.totalCents));
    // Sales are recorded only on the server; the legacy local history store is gone.
    expect(Object.keys(localStorage).some((k) => k.startsWith("servora.pos.history."))).toBe(false);
  });
});

// Migration 0025: the rate comes from the store; a store without a rate cannot sell; a held ticket
// is resumed with the store's current rate; a rate change recalculates an open ticket.
describe("POS Service: the store's sales-tax rate", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("previews with the store rate and never invents one", () => {
    let session = getPOSSession("org-test", "loc-1", "Bob", undefined, 88750);
    session = addItemToCart(session, mockItem, [], 1); // 1200 × 8.875% = 106.5 -> 107
    expect(session.taxRatePpm).toBe(88750);
    expect(session.taxCents).toBe(107);
    expect(session.totalCents).toBe(1307);
    expect(posTaxConfigured(session)).toBe(true);
    expect(() => getPOSSession("org-test", "loc-1", "Bob", undefined, 8.875)).toThrow(RangeError);
    expect(() => getPOSSession("org-test", "loc-1", "Bob", undefined, -1)).toThrow(RangeError);
  });

  it("a store without a configured rate previews no tax and is not ready to sell", () => {
    let session = getPOSSession("org-test", "loc-1", "Bob");
    session = addItemToCart(session, mockItem, [], 2);
    expect(session.taxRatePpm).toBeNull();
    expect(posTaxConfigured(session)).toBe(false);
    expect(session.taxCents).toBe(0);
    expect(session.totalCents).toBe(2400);
  });

  it("a rate change recalculates the open ticket", () => {
    let session = getPOSSession("org-test", "loc-1", "Bob", undefined, 62500);
    session = addItemToCart(session, mockItem, [], 1);
    expect(session.taxCents).toBe(75); // 1200 × 6.25%
    session = savePOSSession({ ...session, taxRatePpm: 70000 });
    expect(session.taxCents).toBe(84); // 1200 × 7%
    expect(session.totalCents).toBe(1284);
    session = savePOSSession({ ...session, taxRatePpm: null });
    expect(posTaxConfigured(session)).toBe(false);
    expect(session.taxCents).toBe(0);
  });

  it("a held ticket is resumed with the store's current rate, not the one it was held with", () => {
    let session = getPOSSession("org-test", "loc-1", "Bob", undefined, 62500);
    session = addItemToCart(session, mockItem, [], 2);
    expect(session.taxCents).toBe(150);
    suspendSession(session);
    const held = listSuspendedSales("org-test", "loc-1");
    expect(held).toHaveLength(1);
    expect(held[0]!.taxRatePpm).toBe(62500);
    // the owner changed the store to 8.875% meanwhile
    const resumed = resumeSession("org-test", session.id, undefined, 88750);
    expect(resumed).not.toBeNull();
    expect(resumed!.taxRatePpm).toBe(88750);
    expect(resumed!.subtotalCents).toBe(2400);
    expect(resumed!.taxCents).toBe(213); // 2400 × 8.875% = 213
    expect(resumed!.totalCents).toBe(2613);
    // ...or removed it: the resumed ticket cannot be charged until it is configured again
    suspendSession(resumed!);
    const again = resumeSession("org-test", session.id, undefined, null);
    expect(again!.taxRatePpm).toBeNull();
    expect(posTaxConfigured(again!)).toBe(false);
  });

  it("tickets held before 0025 (taxRatePercent) are still offered and get the current rate", () => {
    const legacy = {
      id: "legacy-1",
      orgId: "org-test",
      locationId: "loc-1",
      suspendedAt: new Date().toISOString(),
      orderType: "takeout",
      attendantName: "Ana",
      items: [
        {
          id: "i1",
          productId: "p1",
          productName: "Burger",
          quantity: 1,
          basePriceCents: 1000,
          modifiers: [],
          subtotalCents: 1000,
        },
      ],
      discountCents: 0,
      taxRatePercent: 8.88,
    };
    localStorage.setItem("servora.pos.suspended.org-test", JSON.stringify([legacy]));
    expect(listSuspendedSales("org-test", "loc-1")).toHaveLength(1);
    const resumed = resumeSession("org-test", "legacy-1", undefined, 70000);
    expect(resumed!.taxRatePpm).toBe(70000);
    expect(resumed!.taxCents).toBe(70);
    // a corrupted rate on a held ticket quarantines it like any other corrupted field
    localStorage.setItem(
      "servora.pos.suspended.org-test",
      JSON.stringify([{ ...legacy, id: "bad-2", taxRatePpm: 8.875 }]),
    );
    expect(listSuspendedSales("org-test", "loc-1")).toHaveLength(0);
  });
});
