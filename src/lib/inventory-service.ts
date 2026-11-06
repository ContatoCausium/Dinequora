import {
  assertLocationAllowed,
  assertTenantContext,
  isLocationAllowed,
  readTenantRecords,
  writeTenantRecords,
} from "./tenant-storage";

export type InventoryCategory =
  "meat" | "produce" | "dairy" | "bakery" | "dry_goods" | "beverages" | "packaging";
export type UnitOfMeasure = "oz" | "lb" | "gal" | "kg" | "units" | "pack";

export interface InventoryItem {
  id: string;
  orgId: string;
  locationId: string;
  name: string;
  category: InventoryCategory;
  sku: string;
  unit: UnitOfMeasure;
  quantity: number;
  minQuantity: number;
  costCents: number; // in USD cents
  supplier: string;
  expirationDate?: string | undefined;
  active: boolean;
  updatedAt: string;
}

export interface InventoryMetrics {
  totalValueCents: number;
  lowStockCount: number;
  outOfStockCount: number;
  expiringSoonCount: number;
  totalItems: number;
}

const SEED_INVENTORY: InventoryItem[] = [
  {
    id: "inv-1",
    orgId: "demo",
    locationId: "loc-1",
    name: "Ground Angus Beef (80/20)",
    category: "meat",
    sku: "BEEF-ANG-8020",
    unit: "lb",
    quantity: 45.5,
    minQuantity: 50.0,
    costCents: 425,
    supplier: "US Foods Wholesale",
    expirationDate: "2026-11-04",
    active: true,
    updatedAt: new Date().toISOString(),
  },
  {
    id: "inv-2",
    orgId: "demo",
    locationId: "loc-1",
    name: "Artisan Brioche Buns",
    category: "bakery",
    sku: "BUN-BRI-48",
    unit: "units",
    quantity: 180,
    minQuantity: 100,
    costCents: 65,
    supplier: "Gold Crust Bakery",
    expirationDate: "2026-10-30",
    active: true,
    updatedAt: new Date().toISOString(),
  },
  {
    id: "inv-3",
    orgId: "demo",
    locationId: "loc-1",
    name: "Sharp Aged Cheddar Slices",
    category: "dairy",
    sku: "CHED-AGED-SL",
    unit: "lb",
    quantity: 8.0,
    minQuantity: 15.0,
    costCents: 520,
    supplier: "Wisconsin Creamery Co.",
    expirationDate: "2026-11-20",
    active: true,
    updatedAt: new Date().toISOString(),
  },
  {
    id: "inv-4",
    orgId: "demo",
    locationId: "loc-1",
    name: "White Truffle Oil (Italian)",
    category: "dry_goods",
    sku: "OIL-TRUF-W500",
    unit: "oz",
    quantity: 32.0,
    minQuantity: 16.0,
    costCents: 180,
    supplier: "La Bella Imports",
    expirationDate: "2027-03-15",
    active: true,
    updatedAt: new Date().toISOString(),
  },
  {
    id: "inv-5",
    orgId: "demo",
    locationId: "loc-1",
    name: "Organic Russet Potatoes (50lb)",
    category: "produce",
    sku: "POT-RUS-50",
    unit: "lb",
    quantity: 0.0,
    minQuantity: 100.0,
    costCents: 75,
    supplier: "Valley Produce Dist.",
    expirationDate: "2026-11-15",
    active: true,
    updatedAt: new Date().toISOString(),
  },
  {
    id: "inv-6",
    orgId: "demo",
    locationId: "loc-1",
    name: "Compostable Burger Boxes",
    category: "packaging",
    sku: "BOX-BRG-ECO",
    unit: "units",
    quantity: 620,
    minQuantity: 200,
    costCents: 22,
    supplier: "EcoPack Solutions",
    active: true,
    updatedAt: new Date().toISOString(),
  },
];

