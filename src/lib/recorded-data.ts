import { fetchOperationalOrders } from "./operational.functions";

export type RecordedOrder = Awaited<ReturnType<typeof fetchOperationalOrders>>["orders"][number];
export type OrderStatus = RecordedOrder["status"];

export const ORDER_PAGE_SIZE = 200; // server-side maximum per request
export const ORDER_HISTORY_CAP = 5000; // protects the browser; the UI says when the cap is hit
const PAGE = ORDER_PAGE_SIZE;
const HARD_CAP = ORDER_HISTORY_CAP;

/**
 * Every recorded order visible to the user (RLS + store scope apply server-side), newest first,
 * each order exactly once.
 *
 * Pages are read by offset over a total order (created_at, id — see orders-query.ts). An order
 * created while the pages are being read shifts later pages by one row; the repeated row is
 * dropped here (by id), and the new order is simply picked up on the next load.
 *
 * `since` is an ISO timestamp lower bound. `truncated` is true only when the browser cap stopped
 * the read with older orders left unread. `fetchPage` defaults to the server function; tests pass
 * their own page source.
 */
export async function fetchAllOrders(
  orgId: string,
  locationId: string,
  since?: string,
  fetchPage: (req: {
    data: { orgId: string; locationId: string; limit: number; offset: number; startDate?: string };
  }) => Promise<{ orders: RecordedOrder[]; totalCount: number }> = fetchOperationalOrders,
): Promise<{ orders: RecordedOrder[]; total: number; truncated: boolean }> {
  const byId = new Map<string, RecordedOrder>();
  let total = 0;
  let stoppedAtCap = false;
  for (let offset = 0; ; offset += PAGE) {
    if (offset >= HARD_CAP) {
      stoppedAtCap = true;
      break;
    }
    const page = await fetchPage({
      data: {
        orgId,
        locationId,
        limit: PAGE,
        offset,
        ...(since ? { startDate: since } : {}),
      },
    });
    total = page.totalCount;
    for (const order of page.orders) if (!byId.has(order.id)) byId.set(order.id, order);
    if (page.orders.length < PAGE || byId.size >= total) break;
  }
  const orders = [...byId.values()];
  return { orders, total, truncated: stoppedAtCap && orders.length < total };
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
