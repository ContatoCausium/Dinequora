/**
 * The data the management assistant answers from (migration 0040). Pure: the server reads the rows
 * through RLS as the asking member and this module compresses them into a small JSON the model reads.
 * A part the member cannot read arrives as null and stays null ("not available"), never as zero.
 */
import { analyzeMenu, type MenuSalesRow, type RecipeCost } from "./menu-engineering";
import { purchaseForecast, type ConsumptionRow } from "./purchase-forecast";

type LedgerRaw = {
  stores?: { id: string; today: string }[];
  /** [store id, local day, kind, cents, rows] — see ledger_day_totals (0031). */
  buckets?: [string, string, string, number, number][];
};

export interface AssistantSnapshotRows {
  organization: string;
  stores: readonly { id: string; name: string; timezone: string | null }[];
  ledger: unknown | null;
  inventory:
    | readonly {
        id?: string;
        name: string;
        unit: string;
        quantity: number;
        min_quantity: number;
        location_id: string;
        supplier?: string | null;
      }[]
    | null;
  /** inventory_consumption (0044) for the last 30 local days; null when not readable. */
  consumption?: readonly ConsumptionRow[] | null;
  /** menu_item_sales (0042) for the last 30 local days: aggregated, never truncated. */
  itemSales: readonly MenuSalesRow[] | null;
  /** Current recipe cost per product and store; null when the member cannot see costs. */
  recipeCosts: readonly RecipeCost[] | null;
  openOrders: number | null;
  now: string;
}

const SIGN: Record<
  string,
  { field: "salesNetCents" | "cogsCents" | "expensesCents"; sign: 1 | -1 }
> = {
  revenue: { field: "salesNetCents", sign: 1 },
  reversal_revenue: { field: "salesNetCents", sign: -1 },
  cogs: { field: "cogsCents", sign: 1 },
  reversal_cogs: { field: "cogsCents", sign: -1 },
  expense: { field: "expensesCents", sign: 1 },
};
type Day = { day: string; salesNetCents: number; cogsCents: number; expensesCents: number };

