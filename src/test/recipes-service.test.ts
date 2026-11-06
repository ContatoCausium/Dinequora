import { describe, it, expect } from "vitest";
import {
  convertUnits,
  calculateIngredientCost,
  computeRecipeTotals,
  checkRecipeStockAvailability,
  type RecipeIngredient,
} from "../lib/recipes-service";
import type { InventoryItem } from "../lib/inventory-service";

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
    const recipe: any = {
      ingredients: [
        { inventoryItemId: "inv-1", name: "Flour", quantity: 10, unit: "lb" },
        { inventoryItemId: "inv-2", name: "Yeast", quantity: 2, unit: "lb" },
      ],
    };

    const inventory: any = [
      { id: "inv-1", quantity: 5, unit: "lb" }, // Insufficient (needs 10)
      { id: "inv-2", quantity: 20, unit: "lb" }, // Sufficient
    ];

    const alerts = checkRecipeStockAvailability(recipe, inventory, 1);
    expect(alerts[0]?.isSufficient).toBe(false);
    expect(alerts[1]?.isSufficient).toBe(true);
  });
});
