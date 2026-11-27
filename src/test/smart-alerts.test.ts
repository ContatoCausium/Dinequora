import { describe, expect, it } from "vitest";
import { salesDrop, supplierPriceIncreases, type PurchaseRow } from "@/lib/smart-alerts";

describe("sales drop", () => {
  it("alerts at a drop of 15% or more against the previous period", () => {
    expect(salesDrop(8_000, 10_000)?.change).toBeCloseTo(-0.2);
    expect(salesDrop(8_500, 10_000)?.change).toBeCloseTo(-0.15);
    expect(salesDrop(9_000, 10_000)).toBeNull();
    expect(salesDrop(12_000, 10_000)).toBeNull();
  });
  it("no previous figure, no comparison", () => {
    expect(salesDrop(0, 0)).toBeNull();
    expect(salesDrop(5_000, 0)).toBeNull();
  });
});

describe("supplier price increases", () => {
  const po = (
    id: string,
    at: string,
    lines: [string, number][],
    status = "received",
    supplier = "s1",
  ): PurchaseRow => ({
    id,
    status,
    supplier_id: supplier,
    created_at: at,
    purchase_order_items: lines.map(([item, cents]) => ({
      inventory_item_id: item,
      unit_price_cents: cents,
      quantity_ordered: 10,
    })),
  });
  const names = {
    items: new Map([
      ["beef", "Ground beef"],
      ["buns", "Buns"],
    ]),
    suppliers: new Map([["s1", "Prime Meats"]]),
  };

  it("compares the latest order's price with the one before it, biggest rise first", () => {
    const list = supplierPriceIncreases(
      [
        po("a", "2026-11-01T10:00:00Z", [
          ["beef", 500],
          ["buns", 40],
        ]),
        po("b", "2026-11-10T10:00:00Z", [
          ["beef", 520],
          ["buns", 50],
        ]),
        po("c", "2026-11-20T10:00:00Z", [["beef", 600]]),
      ],
      names,
    );
    // beef: 520 -> 600 = +15.4%; buns: 40 -> 50 = +25%
    expect(list.map((p) => p.itemId)).toEqual(["buns", "beef"]);
    expect(list[1]).toMatchObject({
      itemName: "Ground beef",
      supplierName: "Prime Meats",
      previousCents: 520,
      latestCents: 600,
    });
    expect(list[1]!.change).toBeCloseTo(80 / 520);
  });

  it("drafts and cancelled orders are not agreed prices; a rise under 10% is not an alert", () => {
    const list = supplierPriceIncreases(
      [
        po("a", "2026-11-01T10:00:00Z", [["beef", 500]]),
        po("b", "2026-11-10T10:00:00Z", [["beef", 900]], "draft"),
        po("c", "2026-11-11T10:00:00Z", [["beef", 900]], "cancelled"),
        po("d", "2026-11-12T10:00:00Z", [["beef", 540]], "sent"),
      ],
      names,
    );
    expect(list).toEqual([]);
  });

  it("one order is not a trend; unknown names stay honest", () => {
    expect(
      supplierPriceIncreases([po("a", "2026-11-01T10:00:00Z", [["beef", 500]])], names),
    ).toEqual([]);
    const list = supplierPriceIncreases(
      [
        po("a", "2026-11-01T10:00:00Z", [["x", 100]], "received", "s9"),
        po("b", "2026-11-02T10:00:00Z", [["x", 200]], "received", "s9"),
      ],
      names,
    );
    expect(list[0]).toMatchObject({ itemName: "x", supplierName: null, change: 1 });
  });
});
