import { ledgerMetrics } from "./operational-metrics";
import { dayKey } from "./period-metrics";

// Shared period helpers live in period-metrics; re-exported here for existing imports.
export { dayKey, expensesInPeriod } from "./period-metrics";
import { netSalesCents, type RecordedOrder } from "./recorded-data";
import { averageCents } from "./money";
import { displayAmount } from "./format";

type LedgerEntry = Parameters<typeof ledgerMetrics>[0][number];

/**
 * An order counts as a sale when it has a (non-reversed) payment and was not cancelled or simulated.
 * This mirrors the ledger exactly: revenue is written only when the POS finalizes payment. Unpaid
 * tickets sent to the kitchen (open tabs) are not sales, whatever their kitchen status.
 */
export const isRecordedSale = (o: Pick<RecordedOrder, "status" | "isSimulated" | "paid">) =>
  o.paid && o.status !== "cancelled" && !o.isSimulated;

export function buildReport(input: {
  orders: readonly RecordedOrder[];
  ledger: readonly LedgerEntry[];
  since: string;
  days: number;
  timeZone?: string | undefined;
  now?: Date;
}) {
  const sinceMs = Date.parse(input.since);
  const sales = input.orders.filter((o) => isRecordedSale(o) && Date.parse(o.createdAt) >= sinceMs);
  const ledger = ledgerMetrics(
    input.ledger.filter((e) => Date.parse(e.created_at) >= sinceMs) as LedgerEntry[],
  );

  const daily = new Map<string, number>();
  const now = input.now ?? new Date();
  for (let i = input.days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    daily.set(dayKey(d.toISOString(), input.timeZone), 0);
  }
  const byStore = new Map<string, { cents: number; orders: number }>();
  const byChannel = new Map<string, { cents: number; orders: number }>();
  const products = new Map<string, { name: string; qty: number; cents: number }>();
  let orderNet = 0;
  for (const o of sales) {
    const net = netSalesCents(o);
    orderNet += net;
    const k = dayKey(o.createdAt, input.timeZone);
    if (daily.has(k)) daily.set(k, daily.get(k)! + net);
    const s = byStore.get(o.locationId) ?? { cents: 0, orders: 0 };
    byStore.set(o.locationId, { cents: s.cents + net, orders: s.orders + 1 });
    const c = byChannel.get(o.type) ?? { cents: 0, orders: 0 };
    byChannel.set(o.type, { cents: c.cents + net, orders: c.orders + 1 });
    for (const it of o.items) {
      const p = products.get(it.productName) ?? { name: it.productName, qty: 0, cents: 0 };
      products.set(it.productName, {
        name: p.name,
        qty: p.qty + it.quantity,
        cents: p.cents + it.subtotalCents,
      });
    }
  }
  const sortDesc = <T extends { cents: number }>(a: T, b: T) => b.cents - a.cents;
  return {
    revenueCents: ledger.revenueCents,
    cogsCents: ledger.cogsCents,
    orderCount: sales.length,
    avgTicketCents: displayAmount(
      () => averageCents(orderNet, sales.length),
      "money.report_average",
    ),
    daily: [...daily].map(([day, cents]) => ({ day, cents })),
    daysWithSales: [...daily.values()].filter((v) => v > 0).length,
    byStore: [...byStore].map(([locationId, v]) => ({ locationId, ...v })).sort(sortDesc),
    byChannel: [...byChannel].map(([channel, v]) => ({ channel, ...v })).sort(sortDesc),
    products: [...products.values()].sort(sortDesc),
  };
}
