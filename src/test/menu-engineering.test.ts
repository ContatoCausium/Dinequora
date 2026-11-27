import { describe, expect, it } from "vitest";
import { analyzeMenu, type MenuSalesRow, type RecipeCost } from "@/lib/menu-engineering";

const L1 = "store-1";
const L2 = "store-2";
const row = (product: string, units: number, sales: number, loc = L1): MenuSalesRow => ({
  location_id: loc,
  product_id: product,
  product_name: product,
  units,
  sales_cents: sales,
});
const cost = (product: string, cents: number, loc = L1): RecipeCost => ({
  productId: product,
  locationId: loc,
  costPerServingCents: cents,
});

describe("menu engineering", () => {
  // 4 dishes, 200 units: even share 25%, popular threshold 17.5%.
  // margins/unit: burger 10-4=6, fries 4-1=3, steak 30-12=18, salad 9-7=2
  // weighted average margin = (80*6 + 80*3 + 20*18 + 20*2) / 200 = (480+240+360+40)/200 = 5.60
  const rows = [
    row("burger", 80, 80_000),
    row("fries", 80, 32_000),
    row("steak", 20, 60_000),
    row("salad", 20, 18_000),
  ];
  const recipes = [
    cost("burger", 400),
    cost("fries", 100),
    cost("steak", 1200),
    cost("salad", 700),
  ];

  it("places each dish in its quadrant", () => {
    const r = analyzeMenu(rows, recipes);
    const cls = Object.fromEntries(r.items.map((i) => [i.productId, i.menuClass]));
    expect(cls).toEqual({ burger: "star", fries: "plowhorse", steak: "puzzle", salad: "dog" });
    expect(r.popularityThreshold).toBeCloseTo(0.175);
    expect(r.averageMarginCents).toBe(560);
    expect(r.totalUnits).toBe(200);
    expect(r.items.map((i) => i.productId)).toEqual(["burger", "fries", "steak", "salad"]);
    expect(r.items[0]).toMatchObject({ avgPriceCents: 1000, unitCostCents: 400, marginCents: 600 });
    expect(r.items[0]!.mix).toBeCloseTo(0.4);
  });

  it("never estimates a cost: a dish without a recipe (or with an unknown cost) is listed apart", () => {
    const r = analyzeMenu(
      [...rows, row("special", 50, 50_000), row("soup", 5, 2_000)],
      [...recipes, cost("soup", Number.NaN)],
    );
    expect(r.noCost.map((i) => i.productId)).toEqual(["special", "soup"]);
    expect(r.noCost[0]).toMatchObject({ unitCostCents: null, marginCents: null, menuClass: null });
    // the unclassified dishes do not move the thresholds
    expect(r.totalUnits).toBe(200);
    expect(r.averageMarginCents).toBe(560);
  });

  it("uses each store's own recipe cost and adds stores up", () => {
    const r = analyzeMenu(
      [row("burger", 10, 10_000, L1), row("burger", 10, 12_000, L2), row("fries", 10, 4_000)],
      [cost("burger", 400, L1), cost("burger", 600, L2), cost("fries", 100)],
    );
    const burger = r.items.find((i) => i.productId === "burger")!;
    expect(burger.units).toBe(20);
    expect(burger.avgPriceCents).toBe(1100);
    expect(burger.unitCostCents).toBe(500);
    expect(burger.marginCents).toBe(600);
  });

  it("a dish sold in a store without its recipe there has no known cost", () => {
    const r = analyzeMenu(
      [row("burger", 10, 10_000, L1), row("burger", 5, 5_000, L2), row("fries", 10, 4_000)],
      [cost("burger", 400, L1), cost("fries", 100)],
    );
    expect(r.noCost.map((i) => i.productId)).toEqual(["burger"]);
  });

  it("fewer than two costed dishes: no classification, no thresholds", () => {
    const r = analyzeMenu([row("burger", 10, 10_000)], [cost("burger", 400)]);
    expect(r.popularityThreshold).toBeNull();
    expect(r.items[0]).toMatchObject({ menuClass: null, marginCents: 600 });
    expect(analyzeMenu([], []).items).toEqual([]);
  });
});
