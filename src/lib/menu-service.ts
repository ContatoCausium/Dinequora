import { assertScopeWritable, assertTenantContext, isScopeVisible } from "./tenant-storage";
export type ModifierOption = {
  id: string;
  name: string;
  priceCents: number;
};

export type ModifierGroup = {
  id: string;
  name: string;
  required: boolean;
  minSelections: number;
  maxSelections: number;
  options: ModifierOption[];
};

export type MenuItem = {
  id: string;
  orgId: string;
  name: string;
  description: string;
  category: string;
  priceCents: number;
  prepTimeMinutes: number;
  imageUrl?: string | undefined;
  notes?: string | undefined;
  active: boolean;
  locationIds: string[]; // empty array = all locations
  modifierGroups: ModifierGroup[];
  createdAt: string;
};

export type MenuCategory = {
  id: string;
  name: string;
  description?: string | undefined;
};

const STORAGE_KEY_PREFIX = "servora.menu.";

const INITIAL_CATEGORIES: MenuCategory[] = [];

function getStoreKey(orgId: string, suffix: string) {
  return `${STORAGE_KEY_PREFIX}${assertTenantContext(orgId)}.${suffix}`;
}

export function listCategories(orgId: string): MenuCategory[] {
  if (!orgId || typeof window === "undefined") return [];
  const saved = localStorage.getItem(getStoreKey(orgId, "categories"));
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Categories are organization-wide: store-restricted callers cannot change them. */
export function saveCategory(
  orgId: string,
  category: MenuCategory,
  allowedLocationIds?: readonly string[],
): MenuCategory[] {
  assertTenantContext(orgId);
  assertScopeWritable([], allowedLocationIds);
  const existing = listCategories(orgId);
  const index = existing.findIndex((c) => c.id === category.id);
  const updated =
    index >= 0 ? existing.map((c, i) => (i === index ? category : c)) : [...existing, category];
  if (typeof window !== "undefined") {
    localStorage.setItem(getStoreKey(orgId, "categories"), JSON.stringify(updated));
  }
  return updated;
}

export function deleteCategory(
  orgId: string,
  categoryId: string,
  allowedLocationIds?: readonly string[],
): MenuCategory[] {
  assertTenantContext(orgId);
  assertScopeWritable([], allowedLocationIds);
  const existing = listCategories(orgId);
  const updated = existing.filter((c) => c.id !== categoryId);
  if (typeof window !== "undefined") {
    localStorage.setItem(getStoreKey(orgId, "categories"), JSON.stringify(updated));
  }
  return updated;
}

export function duplicateMenuItem(
  orgId: string,
  itemId: string,
  allowedLocationIds?: readonly string[],
): MenuItem[] {
  const existing = listMenuItems(orgId, allowedLocationIds);
  const target = existing.find((i) => i.id === itemId);
  if (!target) return existing;
  const duplicated: MenuItem = {
    ...target,
    id: `item-${crypto.randomUUID()}`,
    name: `${target.name} (Copy)`,
    createdAt: new Date().toISOString(),
  };
  return saveMenuItem(orgId, duplicated, allowedLocationIds);
}

function readAllMenuItems(orgId: string): MenuItem[] {
  if (!orgId || typeof window === "undefined") return [];
  const saved = localStorage.getItem(getStoreKey(orgId, "items"));
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? (parsed as MenuItem[]).filter((i) => i.orgId === orgId) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Items with an empty `locationIds` are sold in every store; others only in the listed stores. */
export function listMenuItems(orgId: string, allowedLocationIds?: readonly string[]): MenuItem[] {
  return readAllMenuItems(orgId).filter((i) =>
    isScopeVisible(i.locationIds ?? [], allowedLocationIds),
  );
}

export function listMenuProducts(
  orgId: string,
  allowedLocationIds?: readonly string[],
): Array<MenuItem & { categoryName?: string }> {
  const items = listMenuItems(orgId, allowedLocationIds);
  const categories = listCategories(orgId);
  const catMap = new Map(categories.map((c) => [c.id, c.name]));
  return items.map((i) => ({
    ...i,
    categoryName: catMap.get(i.category) ?? i.category,
  }));
}

export function saveMenuItem(
  orgId: string,
  item: MenuItem,
  allowedLocationIds?: readonly string[],
): MenuItem[] {
  assertTenantContext(orgId);
  assertScopeWritable(item.locationIds ?? [], allowedLocationIds);
  const all = readAllMenuItems(orgId);
  const index = all.findIndex((i) => i.id === item.id);
  const current = all[index];
  if (current) assertScopeWritable(current.locationIds ?? [], allowedLocationIds);
  const own: MenuItem = { ...item, orgId };
  const next = index >= 0 ? all.map((cur, i) => (i === index ? own : cur)) : [own, ...all];
  if (typeof window !== "undefined") {
    localStorage.setItem(getStoreKey(orgId, "items"), JSON.stringify(next));
  }
  return next.filter((i) => isScopeVisible(i.locationIds ?? [], allowedLocationIds));
}

export function deleteMenuItem(
  orgId: string,
  itemId: string,
  allowedLocationIds?: readonly string[],
): MenuItem[] {
  assertTenantContext(orgId);
  const all = readAllMenuItems(orgId);
  const target = all.find((i) => i.id === itemId);
  if (target) assertScopeWritable(target.locationIds ?? [], allowedLocationIds);
  const updated = all.filter((i) => i.id !== itemId);
  if (typeof window !== "undefined") {
    localStorage.setItem(getStoreKey(orgId, "items"), JSON.stringify(updated));
  }
  return updated.filter((i) => isScopeVisible(i.locationIds ?? [], allowedLocationIds));
}
