import { listInventory, type InventoryItem, type UnitOfMeasure } from "./inventory-service";
import {
  assertTenantContext,
  isLocationAllowed,
  readTenantRecords,
  TenantContextError,
  writeTenantRecords,
} from "./tenant-storage";
import { multiplyQuantityCents, roundCents } from "./money";
import { convertQuantity } from "./units";
import { displayAmount } from "./format";

/** Store-restricted callers may only write store-specific recipes in their stores; org-wide recipes need an org-wide caller. */
function assertRecipeWritable(
  locationId: string | undefined,
  allowedLocationIds: readonly string[] | undefined,
): void {
  if (!allowedLocationIds) return;
  if (!locationId || !allowedLocationIds.includes(locationId))
    throw new TenantContextError("location_forbidden");
}

export type RecipeUnit =
  "oz" | "lb" | "g" | "kg" | "ml" | "l" | "units" | "pack" | "tsp" | "tbsp" | "cup";

export interface RecipeIngredient {
  id: string;
  inventoryItemId: string;
  name: string;
  quantity: number;
  unit: RecipeUnit;
  wastePercentage: number; // e.g. 5 = 5% scrap/cooking loss
  unitCostCents: number; // snapshot cost per unit in USD cents
  subtotalCostCents: number; // calculated cost with waste
  notes?: string | undefined;
}

export interface RecipeHistoryEntry {
  id: string;
  timestamp: string;
  performedBy: string;
  action: "created" | "updated" | "component_swapped" | "price_sync";
  details: string;
}

export interface ProductRecipe {
  id: string;
  orgId: string;
  productId: string;
  productName: string;
  locationId?: string | undefined;
  servings: number;
  yieldQuantity: number;
  yieldUnit: string;
  ingredients: RecipeIngredient[];
  prepInstructions?: string;
  totalCostCents: number;
  costPerServingCents: number;
  sellingPriceCents: number;
  estimatedMarginPercent: number;
  history: RecipeHistoryEntry[];
  updatedAt: string;
}

export interface IngredientAvailabilityAlert {
  ingredientName: string;
  requiredQty: number;
  availableQty: number;
  unit: string;
  isSufficient: boolean;
}

/**
 * Recipe quantity in the stock item's unit, with the server's factors (units.ts =
 * public.operational_unit_quantity). Units of different families cannot be converted; the server
 * refuses such a recipe when it is saved, so the editor keeps the typed quantity for its preview.
 */
export function convertUnits(qty: number, from: RecipeUnit, to: UnitOfMeasure): number {
  return convertQuantity(qty, from, to) ?? qty;
}

export function calculateIngredientCost(
  inventoryItem: InventoryItem,
  qty: number,
  unit: RecipeUnit,
  wastePercentage = 0,
): { unitCostCents: number; subtotalCostCents: number } {
  const convertedQty = convertUnits(qty, unit, inventoryItem.unit);
  const wasteFactor = 1 + Math.max(0, wastePercentage) / 100;
  const netQty = convertedQty * wasteFactor;
  const subtotalCostCents = displayAmount(
    () => multiplyQuantityCents(netQty, inventoryItem.costCents),
    "money.recipe_cost",
  );
  return {
    unitCostCents: inventoryItem.costCents,
    subtotalCostCents,
  };
}

export function computeRecipeTotals(
  ingredients: RecipeIngredient[],
  servings: number,
  sellingPriceCents: number,
): {
  totalCostCents: number;
  costPerServingCents: number;
  estimatedMarginPercent: number;
} {
  const totalCostCents = ingredients.reduce((acc, i) => acc + (i.subtotalCostCents || 0), 0);
  const safeServings = Math.max(1, servings || 1);
  const costPerServingCents = displayAmount(
    () => roundCents(totalCostCents / safeServings),
    "money.recipe_cost",
  );

  let estimatedMarginPercent = 0;
  if (sellingPriceCents > 0) {
    const profit = sellingPriceCents - costPerServingCents;
    estimatedMarginPercent = Math.round((profit / sellingPriceCents) * 1000) / 10;
  }

  return {
    totalCostCents,
    costPerServingCents,
    estimatedMarginPercent,
  };
}

