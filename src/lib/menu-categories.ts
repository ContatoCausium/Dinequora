/**
 * Menu categories on the Menu & Products screen: ids, name collisions and archive eligibility.
 * Pure helpers; the database (0026-0028) still refuses archiving or deactivating a category that an
 * active product uses (category_in_use), whatever the screen shows.
 *
 * Known limit (database behaviour, not changed here): the category save is an upsert on
 * (org_id, client_id) that also sets active = true. Two sessions creating the same category at the
 * same moment end with one category (the last save wins), and renaming a category that another
 * session archived a moment ago re-activates it. The screen checks against the latest data it read.
 */

export type CategoryRef = { id: string; name: string; description?: string | undefined };
export type ArchivedCategoryRef = CategoryRef & { productCount: number };
export type ProductRef = { category: string; active: boolean };

/** URL-safe form of a name: accents, case, spacing and punctuation removed. May be empty. */
export function categoryKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

/** Client id derived from a category name (stable, URL-safe); `fallback` when nothing is left. */
export function categoryIdFromName(name: string, fallback: () => string): string {
  return categoryKey(name) || fallback();
}

/**
 * First free id from `base` (`base`, `base-2`, `base-3`…). Ids are opaque: after a rename, the old
 * name's id still belongs to the renamed category, so a new category with that name needs another
 * id (otherwise the save, an upsert on the id, would overwrite the renamed category).
 */
export function uniqueCategoryId(base: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
}

export type CategoryCollision =
  | { kind: "none" }
  | { kind: "active"; category: CategoryRef }
  | { kind: "archived"; category: ArchivedCategoryRef };

/**
 * Another category with the same name, compared without accents, case, spacing or punctuation
 * ("Cafés" = "cafes" = "Cafés."). Pass the other categories only (for a rename, exclude itself).
 */
export function findCategoryCollision(
  name: string,
  active: readonly CategoryRef[],
  archived: readonly ArchivedCategoryRef[],
): CategoryCollision {
  const key = categoryKey(name) || name.trim().toLowerCase();
  const same = (c: CategoryRef) => (categoryKey(c.name) || c.name.trim().toLowerCase()) === key;
  const a = active.find(same);
  if (a) return { kind: "active", category: a };
  const b = archived.find(same);
  if (b) return { kind: "archived", category: b };
  return { kind: "none" };
}

export type CategoryUsage = { total: number; active: number };

/** Products per category id (all, and active ones). */
export function categoryUsage(products: readonly ProductRef[]): Map<string, CategoryUsage> {
  const usage = new Map<string, CategoryUsage>();
  for (const p of products) {
    const u = usage.get(p.category) ?? { total: 0, active: 0 };
    u.total += 1;
    if (p.active) u.active += 1;
    usage.set(p.category, u);
  }
  return usage;
}

/** A category can be archived only while no active product uses it (category_in_use otherwise). */
export function canArchiveCategory(usage: CategoryUsage | undefined): boolean {
  return (usage?.active ?? 0) === 0;
}

/** A product whose category is not an active category of the menu (archived or missing). */
export function hasActiveCategory(product: ProductRef, active: readonly CategoryRef[]): boolean {
  return product.category !== "" && active.some((c) => c.id === product.category);
}
