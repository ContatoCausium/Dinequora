import { z } from "zod";
import { RECIPE_UNITS } from "./units";

export const modifierGroupsSchema = z.array(
  z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    required: z.boolean(),
    minSelections: z.number().int().nonnegative(),
    maxSelections: z.number().int().positive(),
    options: z.array(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1),
        priceCents: z.number().int().nonnegative(),
      }),
    ),
  }),
);
export const menuItemSchema = z.object({
  id: z.string().min(1),
  orgId: z.string().min(1),
  name: z.string().min(1).max(160),
  description: z.string(),
  category: z.string().min(1),
  priceCents: z.number().int().nonnegative(),
  prepTimeMinutes: z.number().int().nonnegative(),
  imageUrl: z.string().optional(),
  notes: z.string().optional(),
  active: z.boolean(),
  locationIds: z.array(z.string().min(1)),
  modifierGroups: modifierGroupsSchema,
  createdAt: z.string(),
});
export const saleInputSchema = z.object({
  orgId: z.string().min(1),
  locationId: z.string().min(1),
  clientOrderId: z.string().min(1).max(160),
  orderType: z.enum(["dine_in", "takeout", "delivery"]),
  customerName: z.string(),
  customerPhone: z.string().optional(),
  customerEmail: z.string().optional(),
  deliveryAddress: z.string().optional(),
  tableNumber: z.string().optional(),
  notes: z.string().optional(),
  discountCents: z.number().int().nonnegative(),
  /**
   * The sales-tax rate the client displayed, in parts per million (88,750 = 8.875%). The server
   * charges the store's configured rate and refuses the sale when this differs from it
   * (tax_rate_changed), so a client can never choose the rate (migration 0025).
   */
  taxRatePpm: z.number().int().min(0).max(1_000_000),
  paymentMethod: z.enum(["cash", "card", "digital"]).optional(),
  isSimulation: z.boolean().default(false),
  items: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantity: z.number().int().min(1).max(1000),
        notes: z.string().optional(),
        modifiers: z.array(z.object({ groupId: z.string().min(1), optionId: z.string().min(1) })),
      }),
    )
    .min(1)
    .max(200),
});
export type SaleInput = z.input<typeof saleInputSchema>;

/**
 * What a recipe is made of, and nothing else. Cost snapshots (unitCostCents, subtotalCostCents)
 * are display values computed from the current stock cost; they are refused here so they can never
 * reach product_recipes.metadata, which members without inventory.costs can read (migration 0024).
 */
export const recipeIngredientInputSchema = z
  .object({
    inventoryItemId: z.string().min(1),
    quantity: z.number().positive().finite(),
    // Same list the server converts (units.ts); a stock unit such as "gal" must be accepted here.
    unit: z.enum(RECIPE_UNITS),
    wastePercentage: z.number().min(0).max(100).finite().default(0),
  })
  .strict();
export const recipePayloadSchema = z
  .object({
    id: z.string().min(1).optional(),
    productId: z.string().min(1),
    productName: z.string().optional(),
    servings: z.number().positive().finite(),
    yieldQuantity: z.number().positive().finite().optional(),
    yieldUnit: z.string().max(40).optional(),
    prepInstructions: z.string().max(4000).optional(),
    sellingPriceCents: z.number().int().nonnegative().optional(),
    ingredients: z.array(recipeIngredientInputSchema).min(1).max(200),
  })
  .strict();
export type RecipePayload = z.input<typeof recipePayloadSchema>;