const SEED_RECIPES: ProductRecipe[] = [
  {
    id: "recipe-smash-classic",
    orgId: "demo",
    productId: "demo-p-1",
    productName: "Classic American Cheeseburger",
    locationId: "loc-1",
    servings: 1,
    yieldQuantity: 1,
    yieldUnit: "serving",
    ingredients: [
      {
        id: "ri-1",
        inventoryItemId: "inv-1",
        name: "Ground Angus Beef (80/20)",
        quantity: 0.35,
        unit: "lb",
        wastePercentage: 8,
        unitCostCents: 425,
        subtotalCostCents: 161,
        notes: "6oz smash patty with sear shrinkage",
      },
      {
        id: "ri-2",
        inventoryItemId: "inv-2",
        name: "Artisan Brioche Buns",
        quantity: 1,
        unit: "units",
        wastePercentage: 2,
        unitCostCents: 65,
        subtotalCostCents: 66,
        notes: "Toasted with butter",
      },
      {
        id: "ri-3",
        inventoryItemId: "inv-3",
        name: "Sharp Aged Cheddar Slices",
        quantity: 0.12,
        unit: "lb",
        wastePercentage: 0,
        unitCostCents: 520,
        subtotalCostCents: 62,
        notes: "2 thick slices melted",
      },
      {
        id: "ri-4",
        inventoryItemId: "inv-6",
        name: "Compostable Burger Boxes",
        quantity: 1,
        unit: "units",
        wastePercentage: 0,
        unitCostCents: 22,
        subtotalCostCents: 22,
      },
    ],
    prepInstructions:
      "1. Toast brioche on flat-top. 2. Smash patty to 1/4 inch on 425F griddle with pinch salt/pepper. 3. Melt 2 slices sharp cheddar under cloche for 20s. 4. Box immediately.",
    totalCostCents: 311,
    costPerServingCents: 311,
    sellingPriceCents: 1499,
    estimatedMarginPercent: 79.2,
    history: [
      {
        id: "h-1",
        timestamp: new Date(Date.now() - 86400000 * 3).toISOString(),
        performedBy: "Executive Chef",
        action: "created",
        details: "Initial standardized technical recipe created for flagship burger.",
      },
    ],
    updatedAt: new Date().toISOString(),
  },
  {
    id: "recipe-truffle-fries",
    orgId: "demo",
    productId: "demo-p-2",
    productName: "Truffle Parmesan Fries",
    locationId: "loc-1",
    servings: 1,
    yieldQuantity: 1,
    yieldUnit: "basket",
    ingredients: [
      {
        id: "ri-5",
        inventoryItemId: "inv-5",
        name: "Organic Russet Potatoes (50lb)",
        quantity: 0.6,
        unit: "lb",
        wastePercentage: 12,
        unitCostCents: 75,
        subtotalCostCents: 50,
        notes: "Hand cut and double blanched",
      },
      {
        id: "ri-6",
        inventoryItemId: "inv-4",
        name: "White Truffle Oil (Italian)",
        quantity: 0.35,
        unit: "oz",
        wastePercentage: 3,
        unitCostCents: 180,
        subtotalCostCents: 65,
        notes: "Drizzle immediately after frying",
      },
    ],
    prepInstructions:
      "Fry at 365F for 3.5 minutes until golden. Toss in steel bowl with sea salt, parsley and truffle oil.",
    totalCostCents: 115,
    costPerServingCents: 115,
    sellingPriceCents: 750,
    estimatedMarginPercent: 84.7,
    history: [
      {
        id: "h-2",
        timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
        performedBy: "Kitchen Manager",
        action: "created",
        details: "Side item technical sheet registered.",
      },
    ],
    updatedAt: new Date().toISOString(),
  },
];

function readRecipesStore(orgId: string): ProductRecipe[] {
  return readTenantRecords<ProductRecipe>("product_recipes", orgId, () =>
    orgId === "demo" ? SEED_RECIPES : [],
  );
}

function writeRecipesStore(orgId: string, recipes: ProductRecipe[]): void {
  writeTenantRecords("product_recipes", orgId, recipes);
}

export function listProductRecipes(
  orgId: string,
  locationId?: string,
  allowedLocationIds?: readonly string[],
): ProductRecipe[] {
  assertTenantContext(orgId);
  if (locationId && locationId !== "all" && !isLocationAllowed(locationId, allowedLocationIds))
    return [];
  const all = readRecipesStore(orgId);
  return all.filter((r) => {
    const matchOrg = r.orgId === orgId;
    const matchLoc =
      !locationId || locationId === "all" || !r.locationId || r.locationId === locationId;
    // Org-wide recipes (no store) are readable by every member; store recipes only by authorized stores.
    const allowed = !r.locationId || isLocationAllowed(r.locationId, allowedLocationIds);
    return matchOrg && matchLoc && allowed;
  });
}

export function getProductRecipe(
  orgId: string,
  recipeId: string,
  allowedLocationIds?: readonly string[],
): ProductRecipe | undefined {
  return listProductRecipes(orgId, undefined, allowedLocationIds).find((r) => r.id === recipeId);
}

