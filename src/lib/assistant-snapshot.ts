/**
 * The data the management assistant answers from (migration 0040). Pure: the server reads the rows
 * through RLS as the asking member and this module compresses them into a small JSON the model reads.
 * A part the member cannot read arrives as null and stays null ("not available"), never as zero.
 */

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
        name: string;
        unit: string;
        quantity: number;
        min_quantity: number;
        location_id: string;
      }[]
    | null;
  orders:
    | readonly {
        location_id: string;
        status: string;
        is_simulation: boolean;
        order_items:
          readonly { product_name: string; quantity: number; subtotal_cents: number }[] | null;
        payments: readonly { status: string }[] | null;
      }[]
    | null;
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

  // Best sellers: paid, not cancelled, not simulated orders of the last 30 days.
  let bestSellers: null | { product: string; quantity: number; salesCents: number }[] = null;
  let paidOrders: number | null = null;
  if (rows.orders) {
    const by = new Map<string, { quantity: number; salesCents: number }>();
    let n = 0;
    for (const o of rows.orders) {
      const paid = (o.payments ?? []).some((p) => p.status !== "reversed");
      if (!paid || o.status === "cancelled" || o.is_simulation) continue;
      n += 1;
      for (const i of o.order_items ?? []) {
        const cur = by.get(i.product_name) ?? { quantity: 0, salesCents: 0 };
        cur.quantity += i.quantity;
        cur.salesCents += i.subtotal_cents;
        by.set(i.product_name, cur);
      }
    }
    paidOrders = n;
    bestSellers = [...by.entries()]
      .map(([product, v]) => ({ product, ...v }))
      .sort((a, b) => b.salesCents - a.salesCents)
      .slice(0, 15);
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

  return {
    organization: rows.organization,
    generatedAt: rows.now,
    stores: rows.stores.map((s) => ({ name: s.name, timezone: s.timezone })),
    moneyUnit: "US cents",
    ledgerLast30Days: ledger,
    bestSellersLast30Days: bestSellers,
    paidOrdersLast30Days: paidOrders,
    stockAtOrBelowMinimum: lowStock,
    openOrdersNow: rows.openOrders,
  };
}
