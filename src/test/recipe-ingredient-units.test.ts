import { describe, expect, it } from "vitest";
import { ingredientForItem, type RecipeIngredient } from "../lib/recipes-service";
import type { InventoryItem, UnitOfMeasure } from "../lib/inventory-service";
import { recipeIngredientInputSchema, recipePayloadSchema } from "../lib/operational-contracts";
import { mapResources, type Resources } from "../lib/operational-mappers";
import { RECIPE_UNITS, convertQuantity, isRecipeUnit, unitFamily } from "../lib/units";

/**
 * Two defects found by the first E2E on the QA (2026-11-12), recipe editor and recipe contract:
 *  A. changing an ingredient's stock item kept the unit of the item the row was created with
 *     ("0.5 units" sent for a potato stocked in lb → incompatible_units on the server);
 *  B. the recipe unit lists (contract + read model) lacked "gal", which stock items may use and the
 *     server converts, so a lemonade base in gal could never be part of a recipe (invalid_recipe).
 */
const item = (id: string, unit: UnitOfMeasure, costCents: number): InventoryItem => ({
  id,
  orgId: "org-test",
  locationId: "loc-1",
  name: id,
  category: "dry_goods",
  sku: "",
  unit,
  quantity: 50,
  minQuantity: 0,
  costCents,
  supplier: "",
  active: true,
  updatedAt: "2026-11-12T00:00:00.000Z",
});
const patty = item("Beef patty", "units", 150);
const potato = item("Potato", "lb", 80);
const bun = item("Burger bun", "units", 40);
const lemonadeBase = item("Lemonade base", "gal", 600);

/** The row as the editor creates it (newIngredient): the first store item, quantity 1, its unit. */
const rowFor = (i: InventoryItem, quantity = 1): RecipeIngredient => ({
  id: "ri-1",
  inventoryItemId: i.id,
  name: i.name,
  quantity,
  unit: i.unit,
  wastePercentage: 0,
  unitCostCents: i.costCents,
  subtotalCostCents: i.costCents * quantity,
});
/** What the editor sends for a row (inventory.tsx handleSaveRecipeForm): the row's own unit. */
const payloadOf = (rows: RecipeIngredient[]) =>
  rows.map((i) => ({
    inventoryItemId: i.inventoryItemId,
    quantity: i.quantity,
    unit: i.unit,
    wastePercentage: i.wastePercentage,
  }));

describe("bug A: the ingredient unit follows the chosen stock item", () => {
  it("units → lb: unit, id, name and costs change; the quantity is not re-read in the new unit", () => {
    const row = ingredientForItem(rowFor(patty, 0.5), potato);
    expect(row).toMatchObject({ inventoryItemId: "Potato", name: "Potato", unit: "lb" });
    expect(row.quantity).toBe(1); // "0.5" typed for units is not silently kept as 0.5 lb
    expect(row.unitCostCents).toBe(80);
    expect(row.subtotalCostCents).toBe(80); // 1 lb × $0.80
    expect(row.id).toBe("ri-1");
    expect(row.wastePercentage).toBe(0);
  });

  it("lb → units: same rule in the other direction", () => {
    const row = ingredientForItem(rowFor(potato, 0.5), patty);
    expect(row).toMatchObject({ inventoryItemId: "Beef patty", unit: "units", quantity: 1 });
    expect(row.subtotalCostCents).toBe(150);
  });

  it("same unit: the typed quantity is preserved and only the costs are recomputed", () => {
    const row = ingredientForItem(rowFor(patty, 2), bun);
    expect(row).toMatchObject({ inventoryItemId: "Burger bun", unit: "units", quantity: 2 });
    expect(row.unitCostCents).toBe(40);
    expect(row.subtotalCostCents).toBe(80);
  });

  it("the waste percentage survives the swap and is applied to the new cost", () => {
    const row = ingredientForItem({ ...rowFor(patty, 1), wastePercentage: 10 }, potato);
    expect(row.wastePercentage).toBe(10);
    expect(row.subtotalCostCents).toBe(88); // 1 lb × 1.10 × $0.80
  });

  it("the payload carries the item's unit, which the server can convert; the old row could not", () => {
    const stale = { ...rowFor(patty, 0.5), inventoryItemId: potato.id, name: potato.name }; // pre-fix row
    expect(convertQuantity(stale.quantity, stale.unit, potato.unit)).toBeNull(); // incompatible_units
    const fixed = ingredientForItem(rowFor(patty, 0.5), potato);
    expect(convertQuantity(fixed.quantity, fixed.unit, potato.unit)).toBe(1);
    const parsed = recipeIngredientInputSchema.safeParse(payloadOf([fixed])[0]);
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.unit).toBe("lb");
  });
});