export function saveProductRecipe(
  orgId: string,
  recipe: Omit<ProductRecipe, "id" | "updatedAt"> & { id?: string | undefined },
  performedBy = "Operator",
  allowedLocationIds?: readonly string[],
): ProductRecipe {
  const all = readRecipesStore(orgId);
  assertRecipeWritable(recipe.locationId, allowedLocationIds);
  const existing = recipe.id ? all.find((r) => r.id === recipe.id) : undefined;
  if (existing) assertRecipeWritable(existing.locationId, allowedLocationIds);
  const now = new Date().toISOString();
  const isNew = !recipe.id;
  const id = recipe.id || `recipe-${crypto.randomUUID()}`;

  const calculated = computeRecipeTotals(
    recipe.ingredients,
    recipe.servings,
    recipe.sellingPriceCents,
  );

  const newHistoryEntry: RecipeHistoryEntry = {
    id: `hist-${Date.now()}`,
    timestamp: now,
    performedBy,
    action: isNew ? "created" : "updated",
    details: isNew ? "Ficha técnica criada." : "Ficha técnica atualizada e custos recalculados.",
  };

  const history = [...(recipe.history || []), newHistoryEntry];

  const saved: ProductRecipe = {
    ...recipe,
    id,
    orgId,
    totalCostCents: calculated.totalCostCents,
    costPerServingCents: calculated.costPerServingCents,
    estimatedMarginPercent: calculated.estimatedMarginPercent,
    history,
    updatedAt: now,
  };

  const idx = all.findIndex((r) => r.id === id);
  if (idx >= 0) {
    all[idx] = saved;
  } else {
    all.unshift(saved);
  }

  writeRecipesStore(orgId, all);
  return saved;
}

export function duplicateProductRecipe(
  orgId: string,
  recipeId: string,
  performedBy = "Operator",
  allowedLocationIds?: readonly string[],
): ProductRecipe {
  const original = getProductRecipe(orgId, recipeId, allowedLocationIds);
  if (!original) throw new Error("Receita original não encontrada.");

  return saveProductRecipe(
    orgId,
    {
      ...original,
      id: undefined,
      productName: `${original.productName} (Cópia)`,
      history: [],
    },
    performedBy,
    allowedLocationIds,
  );
}

export function checkRecipeStockAvailability(
  recipe: ProductRecipe,
  inventoryItems: InventoryItem[],
  batchCount = 1,
): IngredientAvailabilityAlert[] {
  return recipe.ingredients.map((ing) => {
    const item = inventoryItems.find((i) => i.id === ing.inventoryItemId);
    const reqInItemUnit = convertUnits(
      ing.quantity * batchCount,
      ing.unit,
      item ? item.unit : "units",
    );
    const available = item ? item.quantity : 0;
    return {
      ingredientName: ing.name,
      requiredQty: Math.round(reqInItemUnit * 100) / 100,
      availableQty: available,
      unit: item ? item.unit : ing.unit,
      isSufficient: available >= reqInItemUnit,
    };
  });
}

export function syncRecipeWithInventoryPrices(
  orgId: string,
  recipeId: string,
  performedBy = "System",
  allowedLocationIds?: readonly string[],
): ProductRecipe {
  const recipe = getProductRecipe(orgId, recipeId, allowedLocationIds);
  if (!recipe) throw new Error("Receita não encontrada.");

  const inventory = listInventory(orgId, recipe.locationId, allowedLocationIds);
  const updatedIngredients = recipe.ingredients.map((ing) => {
    const invItem = inventory.find((i) => i.id === ing.inventoryItemId);
    if (!invItem) return ing;
    const costs = calculateIngredientCost(invItem, ing.quantity, ing.unit, ing.wastePercentage);
    return {
      ...ing,
      unitCostCents: costs.unitCostCents,
      subtotalCostCents: costs.subtotalCostCents,
    };
  });

  return saveProductRecipe(
    orgId,
    {
      ...recipe,
      ingredients: updatedIngredients,
    },
    performedBy,
    allowedLocationIds,
  );
}

// Simulation function: computes what ingredients would be deducted by an order without modifying balances
export function simulateOrderIngredientConsumption(
  orgId: string,
  locationId: string,
  orderProductIds: string[],
  allowedLocationIds?: readonly string[],
) {
  const recipes = listProductRecipes(orgId, locationId, allowedLocationIds);
  const inventory = listInventory(orgId, locationId, allowedLocationIds);
  const consumptionMap: Record<
    string,
    { itemName: string; totalConsumedQty: number; unit: string; currentStock: number }
  > = {};

  for (const pid of orderProductIds) {
    const recipe = recipes.find((r) => r.productId === pid || r.id === pid);
    if (!recipe) continue;

    for (const ing of recipe.ingredients) {
      const invItem = inventory.find((i) => i.id === ing.inventoryItemId);
      const consumed = convertUnits(ing.quantity, ing.unit, invItem ? invItem.unit : "units");
      const key = ing.inventoryItemId;

      if (!consumptionMap[key]) {
        consumptionMap[key] = {
          itemName: ing.name,
          totalConsumedQty: 0,
          unit: invItem ? invItem.unit : ing.unit,
          currentStock: invItem ? invItem.quantity : 0,
        };
      }
      const currentEntry = consumptionMap[key];
      if (currentEntry) {
        currentEntry.totalConsumedQty += consumed;
      }
    }
  }

  return Object.values(consumptionMap);
}
