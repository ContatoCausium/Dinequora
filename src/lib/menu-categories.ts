/**
 * Menu categories on the Menu & Products screen: ids, name collisions and archive eligibility.
 * Pure helpers; the database (0026-0028) still refuses archiving or deactivating a category that an
 * active product uses (category_in_use), whatever the screen shows.
 */

export type CategoryRef = { id: string; name: string; description?: string | undefined };
export type ArchivedCategoryRef = CategoryRef & { productCount: number };
export type ProductRef = { category: string; active: boolean };

/** Client id derived from a category name (stable, URL-safe); `fallback` when nothing is left. */
export function categoryIdFromName(name: string, fallback: () => string): string {
  const id = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
  return id || fallback();
}

export type CategoryCollision =
  | { kind: "none" }
  | { kind: "active"; category: CategoryRef }
  | { kind: "archived"; category: ArchivedCategoryRef };

/**
 * A NEW category (`id` = its derived client id) whose id or name matches an existing one would
 * overwrite it (the save is an upsert on the client id) or, for an archived one, silently
 * re-activate it: both are reported instead. For a rename, pass `id = null` and the other
 * categories: only the name is compared (two categories with the same name would be ambiguous).
 */
export function findCategoryCollision(
  name: string,
  id: string | null,
  active: readonly CategoryRef[],
  archived: readonly ArchivedCategoryRef[],
): CategoryCollision {
  const sameName = (c: CategoryRef) => c.name.trim().toLowerCase() === name.trim().toLowerCase();
  const a = active.find((c) => (id !== null && c.id === id) || sameName(c));
  if (a) return { kind: "active", category: a };
  const b = archived.find((c) => (id !== null && c.id === id) || sameName(c));
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