export function buildAssistantSnapshot(rows: AssistantSnapshotRows) {
  const storeName = new Map(rows.stores.map((s) => [s.id, s.name]));

  // Ledger: per day (all chosen stores) and per store, last 30 local days.
  let ledger: null | {
    byDay: Day[];
    byStore: { store: string; salesNetCents: number; cogsCents: number; expensesCents: number }[];
    last7: Omit<Day, "day">;
    last30: Omit<Day, "day">;
  } = null;
  const raw = rows.ledger as LedgerRaw | null;
  if (raw && Array.isArray(raw.buckets)) {
    const days = new Map<string, Day>();
    const stores = new Map<string, Omit<Day, "day">>();
    for (const [storeId, day, kind, cents] of raw.buckets) {
      const m = SIGN[kind];
      if (!m) continue;
      const d = days.get(day) ?? { day, salesNetCents: 0, cogsCents: 0, expensesCents: 0 };
      d[m.field] += m.sign * cents;
      days.set(day, d);
      const s = stores.get(storeId) ?? { salesNetCents: 0, cogsCents: 0, expensesCents: 0 };
      s[m.field] += m.sign * cents;
      stores.set(storeId, s);
    }
    const byDay = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
    const sum = (list: Day[]) =>
      list.reduce(
        (t, d) => ({
          salesNetCents: t.salesNetCents + d.salesNetCents,
          cogsCents: t.cogsCents + d.cogsCents,
          expensesCents: t.expensesCents + d.expensesCents,
        }),
        { salesNetCents: 0, cogsCents: 0, expensesCents: 0 },
      );
    ledger = {
      byDay,
      byStore: [...stores.entries()].map(([id, v]) => ({ store: storeName.get(id) ?? id, ...v })),
      last7: sum(byDay.slice(-7)),
      last30: sum(byDay),
    };
  }

  // Best sellers: dishes ordered (orders not cancelled) in the last 30 local days, all of them.
  let bestSellers: null | { product: string; quantity: number; salesCents: number }[] = null;
  let menuEngineering: null | {
    method: string;
    averageMarginCents: number | null;
    dishes: {
      dish: string;
      class: string | null;
      sold: number;
      avgPriceCents: number;
      recipeCostCents: number | null;
      marginPerUnitCents: number | null;
    }[];
    soldWithoutRecipeCost: string[];
  } = null;
  if (rows.itemSales) {
    const by = new Map<string, { product: string; quantity: number; salesCents: number }>();
    for (const r of rows.itemSales) {
      const cur = by.get(r.product_id) ?? { product: r.product_name, quantity: 0, salesCents: 0 };
      cur.quantity += Number(r.units);
      cur.salesCents += Number(r.sales_cents);
      by.set(r.product_id, cur);
    }
    bestSellers = [...by.values()].sort((a, b) => b.salesCents - a.salesCents).slice(0, 15);
    if (rows.recipeCosts) {
      const m = analyzeMenu(rows.itemSales, rows.recipeCosts);
      menuEngineering = {
        method:
          "Kasavana & Smith: star = popular and high margin; plowhorse = popular, low margin; puzzle = high margin, sells little; dog = sells little, low margin. Popular = at least 70% of an even share of units; high margin = at least the average margin per unit. Margin per unit = average price sold - current recipe cost.",
        averageMarginCents: m.averageMarginCents,
        dishes: m.items.slice(0, 30).map((i) => ({
          dish: i.name,
          class: i.menuClass,
          sold: i.units,
          avgPriceCents: i.avgPriceCents,
          recipeCostCents: i.unitCostCents,
          marginPerUnitCents: i.marginCents,
        })),
        soldWithoutRecipeCost: m.noCost.slice(0, 20).map((i) => i.name),
      };
    }
  }

  const lowStock =
    rows.inventory === null
      ? null
      : rows.inventory
          .filter((i) => Number(i.quantity) <= Number(i.min_quantity))
          .slice(0, 40)
          .map((i) => ({
            item: i.name,
            store: storeName.get(i.location_id) ?? i.location_id,
            quantity: Number(i.quantity),
            minimum: Number(i.min_quantity),
            unit: i.unit,
          }));

  // What to buy for the next 7 days, from what sales consumed in the last 30 (same as Inventory).
  let forecast: null | {
    method: string;
    buy: {
      item: string;
      store: string;
      unit: string;
      onHand: number;
      usePerDay: number;
      lastsDays: number;
      buy: number;
      supplier: string | null;
    }[];
    atOrBelowMinimumWithoutSalesUse: string[];
  } = null;
  if (rows.inventory && rows.consumption) {
    const f = purchaseForecast(
      rows.inventory
        .filter((i) => i.id)
        .map((i) => ({
          id: i.id as string,
          name: i.name,
          unit: i.unit,
          locationId: i.location_id,
          quantity: Number(i.quantity),
          minQuantity: Number(i.min_quantity),
          supplier: i.supplier ?? "",
          active: true,
        })),
      rows.consumption,
      30,
      7,
    );
    forecast = {
      method:
        "usePerDay = what sales consumed in the last 30 days / 30 (adjustments and losses excluded); buy = usePerDay x 7 + minimum - on hand, rounded up; items with no sales use get no quantity.",
      buy: f.lines.slice(0, 25).map((l) => ({
        item: l.name,
        store: storeName.get(l.locationId) ?? l.locationId,
        unit: l.unit,
        onHand: l.quantity,
        usePerDay: Math.round(l.dailyUse * 100) / 100,
        lastsDays: Math.floor(l.coverDays),
        buy: l.suggested,
        supplier: l.supplier || null,
      })),
      atOrBelowMinimumWithoutSalesUse: f.belowMinimumNoUse.slice(0, 20).map((i) => i.name),
    };
  }

  return {
    organization: rows.organization,
    generatedAt: rows.now,
    stores: rows.stores.map((s) => ({ name: s.name, timezone: s.timezone })),
    moneyUnit: "US cents",
    ledgerLast30Days: ledger,
    bestSellersLast30Days: bestSellers,
    menuEngineeringLast30Days: menuEngineering,
    stockAtOrBelowMinimum: lowStock,
    purchaseForecastNext7Days: forecast,
    openOrdersNow: rows.openOrders,
  };
}
