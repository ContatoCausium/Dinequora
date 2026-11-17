import { averageCents } from "./money";
import { displayAmount } from "./format";
import type { LedgerSummary } from "./ledger-reader";
import { periodWindow, type DayWindow, type PeriodSpec } from "./financial-period";
import { dailyRevenue, figuresByStore, periodFigures, previousFigures } from "./financial-summary";
import { localDay, shiftDay, startOfLocalDay } from "./store-time";

// Shared period helpers live in period-metrics; re-exported here for existing imports.
export { dayKey, expensesInPeriod } from "./period-metrics";
import { netSalesCents, type RecordedOrder } from "./recorded-data";

/**
 * An order counts as a sale when it has a (non-reversed) payment and was not cancelled or simulated.
 * This mirrors the ledger exactly: revenue is written only when the POS finalizes payment. Unpaid
 * tickets sent to the kitchen (open tabs) are not sales, whatever their kitchen status.
 */
export const isRecordedSale = (o: Pick<RecordedOrder, "status" | "isSimulated" | "paid">) =>
  o.paid && o.status !== "cancelled" && !o.isSimulated;

/** A store of the report scope: UI slug, database id and IANA zone. */
export interface ReportStore {
  slug: string;
  dbId: string | undefined;
  timeZone: string;
}

/**
 * The earliest instant any store's period starts (local midnight of its first day), to read the
 * orders that the period's product and channel breakdowns need.
 */
export function ordersReadSince(
  stores: readonly Pick<ReportStore, "timeZone">[],
  spec: PeriodSpec,
  now = new Date(),
): string {
  const starts = stores.map((st) => {
    const w = periodWindow(spec, localDay(now, st.timeZone));
    return startOfLocalDay(w.sinceDay ?? "1970-01-01", st.timeZone).getTime();
  });
  return new Date(starts.length ? Math.min(...starts) : now.getTime()).toISOString();
}

export type ReportFigures = ReturnType<typeof buildReport>;

/**
 * The period report of the Overview and Reports (wave 0). Revenue, COGS, the number of sales, the
 * average ticket, the daily series and the per-store split come from the COMPLETE ledger summary,
 * per store in its own local days — so the KPI, the chart and the store table always add up to
 * the same figure, and match Finance and Insights for the same period. The channel and product
 * breakdowns need order details: they use the paid orders of the same store-local days.
 */
export function buildReport(input: {
  orders: readonly RecordedOrder[];
  /** Ledger summary already scoped to the report's stores. */
  summary: LedgerSummary;
  spec: PeriodSpec;
  stores: readonly ReportStore[];
}) {
  const { summary, spec } = input;
  const ledger = periodFigures(summary, spec);
  const todayOf = new Map(summary.stores.map((st) => [st.locationId, st.today]));
  const windowOf = new Map<string, DayWindow>();
  const zoneOf = new Map<string, string>();
  for (const st of input.stores) {
    const today = st.dbId ? todayOf.get(st.dbId) : undefined;
    if (!today) continue;
    windowOf.set(st.slug, periodWindow(spec, today));
    zoneOf.set(st.slug, st.timeZone);
  }
  const sales = input.orders.filter((o) => {
    if (!isRecordedSale(o)) return false;
    const w = windowOf.get(o.locationId);
    const zone = zoneOf.get(o.locationId);
    if (!w || !zone) return false;
    const day = localDay(o.createdAt, zone);
    return (w.sinceDay === null || day >= w.sinceDay) && day <= w.untilDay;
  });
  const byChannel = new Map<string, { cents: number; orders: number }>();
  const products = new Map<string, { name: string; qty: number; cents: number }>();
  for (const o of sales) {
    const net = netSalesCents(o);
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
  const slugOf = new Map(input.stores.map((st) => [st.dbId, st.slug]));
  const byStore = [...figuresByStore(summary, spec)].map(([dbId, f]) => ({
    locationId: slugOf.get(dbId) ?? dbId,
    cents: f.revenueCents,
    orders: f.sales,
  }));
  const daily = dailyRevenue(summary, spec);
  const sortDesc = <T extends { cents: number }>(a: T, b: T) => b.cents - a.cents;
  return {
    revenueCents: ledger.revenueCents,
    cogsCents: ledger.cogsCents,
    orderCount: ledger.sales,
    avgTicketCents: displayAmount(
      () => averageCents(ledger.revenueCents, ledger.sales),
      "money.report_average",
    ),
    daily,
    daysWithSales: daily.filter((d) => d.cents > 0).length,
    byStore: byStore.filter((s) => s.cents !== 0 || s.orders !== 0).sort(sortDesc),
    byChannel: [...byChannel].map(([channel, v]) => ({ channel, ...v })).sort(sortDesc),
    products: [...products.values()].sort(sortDesc),
    /** False when the ledger read was incomplete: the figures are partial. */
    complete: summary.complete,
  };
}

/**
 * The comparison period from the SAME summary (no second read): "today" → yesterday up to the
 * same local time; "N days" → the N days before. Null when the period has no comparison.
 */
export function buildPreviousReport(summary: LedgerSummary, spec: PeriodSpec) {
  const f = previousFigures(summary, spec);
  if (!f) return null;
  const daily =
    spec.kind === "today"
      ? [
          {
            day: shiftDay(summary.stores.map((s) => s.today).sort()[0] ?? "", -1),
            cents: f.revenueCents,
          },
        ]
      : dailyRevenue(summary, spec, "previous");
  return {
    revenueCents: f.revenueCents,
    cogsCents: f.cogsCents,
    orderCount: f.sales,
    daily,
    daysWithSales: daily.filter((d) => d.cents > 0).length,
  };
}