describe("bug B: every stock unit, gal included, is a valid recipe unit", () => {
  const recipe = (ingredients: ReturnType<typeof payloadOf>) => ({
    productId: "lemonade",
    productName: "QA Lemonade",
    servings: 1,
    yieldQuantity: 1,
    yieldUnit: "units",
    prepInstructions: "",
    sellingPriceCents: 300,
    ingredients,
  });

  it("accepts 0.1 gal of a gal-stocked ingredient", () => {
    const row = ingredientForItem(rowFor(patty), lemonadeBase);
    row.quantity = 0.1;
    const r = recipePayloadSchema.safeParse(recipe(payloadOf([row])));
    expect(r.success).toBe(true);
    expect(r.success && r.data.ingredients[0]).toMatchObject({ unit: "gal", quantity: 0.1 });
  });

  it("the recipe unit list covers every unit a stock item can have", () => {
    const stockUnits: UnitOfMeasure[] = ["oz", "lb", "gal", "kg", "units", "pack"];
    for (const u of stockUnits) {
      expect(isRecipeUnit(u), u).toBe(true);
      expect(
        recipeIngredientInputSchema.safeParse(payloadOf([rowFor(item("x", u, 1))])[0]).success,
        u,
      ).toBe(true);
    }
    expect(RECIPE_UNITS).toContain("gal");
    for (const u of ["oz", "lb", "g", "kg", "ml", "l", "units", "pack", "tsp", "tbsp", "cup"])
      expect(isRecipeUnit(u), u).toBe(true); // nothing previously accepted was dropped
  });

  it("still refuses unknown units and keeps the family rule (no cross-family conversion)", () => {
    for (const bad of ["handful", "", "GAL", "gallon"]) {
      expect(isRecipeUnit(bad), bad).toBe(false);
      expect(
        recipeIngredientInputSchema.safeParse({ inventoryItemId: "x", quantity: 1, unit: bad })
          .success,
        bad,
      ).toBe(false);
    }
    expect(unitFamily("gal")).toBe("volume");
    expect(convertQuantity(1, "gal", "ml")).toBe(3785.411784); // the server's factor
    expect(convertQuantity(1, "gal", "l")).toBeCloseTo(3.785411784, 9);
    expect(convertQuantity(1, "gal", "lb")).toBeNull(); // volume vs mass → incompatible_units
    expect(convertQuantity(1, "gal", "units")).toBeNull();
  });

  it("a stored recipe ingredient in gal is read back instead of throwing", () => {
    const resources = {
      orgId: "org-test",
      costsVisible: true,
      locations: [{ id: "L1", slug: "loc-1" }],
      inventory: [
        {
          id: "I1",
          location_id: "L1",
          name: "Lemonade base",
          category: "beverages",
          sku: "",
          unit: "gal",
          quantity: 5,
          min_quantity: 0,
          cost_cents: 600,
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
          metadata: { productName: "QA Lemonade", sellingPriceCents: 300 },
          updated_at: "2026-11-12T00:00:00.000Z",
          recipe_ingredients: [
            { id: "RI1", inventory_item_id: "I1", quantity: 0.1, unit: "gal", waste_percentage: 0 },
          ],
        },
      ],
      suppliers: [],
      purchases: [],
      expenses: [],
      movements: [],
    } as unknown as Resources;
    const mapped = mapResources(resources);
    expect(mapped.recipes[0]?.ingredients[0]).toMatchObject({ unit: "gal", quantity: 0.1 });
    expect(mapped.recipes[0]?.ingredients[0]?.subtotalCostCents).toBe(60); // 0.1 gal × $6.00
  });
});
