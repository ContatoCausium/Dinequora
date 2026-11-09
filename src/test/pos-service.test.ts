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
  finalizeSale,
  listSuspendedSales,
  listPosHistory,
  type POSSession,
} from "../lib/pos-service";
import { MenuItem } from "../lib/menu-service";

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
    let session = getPOSSession("org-test", "loc-1", "Attendant Bob");
    expect(session.cart.length).toBe(0);
    expect(session.totalCents).toBe(0);

    session = addItemToCart(session, mockItem, [], 2);
    expect(session.cart.length).toBe(1);
    expect(session.subtotalCents).toBe(2400);
    // 8.88% (888 bp, the persisted rate) of 2400 cents = 213 cents
    expect(session.taxCents).toBe(213);
    expect(session.totalCents).toBe(2613);
  });

  it("updates item quantities and removes items when needed", () => {
    let session = getPOSSession("org-test", "loc-1", "Bob");
    session = addItemToCart(session, mockItem, [], 1);
    const itemId = session.cart[0]!.id;

    session = updateCartItemQuantity(session, itemId, 3);
    expect(session.subtotalCents).toBe(3600);

    session = removeItemFromCart(session, itemId);
    expect(session.cart.length).toBe(0);
    expect(session.totalCents).toBe(0);
  });

  it("applies authorized discounts correctly against taxable subtotal", () => {
    let session = getPOSSession("org-test", "loc-1", "Bob");
    session = addItemToCart(session, mockItem, [], 1);
    expect(session.subtotalCents).toBe(1200);

    session = applyDiscount(session, 200);
    // Taxable base = 1000, 8.88% of 1000 = 89
    expect(session.discountCents).toBe(200);
    expect(session.taxCents).toBe(89);
    expect(session.totalCents).toBe(1089);
  });

  it("suspends and resumes sales maintaining ticket state", () => {
    let session = getPOSSession("org-test", "loc-1", "Bob");
    session = addItemToCart(session, mockItem, [], 2);
    suspendSession(session);

    const suspended = listSuspendedSales("org-test", "loc-1");
    expect(suspended.length).toBe(1);
    expect(suspended[0]!.items.length).toBe(1);

    const resumed = resumeSession("org-test", session.id);
    expect(resumed).not.toBeNull();
    expect(resumed!.cart.length).toBe(1);
    expect(resumed!.subtotalCents).toBe(2400);

    expect(listSuspendedSales("org-test", "loc-1").length).toBe(0);
  });

  it("simulates payment and registers a completed simulated order in history", () => {
    let session = getPOSSession("org-test", "loc-1", "Bob");
    session = addItemToCart(session, mockItem, [], 1);
    const paid = simulatePayment(session, "cash", 2000);
    expect(paid.changeDueCents).toBe(calculateChange(2000, paid.totalCents));

    const finalized = finalizeSale(paid);
    expect(finalized.completedAt).toBeDefined();

    const history = listPosHistory("org-test", "loc-1");
    expect(history.length).toBe(1);
    expect(history[0]!.isSimulated).toBe(true);
  });
});
