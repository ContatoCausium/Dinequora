import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import type { Permission } from "./permissions";
import { DEFAULT_THRESHOLDS } from "./kds-thresholds";

/**
 * Sidebar counters (redesign stage B): open orders, late kitchen tickets and low-stock items.
 *
 * - Real data only: recorded, non-training orders (is_simulation = false) and active inventory
 *   items. Presentation-mode figures never reach these counts.
 * - Same rules as the screens they point to: open = OPEN_STATUSES (recorded-data), late = the
 *   KDS "late" threshold (getTicketUrgency ≥ warningMinutes), low = quantity ≤ minimum (Overview
 *   attention strip; covers the inventory screen's "low" and "out").
 * - Authorization twice: RLS limits rows to the member's organization and stores, and each
 *   counter is computed only when has_any_permission() grants the module (same permissions as the
 *   route guard). A counter the member may not see, or that could not be read, is null — never 0.
 */
export interface NavCounts {
  openOrders: number | null;
  lateTickets: number | null;
  lowStock: number | null;
}

export type NavCountKey = keyof NavCounts;

/** Which permission each counter requires (mirrors ROUTE_PERMISSIONS for /orders, /kds, stock). */
export const NAV_COUNT_PERMISSIONS: Record<NavCountKey, readonly Permission[]> = {
  openOrders: ["orders.view"],
  lateTickets: ["kds.view"],
  lowStock: ["inventory.view"],
};

/** Refresh cadence of the sidebar counters (approved: 30 s). */
export const NAV_COUNTS_REFRESH_MS = 30_000;

/** Kept equal to OPEN_STATUSES in recorded-data (a test asserts it; importing it here would cycle). */
export const NAV_OPEN_STATUSES = ["new", "confirmed", "in_prep", "ready"] as const;

/**
 * Every read gives up after this long: a stalled connection then yields null (counter hidden)
 * instead of holding the whole response, and the next 30 s refresh simply tries again.
 */
export const NAV_COUNTS_READ_TIMEOUT_MS = 8_000;

/** Safety cap for the low-stock scan (pages of 1,000 rows; PostgREST's default row limit). */
const STOCK_PAGE = 1000;
const STOCK_MAX_ROWS = 50_000;

export const EMPTY_NAV_COUNTS: NavCounts = { openOrders: null, lateTickets: null, lowStock: null };

/**
 * Reads the three counters with the caller's (RLS-bound) client. `orgId` and `locationId` are
 * database ids already resolved by the server function's scope(); `locationId` undefined = every
 * store the member can access.
 */
export async function readNavCounts(
  client: SupabaseClient<Database>,
  input: { orgId: string; locationId?: string | undefined; timeoutMs?: number | undefined },
  now: Date = new Date(),
): Promise<NavCounts> {
  const { orgId, locationId } = input;
  const signal = AbortSignal.timeout(input.timeoutMs ?? NAV_COUNTS_READ_TIMEOUT_MS);
  const allowed = async (perms: readonly Permission[]) => {
    try {
      const { data, error } = await client
        .rpc("has_any_permission", {
          _org_id: orgId,
          _perms: [...perms],
          ...(locationId ? { _location_id: locationId } : {}),
        })
        .abortSignal(signal);
      return !error && data === true;
    } catch {
      return false;
    }
  };
  const [canOrders, canKitchen, canStock] = await Promise.all([
    allowed(NAV_COUNT_PERMISSIONS.openOrders),
    allowed(NAV_COUNT_PERMISSIONS.lateTickets),
    allowed(NAV_COUNT_PERMISSIONS.lowStock),
  ]);

  // Head-only exact counts on the (org_id, location_id, status) index: no rows travel.
  const openOrders = () => {
    let q = client
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("org_id", orgId)
      .in("status", [...NAV_OPEN_STATUSES])
      .eq("is_simulation", false)
      .abortSignal(signal);
    if (locationId) q = q.eq("location_id", locationId);
    return q;
  };
  const count = async (query: PromiseLike<{ count: number | null; error: unknown }>) => {
    try {
      const { count: n, error } = await query;
      return error || n == null ? null : n;
    } catch {
      return null;
    }
  };
  const lateSince = new Date(
    now.getTime() - DEFAULT_THRESHOLDS.warningMinutes * 60_000,
  ).toISOString();

  const [open, late, low] = await Promise.all([
    canOrders ? count(openOrders()) : null,
    canKitchen ? count(openOrders().lte("created_at", lateSince)) : null,
    canStock ? countLowStock(client, orgId, locationId, signal) : null,
  ]);
  return { openOrders: open, lateTickets: late, lowStock: low };
}

/**
 * Active items at or below their minimum. PostgREST cannot compare two columns in a filter, so
 * only the two numbers are read, page by page (never silently truncated at the 1,000-row default);
 * past the safety cap the answer is unknown (null), not a partial count.
 */
async function countLowStock(
  client: SupabaseClient<Database>,
  orgId: string,
  locationId: string | undefined,
  signal: AbortSignal,
): Promise<number | null> {
  let low = 0;
  for (let from = 0; from < STOCK_MAX_ROWS; from += STOCK_PAGE) {
    let q = client
      .from("inventory_items")
      .select("quantity,min_quantity")
      .eq("org_id", orgId)
      .eq("active", true)
      .abortSignal(signal);
    if (locationId) q = q.eq("location_id", locationId);
    let page;
    try {
      page = await q.order("id").range(from, from + STOCK_PAGE - 1);
    } catch {
      return null;
    }
    const { data, error } = page;
    if (error) return null;
    const rows = data ?? [];
    for (const r of rows) if (Number(r.quantity) <= Number(r.min_quantity)) low++;
    if (rows.length < STOCK_PAGE) return low;
  }
  return null;
}
