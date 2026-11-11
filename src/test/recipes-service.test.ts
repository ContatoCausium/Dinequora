import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  convertUnits,
  calculateIngredientCost,
  computeRecipeTotals,
  checkRecipeStockAvailability,
  type RecipeIngredient,
  type ProductRecipe,
} from "../lib/recipes-service";
import type { InventoryItem } from "../lib/inventory-service";
import { INVALID_VALUE_TEXT, fmtMoneyCents, fmtPercent } from "../lib/format";
import { setLogWriter } from "../lib/observability";

// Audit follow-up: an ingredient whose cost cannot be computed must never make the recipe look
// cheaper. The invalid state travels as NaN up to the screen, which shows "—" (never $0.00).
describe("recipe totals never turn an invalid cost into zero", () => {
  let lines: string[] = [];
  let restore: ReturnType<typeof setLogWriter>;
  beforeEach(() => {
    lines = [];
    restore = setLogWriter((line) => lines.push(line));
  });
  afterEach(() => setLogWriter(restore));

  const ingredient = (id: string, subtotalCostCents: number): RecipeIngredient => ({
    id,
    inventoryItemId: `inv-${id}`,
    name: id,
    quantity: 1,
    unit: "units",
    wastePercentage: 0,
    unitCostCents: subtotalCostCents,
    subtotalCostCents,
  });

  it("one invalid ingredient makes the total, the cost per serving and the margin invalid", () => {
    const calc = computeRecipeTotals(
      [ingredient("patty", 400), ingredient("sauce", Number.NaN)],
      2,
      1000,
    );
    expect(calc.totalCostCents).toBeNaN();
    expect(calc.costPerServingCents).toBeNaN();
    expect(calc.estimatedMarginPercent).toBeNaN();
    // On screen: "—", never the $2.00 of the valid part nor an 80% margin.
    expect(fmtMoneyCents(calc.totalCostCents, "en-US")).toBe(INVALID_VALUE_TEXT);
    expect(fmtMoneyCents(calc.costPerServingCents, "en-US")).toBe(INVALID_VALUE_TEXT);
    expect(fmtPercent(calc.estimatedMarginPercent / 100, "en-US")).toBe(INVALID_VALUE_TEXT);
    expect(lines.some((l) => l.includes("money.recipe_cost"))).toBe(true); // reported
  });

  it("the invalid state does not depend on the selling price", () => {
    const noPrice = computeRecipeTotals([ingredient("x", Number.NaN)], 1, 0);
    expect(noPrice.costPerServingCents).toBeNaN();
    expect(noPrice.estimatedMarginPercent).toBeNaN();
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    12.5, // a fraction of a cent is not a stored cost
    undefined as unknown as number, // a record saved before costs existed
    null as unknown as number, // NaN serialized by JSON.stringify
  ])("a stored cost of %s is invalid, not 0", (value) => {
    const calc = computeRecipeTotals([ingredient("x", value)], 1, 500);
    expect(calc.totalCostCents).toBeNaN();
    expect(calc.costPerServingCents).toBeNaN();
    expect(calc.estimatedMarginPercent).toBeNaN();
  });

  it("valid ingredients still add up exactly, rounded like the server", () => {
    const calc = computeRecipeTotals(
      [ingredient("a", 400), ingredient("b", 100), ingredient("c", 1)],
      2,
      1000,
    );
    expect(calc.totalCostCents).toBe(501);
    expect(calc.costPerServingCents).toBe(251); // 250.5 rounds half away from zero
    expect(calc.estimatedMarginPercent).toBe(74.9);
  });

  it("a legitimate zero stays zero: free ingredients and an empty recipe", () => {
    const free = computeRecipeTotals([ingredient("water", 0), ingredient("salt", 0)], 1, 1000);
    expect(free).toEqual({
      totalCostCents: 0,
      costPerServingCents: 0,
      estimatedMarginPercent: 100,
    });
    expect(fmtMoneyCents(free.costPerServingCents, "en-US")).toBe("$0.00");
    const empty = computeRecipeTotals([], 4, 0);
    expect(empty).toEqual({ totalCostCents: 0, costPerServingCents: 0, estimatedMarginPercent: 0 });
    expect(lines).toEqual([]); // nothing to report
  });

  it("combinations: zeros with a valid cost keep the valid total; with an invalid one, nothing", () => {
    const valid = computeRecipeTotals([ingredient("a", 0), ingredient("b", 250)], 1, 1000);
    expect(valid.totalCostCents).toBe(250);
    expect(valid.estimatedMarginPercent).toBe(75);
    const invalid = computeRecipeTotals(
      [ingredient("a", 0), ingredient("b", 250), ingredient("c", Number.NaN)],
      1,
      1000,
    );
    expect(invalid.totalCostCents).toBeNaN();
    expect(invalid.estimatedMarginPercent).toBeNaN();
  });

  it("a cost that cannot be computed is invalid from calculateIngredientCost onwards", () => {
    const flour: InventoryItem = {
      id: "inv-1",
      orgId: "org-test",
      locationId: "loc-1",
      name: "Flour",
      category: "dry_goods",
      sku: "FL-1",
      unit: "lb",
      quantity: 10,
      minQuantity: 1,
      costCents: 250,
      supplier: "Mill",
      active: true,
      updatedAt: new Date().toISOString(),
    };
    const bad = calculateIngredientCost(flour, Number.NaN, "lb", 0);
    expect(bad.subtotalCostCents).toBeNaN();
    const calc = computeRecipeTotals(
      [{ ...ingredient("flour", 0), ...bad, quantity: Number.NaN }],
      1,
      1000,
    );
    expect(calc.costPerServingCents).toBeNaN();
    expect(calc.estimatedMarginPercent).toBeNaN();
  });
});

