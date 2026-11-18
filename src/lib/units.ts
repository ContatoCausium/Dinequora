/**
 * Units of measure for stock and recipes, with the SAME factors as the database function
 * public.operational_unit_quantity (used when a sale consumes stock and when a recipe is saved), so
 * the cost shown while editing a recipe is the cost the server will book.
 *
 * Mass and volume are separate families; "oz" is the avoirdupois ounce (mass), as on the server.
 * Count units ("units", "pack") only convert to themselves. Converting across families returns
 * null — the server refuses those recipes ("incompatible_units").
 */
const MASS_IN_GRAMS: Readonly<Record<string, number>> = {
  g: 1,
  kg: 1000,
  lb: 453.59237,
  oz: 28.349523125,
};
const VOLUME_IN_ML: Readonly<Record<string, number>> = {
  ml: 1,
  l: 1000,
  gal: 3785.411784,
  tsp: 4.928921594,
  tbsp: 14.78676478,
  cup: 236.5882365,
};

/**
 * Every unit a recipe ingredient may use: the three families above, as the server converts them.
 * This is the single list behind the recipe contract (operational-contracts.ts), the recipe read
 * model (operational-mappers.ts) and the editor type, so a unit the server can convert ("gal" was
 * missing from the former copies) is never refused before it reaches the server.
 */
export const RECIPE_UNITS = [
  "oz",
  "lb",
  "g",
  "kg",
  "ml",
  "l",
  "gal",
  "units",
  "pack",
  "tsp",
  "tbsp",
  "cup",
] as const;
export type RecipeUnit = (typeof RECIPE_UNITS)[number];
export function isRecipeUnit(unit: string): unit is RecipeUnit {
  return (RECIPE_UNITS as readonly string[]).includes(unit);
}

export type UnitFamily = "mass" | "volume" | "count";

export function unitFamily(unit: string): UnitFamily | null {
  if (unit in MASS_IN_GRAMS) return "mass";
  if (unit in VOLUME_IN_ML) return "volume";
  if (unit === "units" || unit === "pack") return "count";
  return null;
}

/** qty expressed in `to`, or null when the two units cannot be converted (different families). */
export function convertQuantity(qty: number, from: string, to: string): number | null {
  if (from === to) return qty;
  const massFrom = MASS_IN_GRAMS[from];
  const massTo = MASS_IN_GRAMS[to];
  if (massFrom !== undefined && massTo !== undefined) return (qty * massFrom) / massTo;
  const volFrom = VOLUME_IN_ML[from];
  const volTo = VOLUME_IN_ML[to];
  if (volFrom !== undefined && volTo !== undefined) return (qty * volFrom) / volTo;
  return null;
}
