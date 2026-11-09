/**
 * Tenant-scoped browser storage for modules that still persist locally
 * (Inventory, Inventory movements, Recipes) until their backend tables exist.
 *
 * Rules:
 * - Every key is namespaced by organization id; there is no shared/global key.
 * - Reads and writes require a valid organization context, otherwise they throw.
 * - Records whose `orgId` does not match the namespace are dropped on read and write.
 * - Legacy global keys (v1) are never read as tenant data, never assigned to an
 *   organization and never deleted. They are only reported (count only) and
 *   flagged with a quarantine marker.
 */

export class TenantContextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantContextError";
  }
}

export type TenantStoreName =
  "inventory" | "inventory_movements" | "product_recipes" | "finance_expenses";

/** Legacy global keys used before tenant namespacing. Kept read-only. */
export const LEGACY_GLOBAL_KEYS: Readonly<Record<TenantStoreName, string>> = {
  inventory: "servora_inventory_v1",
  inventory_movements: "servora_inventory_movements_v1",
  product_recipes: "servora_product_recipes_v1",
  finance_expenses: "servora.finance.expenses.v1",
};

const ORG_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const QUARANTINE_PREFIX = "servora.quarantine.";

export function assertTenantContext(orgId: string | null | undefined): string {
  if (typeof orgId !== "string" || orgId.trim() === "") {
    throw new TenantContextError("missing_org_context");
  }
  if (!ORG_ID_PATTERN.test(orgId)) {
    throw new TenantContextError("invalid_org_context");
  }
  return orgId;
}

/**
 * Throws when a specific store is requested that the caller is not authorized for.
 * `allowedLocationIds` undefined means the caller did not supply a scope (org-wide callers).
 */
export function assertLocationAllowed(
  locationId: string | null | undefined,
  allowedLocationIds: readonly string[] | undefined,
): void {
  if (!allowedLocationIds || !locationId || locationId === "all") return;
  if (!allowedLocationIds.includes(locationId)) {
    throw new TenantContextError("location_forbidden");
  }
}

export function isLocationAllowed(
  locationId: string | null | undefined,
  allowedLocationIds: readonly string[] | undefined,
): boolean {
  if (!allowedLocationIds) return true;
  if (!locationId) return true;
  return allowedLocationIds.includes(locationId);
}

export function tenantStorageKey(store: TenantStoreName, orgId: string): string {
  return `servora.${store}.v2.org.${assertTenantContext(orgId)}`;
}

function hasStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function readTenantRecords<T extends { orgId: string }>(
  store: TenantStoreName,
  orgId: string,
  seed: () => T[] = () => [],
): T[] {
  const key = tenantStorageKey(store, orgId);
  const seeded = (): T[] => seed().filter((r) => r.orgId === orgId);
  if (!hasStorage()) return seeded();
  quarantineLegacyStore(store);
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) {
      const initial = seeded();
      if (initial.length > 0) window.localStorage.setItem(key, JSON.stringify(initial));
      return initial;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as T[]).filter((r) => typeof r === "object" && r !== null && r.orgId === orgId);
  } catch {
    return [];
  }
}

export function writeTenantRecords<T extends { orgId: string }>(
  store: TenantStoreName,
  orgId: string,
  records: T[],
): void {
  const key = tenantStorageKey(store, orgId);
  if (!hasStorage()) return;
  const own = records.filter((r) => r.orgId === orgId);
  try {
    window.localStorage.setItem(key, JSON.stringify(own));
  } catch {
    /* storage full or blocked: keep previous state */
  }
}

export interface LegacyStoreReport {
  store: TenantStoreName;
  key: string;
  present: boolean;
  recordCount: number;
  quarantinedAt: string | null;
}

/** Reports a legacy global key without exposing any of its records. */
export function inspectLegacyStore(store: TenantStoreName): LegacyStoreReport {
  const key = LEGACY_GLOBAL_KEYS[store];
  const empty: LegacyStoreReport = {
    store,
    key,
    present: false,
    recordCount: 0,
    quarantinedAt: null,
  };
  if (!hasStorage()) return empty;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return empty;
  let recordCount = 0;
  try {
    const parsed: unknown = JSON.parse(raw);
    recordCount = Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    recordCount = 0;
  }
  let quarantinedAt: string | null = null;
  try {
    const marker: unknown = JSON.parse(
      window.localStorage.getItem(QUARANTINE_PREFIX + key) ?? "null",
    );
    if (marker && typeof marker === "object" && "detectedAt" in marker) {
      const v = (marker as { detectedAt: unknown }).detectedAt;
      quarantinedAt = typeof v === "string" ? v : null;
    }
  } catch {
    quarantinedAt = null;
  }
  return { store, key, present: true, recordCount, quarantinedAt };
}

/** Flags a legacy key as quarantined. Never copies, reassigns or deletes its content. */
export function quarantineLegacyStore(store: TenantStoreName): LegacyStoreReport {
  const report = inspectLegacyStore(store);
  if (!report.present || report.quarantinedAt !== null || !hasStorage()) return report;
  const detectedAt = new Date().toISOString();
  try {
    window.localStorage.setItem(
      QUARANTINE_PREFIX + report.key,
      JSON.stringify({ detectedAt, recordCount: report.recordCount }),
    );
  } catch {
    return report;
  }
  return { ...report, quarantinedAt: detectedAt };
}

export function listLegacyStoreReports(): LegacyStoreReport[] {
  return (Object.keys(LEGACY_GLOBAL_KEYS) as TenantStoreName[]).map(inspectLegacyStore);
}

/**
 * Visibility of a record scoped to a list of stores (empty list = whole organization).
 * Org-wide callers (allowed undefined) see everything; store-restricted callers see org-wide
 * records and records that include at least one authorized store.
 */
export function isScopeVisible(
  scope: readonly string[],
  allowedLocationIds: readonly string[] | undefined,
): boolean {
  if (!allowedLocationIds) return true;
  if (scope.length === 0) return true;
  return scope.some((id) => allowedLocationIds.includes(id));
}

/**
 * Store-restricted callers may only write records whose stores are all authorized;
 * org-wide records (empty scope) require an org-wide caller.
 */
export function assertScopeWritable(
  scope: readonly string[],
  allowedLocationIds: readonly string[] | undefined,
): void {
  if (!allowedLocationIds) return;
  if (scope.length === 0 || !scope.every((id) => allowedLocationIds.includes(id))) {
    throw new TenantContextError("location_forbidden");
  }
}