function readStore(orgId: string): InventoryItem[] {
  return readTenantRecords<InventoryItem>("inventory", orgId, () =>
    orgId === "demo" ? SEED_INVENTORY : [],
  );
}

function writeStore(orgId: string, items: InventoryItem[]): void {
  writeTenantRecords("inventory", orgId, items);
}

/**
 * Lists items of one organization. Data is stored per organization; `allowedLocationIds`
 * (the caller's authorized stores) restricts results and rejects unauthorized explicit stores.
 */
export function listInventory(
  orgId: string,
  locationId?: string,
  allowedLocationIds?: readonly string[],
): InventoryItem[] {
  assertTenantContext(orgId);
  if (locationId && locationId !== "all" && !isLocationAllowed(locationId, allowedLocationIds))
    return [];
  return readStore(orgId).filter((item) => {
    const matchLoc = !locationId || locationId === "all" || item.locationId === locationId;
    return matchLoc && isLocationAllowed(item.locationId, allowedLocationIds);
  });
}

export function saveInventoryItem(
  orgId: string,
  item: Omit<InventoryItem, "id" | "updatedAt"> & { id?: string | undefined },
  allowedLocationIds?: readonly string[],
): InventoryItem {
  assertTenantContext(orgId);
  assertLocationAllowed(item.locationId, allowedLocationIds);
  const all = readStore(orgId);
  const now = new Date().toISOString();
  let saved: InventoryItem;

  if (item.id) {
    const idx = all.findIndex((i) => i.id === item.id);
    const existing = idx >= 0 ? all[idx] : undefined;
    if (existing) assertLocationAllowed(existing.locationId, allowedLocationIds);
    saved = { ...item, id: item.id, orgId, updatedAt: now };
    if (idx >= 0) {
      all[idx] = saved;
    } else {
      all.push(saved);
    }
  } else {
    saved = { ...item, id: `inv-${crypto.randomUUID()}`, orgId, updatedAt: now };
    all.push(saved);
  }

  writeStore(orgId, all);
  return saved;
}

export function toggleInventoryItemActive(
  itemId: string,
  active: boolean,
  orgId: string,
  allowedLocationIds?: readonly string[],
): void {
  assertTenantContext(orgId);
  const all = readStore(orgId);
  const item = all.find((i) => i.id === itemId);
  if (item) {
    assertLocationAllowed(item.locationId, allowedLocationIds);
    item.active = active;
    item.updatedAt = new Date().toISOString();
    writeStore(orgId, all);
  }
}

export function deleteInventoryItem(
  itemId: string,
  orgId: string,
  allowedLocationIds?: readonly string[],
): void {
  assertTenantContext(orgId);
  const all = readStore(orgId);
  const target = all.find((i) => i.id === itemId);
  if (!target) return;
  assertLocationAllowed(target.locationId, allowedLocationIds);
  writeStore(
    orgId,
    all.filter((i) => i.id !== itemId),
  );
}

export function isExpiringSoon(expirationDate?: string, daysWindow = 7): boolean {
  if (!expirationDate) return false;
  const exp = new Date(expirationDate).getTime();
  const now = Date.now();
  const diffDays = (exp - now) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= daysWindow;
}

export function computeInventoryMetrics(items: InventoryItem[]): InventoryMetrics {
  let totalValueCents = 0;
  let lowStockCount = 0;
  let outOfStockCount = 0;
  let expiringSoonCount = 0;

  for (const item of items) {
    if (!item.active) continue;
    totalValueCents += Math.round(item.quantity * item.costCents);
    if (item.quantity <= 0) {
      outOfStockCount++;
    } else if (item.quantity <= item.minQuantity) {
      lowStockCount++;
    }
    if (isExpiringSoon(item.expirationDate)) {
      expiringSoonCount++;
    }
  }

  return {
    totalValueCents,
    lowStockCount,
    outOfStockCount,
    expiringSoonCount,
    totalItems: items.length,
  };
}
