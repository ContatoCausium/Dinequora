import { fetchOperationalOrders } from "./operational.functions";

export type RecordedOrder = Awaited<ReturnType<typeof fetchOperationalOrders>>["orders"][number];
export type OrderStatus = RecordedOrder["status"];

export const ORDER_PAGE_SIZE = 200; // server-side maximum per request
export const ORDER_HISTORY_CAP = 5000; // protects the browser; the UI says when the cap is hit
const PAGE = ORDER_PAGE_SIZE;
const HARD_CAP = ORDER_HISTORY_CAP;

/** One page request: what the fetchOperationalOrders server function accepts. */
export interface OrderPageRequest {
  data: {
    orgId: string;
    locationId: string;
    limit: number;
    offset: number;
    startDate?: string;
    status?: OrderStatus;
    statuses?: OrderStatus[];
    oldestFirst?: boolean;
  };
}
export type OrderPageSource = (
  req: OrderPageRequest,
) => Promise<{ orders: RecordedOrder[]; totalCount: number }>;

type OrderFilter = Omit<OrderPageRequest["data"], "limit" | "offset">;

/**
 * Reads every page of one filtered order list, newest first, each order exactly once.
 *
 * Pages are read by offset over a total order (created_at, id — see orders-query.ts). An order
 * created while the pages are being read shifts later pages by one row; the repeated row is
 * dropped here (by id), and the new order is simply picked up on the next load. `truncated` is
 * true only when the browser cap stopped the read with older orders left unread.
 */
/** Optional hooks of a long read: stop when aborted, report each page that arrives. */
export interface PagedReadOptions {
  signal?: AbortSignal | undefined;
  onPage?: (() => void) | undefined;
}

async function readAllPages(
  filter: OrderFilter,
  fetchPage: OrderPageSource,
  opts: PagedReadOptions = {},
): Promise<{ orders: RecordedOrder[]; total: number; truncated: boolean }> {
  const byId = new Map<string, RecordedOrder>();
  let total = 0;
  let stoppedAtCap = false;
  for (let offset = 0; ; offset += PAGE) {
    if (offset >= HARD_CAP) {
      stoppedAtCap = true;
      break;
    }
    if (opts.signal?.aborted) throw new DOMException("read abandoned", "AbortError");
    const page = await fetchPage({ data: { ...filter, limit: PAGE, offset } });
    opts.onPage?.();
    total = page.totalCount;
    for (const order of page.orders) if (!byId.has(order.id)) byId.set(order.id, order);
    if (page.orders.length < PAGE || byId.size >= total) break;
  }
  const orders = [...byId.values()];
  return { orders, total, truncated: stoppedAtCap && orders.length < total };
}

/**
 * Every recorded order visible to the user (RLS + store scope apply server-side), newest first,
 * each order exactly once. `since` is an ISO timestamp lower bound. `fetchPage` defaults to the
 * server function; tests pass their own page source.
 */
export async function fetchAllOrders(
  orgId: string,
  locationId: string,
  since?: string,
  fetchPage: OrderPageSource = fetchOperationalOrders,
): Promise<{ orders: RecordedOrder[]; total: number; truncated: boolean }> {
  return readAllPages({ orgId, locationId, ...(since ? { startDate: since } : {}) }, fetchPage);
}

/** Most recent delivered tickets shown in the last column (unchanged from the previous board). */
export const KITCHEN_RECENT_DELIVERED = 10;

/** Newest first, ties by id — the order every list (and the board) is shown in. */
const newestFirst = (x: RecordedOrder, y: RecordedOrder) =>
  x.createdAt === y.createdAt ? (x.id < y.id ? 1 : -1) : x.createdAt < y.createdAt ? 1 : -1;

export interface KitchenBoard {
  /** Open tickets loaded + the latest delivered ones, each once, newest first (as before). */
  orders: RecordedOrder[];
  /** Open tickets in the database (all stations). */
  openTotal: number;
  /** Open tickets on the board (all stations). */
  openLoaded: number;
  /** true when the browser cap left the NEWEST open tickets off the board. */
  truncated: boolean;
}

/**
 * The kitchen board: EVERY open ticket (all pages, however many newer orders exist) plus the most
 * recent delivered ones, each order exactly once. The previous board read the 100 most recent
 * orders of any status and filtered them in the browser, so an open ticket disappeared as soon as
 * 100 newer orders existed.
 *
 * Open tickets are read OLDEST first: if the 5,000 browser cap is ever reached, the tickets left
 * off are the newest ones, never the ones that have been waiting longest; the board says so.
 */
export async function fetchKitchenBoard(
  orgId: string,
  locationId: string,
  fetchPage: OrderPageSource = fetchOperationalOrders,
  opts: PagedReadOptions = {},
): Promise<KitchenBoard> {
  // Open = still the kitchen's work (OPEN_STATUSES below).
  const open = await readAllPages(
    { orgId, locationId, statuses: [...OPEN_STATUSES], oldestFirst: true },
    fetchPage,
    opts,
  );
  if (opts.signal?.aborted) throw new DOMException("read abandoned", "AbortError");
  const delivered = await fetchPage({
    data: { orgId, locationId, status: "delivered", limit: KITCHEN_RECENT_DELIVERED, offset: 0 },
  });
  opts.onPage?.();
  const byId = new Map(open.orders.map((o) => [o.id, o]));
  for (const order of delivered.orders) if (!byId.has(order.id)) byId.set(order.id, order);
  return {
    orders: [...byId.values()].sort(newestFirst),
    openTotal: open.total,
    openLoaded: open.orders.length,
    truncated: open.truncated,
  };
}

/** Paid orders count toward sales; open tickets and cancellations don't. */
export const OPEN_STATUSES: readonly OrderStatus[] = ["new", "confirmed", "in_prep", "ready"];

/** Next forward step a cashier/kitchen can take (mirrors update_order_status transitions). */
export function nextStatus(s: OrderStatus): OrderStatus | null {
  switch (s) {
    case "new":
      return "confirmed";
    case "confirmed":
      return "in_prep";
    case "in_prep":
      return "ready";
    case "ready":
      return "delivered";
    default:
      return null;
  }
}

export function periodStart(period: "today" | "7d" | "30d" | "90d", now = new Date()): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  if (period !== "today") d.setDate(d.getDate() - (Number(period.replace("d", "")) - 1));
  return d.toISOString();
}

/** Net sales of an order = what the ledger records as revenue (total minus tax). */
export const netSalesCents = (o: Pick<RecordedOrder, "totalCents" | "taxCents">) =>
  o.totalCents - o.taxCents;
