import { netSalesCents, type RecordedOrder } from "./recorded-data";
import { isRecordedSale } from "./report-metrics";

export type StoreSalesMetrics = {
  /** Net sales (total minus tax) of paid, non-cancelled, non-simulated orders in the window. */
  salesCents: number;
  orders: number;
  /** Change vs. the previous window of the same length; null when there is nothing to compare. */
  growth: number | null;
};

const DAY_MS = 86_400_000;

/**
 * Recorded per-store sales for the Locations page. Uses the same "is a sale" rule as Reports and
 * the dashboard (mirrors the ledger), so a real organization never sees synthetic figures here.
 */
export function storeSalesMetrics(
  orders: readonly Pick<
    RecordedOrder,
    "locationId" | "createdAt" | "status" | "isSimulated" | "paid" | "totalCents" | "taxCents"
  >[],
  locationSlug: string,
  now: Date = new Date(),
  days = 30,
): StoreSalesMetrics {
  const end = now.getTime();
  const start = end - days * DAY_MS;
  const prevStart = start - days * DAY_MS;
  let salesCents = 0;
  let count = 0;
  let prevCents = 0;
  for (const o of orders) {
    if (o.locationId !== locationSlug || !isRecordedSale(o)) continue;
    const t = Date.parse(o.createdAt);
    if (t > end) continue;
    if (t >= start) {
      salesCents += netSalesCents(o);
      count += 1;
    } else if (t >= prevStart) prevCents += netSalesCents(o);
  }
  return {
    salesCents,
    orders: count,
    growth: prevCents > 0 ? (salesCents - prevCents) / prevCents : null,
  };
}

/** ISO lower bound that covers the current and the comparison window. */
export const storeMetricsSince = (now: Date = new Date(), days = 30) =>
  new Date(now.getTime() - 2 * days * DAY_MS).toISOString();
