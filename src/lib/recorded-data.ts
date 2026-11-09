import { fetchOperationalOrders } from "./operational.functions";

export type RecordedOrder = Awaited<ReturnType<typeof fetchOperationalOrders>>["orders"][number];
export type OrderStatus = RecordedOrder["status"];

const PAGE = 200; // server-side maximum per request
const HARD_CAP = 5000; // protects the browser; the UI says when the cap is hit

/**
 * Every recorded order visible to the user (RLS + store scope apply server-side), newest first.
 * `since` is an ISO timestamp lower bound. Returns `truncated` when more rows exist than the cap.
 */
export async function fetchAllOrders(
  orgId: string,
  locationId: string,
  since?: string,
): Promise<{ orders: RecordedOrder[]; total: number; truncated: boolean }> {
  const orders: RecordedOrder[] = [];
  let total = 0;
  for (let offset = 0; offset < HARD_CAP; offset += PAGE) {
    const page = await fetchOperationalOrders({
      data: {
        orgId,
        locationId,
        limit: PAGE,
        offset,
        ...(since ? { startDate: since } : {}),
      },
    });
    total = page.totalCount;
    orders.push(...page.orders);
    if (page.orders.length < PAGE || orders.length >= total) break;
  }
  return { orders, total, truncated: orders.length < total };
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
