import { describe, expect, it } from "vitest";
import { purchaseForecast, type ForecastItem } from "@/lib/purchase-forecast";

const item = (over: Partial<ForecastItem> & { id: string }): ForecastItem => ({
  name: over.id,
  unit: "units",
  locationId: "store-1",
  quantity: 10,
  minQuantity: 0,
  supplier: "",
  active: true,
  ...over,
});

describe("purchase forecast", () => {
  it("projects daily use, days of cover and what to buy for the cover period", () => {
    // Buns: 60 used in 30 days = 2/day; 10 on hand = 5 days; 7-day cover + min 4 - 10 = 8
    // Beef: 15 lb in 30 days = 0.5/day; 2 on hand = 4 days; 0.5*7 + 1 - 2 = 2.5
    const f = purchaseForecast(
      [
        item({ id: "buns", quantity: 10, minQuantity: 4, supplier: "Bakery" }),
        item({ id: "beef", unit: "lb", quantity: 2, minQuantity: 1 }),
      ],
      [
        { inventory_item_id: "buns", consumed: 60 },
        { inventory_item_id: "beef", consumed: 15 },
      ],
      30,
      7,
    );
    expect(f.lines.map((l) => l.id)).toEqual(["beef", "buns"]); // runs out first at the top
    expect(f.lines[1]).toMatchObject({
      dailyUse: 2,
      coverDays: 5,
      suggested: 8,
      supplier: "Bakery",
    });
    expect(f.lines[0]).toMatchObject({ dailyUse: 0.5, coverDays: 4, suggested: 2.5 });
  });

  it("rounds up: whole units for countable items, 0.1 for weights", () => {
    const f = purchaseForecast(
      [item({ id: "cans", quantity: 0 }), item({ id: "flour", unit: "kg", quantity: 0 })],
      [
        { inventory_item_id: "cans", consumed: 10 },
        { inventory_item_id: "flour", consumed: 10 },
      ],
      30,
      7,
    );
    // 10/30*7 = 2.333...
    expect(f.lines.find((l) => l.id === "cans")?.suggested).toBe(3);
    expect(f.lines.find((l) => l.id === "flour")?.suggested).toBe(2.4);
  });

  it("nothing to buy when the stock covers the period and the minimum", () => {
    const f = purchaseForecast(
      [item({ id: "salt", quantity: 100, minQuantity: 5 })],
      [{ inventory_item_id: "salt", consumed: 30 }],
      30,
      14,
    );
    expect(f.lines).toEqual([]);
  });

  it("never invents a quantity: no sales use means no suggestion, below-minimum items listed apart", () => {
    const f = purchaseForecast(
      [
        item({ id: "napkins", quantity: 2, minQuantity: 5 }),
        item({ id: "forks", quantity: 50, minQuantity: 5 }),
        item({ id: "old", quantity: 0, minQuantity: 5, active: false }),
      ],
      [],
      30,
      7,
    );
    expect(f.lines).toEqual([]);
    expect(f.belowMinimumNoUse.map((i) => i.id)).toEqual(["napkins"]);
  });

  it("sums several rows of the same item and ignores non-positive use", () => {
    const f = purchaseForecast(
      [item({ id: "buns", quantity: 0 })],
      [
        { inventory_item_id: "buns", consumed: 15 },
        { inventory_item_id: "buns", consumed: 15 },
        { inventory_item_id: "buns", consumed: -3 },
      ],
      30,
      7,
    );
    expect(f.lines[0]).toMatchObject({ dailyUse: 1, suggested: 7, coverDays: 0 });
  });
});
