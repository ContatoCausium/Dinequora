import { describe, expect, it } from "vitest";
import { mapResources } from "@/lib/operational-mappers";

type Resources = Parameters<typeof mapResources>[0];

// A recipe's selling price is the linked menu product's price (single source). The copy kept in
// product_recipes.metadata is a legacy fallback, used only when the product is not readable.
function resources(recipe: Record<string, unknown>): Resources {
  return {
    orgId: "org-test",
    costsVisible: true,
    locations: [{ id: "L1", slug: "loc-1" }],
    inventory: [
      {
        id: "I1",
        location_id: "L1",
        name: "Beef patty 4 oz",
        category: "meat",
        sku: "BEEF",
        unit: "units",
        quantity: 50,
        min_quantity: 0,
        cost_cents: 210,
        supplier: "",
        active: true,
        updated_at: "2026-11-12T00:00:00.000Z",
        expiration_date: null,
      },
    ],
    recipes: [
      {
        id: "R1",
        product_id: "P1",
        location_id: "L1",
        servings: 1,
        yield_quantity: 1,
        yield_unit: "units",
        instructions: "",
        updated_at: "2026-11-12T00:00:00.000Z",
        recipe_ingredients: [
          { id: "RI1", inventory_item_id: "I1", quantity: 1, unit: "units", waste_percentage: 0 },
        ],
        ...recipe,
      },
    ],
    suppliers: [],
    purchases: [],
    expenses: [],
    movements: [],
    finance: [],
  } as unknown as Resources;
}

describe("recipe selling price comes from the menu product", () => {
  it("uses the menu product's current price and name, ignoring a stale or missing metadata copy", () => {
    const mapped = mapResources(
      resources({
        metadata: { productName: "Old name", sellingPriceCents: 0 },
        menu_products: { name: "Classic Burger", price_cents: 1350 },
      }),
    );
    const r = mapped.recipes[0]!;
    expect(r.sellingPriceCents).toBe(1350);
    expect(r.productName).toBe("Classic Burger");
    expect(r.priceFromMenu).toBe(true);
    expect(r.costPerServingCents).toBe(210);
    // (1350 - 210) / 1350 = 84.4%
    expect(r.estimatedMarginPercent).toBeCloseTo(84.4, 1);
  });

  it("a menu price change is reflected without touching the recipe", () => {
    const before = mapResources(
      resources({ metadata: {}, menu_products: { name: "Classic Burger", price_cents: 1350 } }),
    ).recipes[0]!;
    const after = mapResources(
      resources({ metadata: {}, menu_products: { name: "Classic Burger", price_cents: 1450 } }),
    ).recipes[0]!;
    expect(after.sellingPriceCents).toBe(1450);
    expect(after.estimatedMarginPercent).toBeGreaterThan(before.estimatedMarginPercent);
  });

  it("falls back to the metadata copy only when the product is not readable", () => {
    const r = mapResources(
      resources({
        metadata: { productName: "Legacy Bowl", sellingPriceCents: 1200 },
        menu_products: null,
      }),
    ).recipes[0]!;
    expect(r.sellingPriceCents).toBe(1200);
    expect(r.productName).toBe("Legacy Bowl");
    expect(r.priceFromMenu).toBe(false);
  });

  it("never invents a margin: no product and no copy means price 0 and margin 0", () => {
    const r = mapResources(resources({ metadata: {}, menu_products: null })).recipes[0]!;
    expect(r.sellingPriceCents).toBe(0);
    expect(r.estimatedMarginPercent).toBe(0);
  });
});