describe("Recipes & Bill of Materials (BOM) Service", () => {
  it("converts units correctly between culinary measurements", () => {
    // oz to lb
    expect(convertUnits(16, "oz", "lb")).toBe(1);
    expect(convertUnits(8, "oz", "lb")).toBe(0.5);
    // lb to oz
    expect(convertUnits(1, "lb", "oz")).toBe(16);
  });

  it("calculates ingredient subtotal with waste/loss factor correctly", () => {
    const dummyBeef: InventoryItem = {
      id: "inv-beef",
      orgId: "org-test",
      locationId: "loc-1",
      name: "Angus Beef",
      category: "meat",
      sku: "BF-1",
      unit: "lb",
      quantity: 50,
      minQuantity: 10,
      costCents: 400, // $4.00 per lb
      supplier: "Test Vendor",
      active: true,
      updatedAt: new Date().toISOString(),
    };

    // 0.5 lb with 10% scrap waste => 0.55 lb * $4.00 = $2.20 (220 cents)
    const cost = calculateIngredientCost(dummyBeef, 0.5, "lb", 10);
    expect(cost.unitCostCents).toBe(400);
    expect(cost.subtotalCostCents).toBe(220);
  });

  it("computes recipe totals, cost per serving and profit margins", () => {
    const ingredients: RecipeIngredient[] = [
      {
        id: "ri-1",
        inventoryItemId: "inv-1",
        name: "Patty",
        quantity: 1,
        unit: "lb",
        wastePercentage: 0,
        unitCostCents: 400,
        subtotalCostCents: 400,
      },
      {
        id: "ri-2",
        inventoryItemId: "inv-2",
        name: "Bun",
        quantity: 1,
        unit: "units",
        wastePercentage: 0,
        unitCostCents: 100,
        subtotalCostCents: 100,
      },
    ];

    const calc = computeRecipeTotals(ingredients, 2, 1000); // 2 servings, selling price $10.00
    expect(calc.totalCostCents).toBe(500); // $5.00 total
    expect(calc.costPerServingCents).toBe(250); // $2.50 per serving
    // Margin = (1000 - 250) / 1000 = 75%
    expect(calc.estimatedMarginPercent).toBe(75);
  });

  it("flags insufficient ingredients correctly", () => {
    const recipe: ProductRecipe = {
      id: "recipe-1",
      orgId: "org-test",
      productId: "prod-1",
      productName: "Test Bread",
      servings: 1,
      yieldQuantity: 1,
      yieldUnit: "unit",
      totalCostCents: 0,
      costPerServingCents: 0,
      sellingPriceCents: 0,
      estimatedMarginPercent: 0,
      history: [],
      updatedAt: new Date().toISOString(),
      ingredients: [
        {
          id: "ri-1",
          inventoryItemId: "inv-1",
          name: "Flour",
          quantity: 10,
          unit: "lb",
          wastePercentage: 0,
          unitCostCents: 0,
          subtotalCostCents: 0,
        },
        {
          id: "ri-2",
          inventoryItemId: "inv-2",
          name: "Yeast",
          quantity: 2,
          unit: "lb",
          wastePercentage: 0,
          unitCostCents: 0,
          subtotalCostCents: 0,
        },
      ],
    };

    const inventory: InventoryItem[] = [
      {
        id: "inv-1",
        orgId: "org-test",
        locationId: "loc-1",
        name: "Flour",
        category: "dry_goods",
        sku: "FL-1",
        unit: "lb",
        quantity: 5,
        minQuantity: 0,
        costCents: 0,
        supplier: "Test Supplier",
        active: true,
        updatedAt: new Date().toISOString(),
      },
      {
        id: "inv-2",
        orgId: "org-test",
        locationId: "loc-1",
        name: "Yeast",
        category: "dry_goods",
        sku: "YS-1",
        unit: "lb",
        quantity: 20,
        minQuantity: 0,
        costCents: 0,
        supplier: "Test Supplier",
        active: true,
        updatedAt: new Date().toISOString(),
      },
    ];

    const alerts = checkRecipeStockAvailability(recipe, inventory, 1);
    expect(alerts[0]?.isSufficient).toBe(false);
    expect(alerts[1]?.isSufficient).toBe(true);
  });
});
