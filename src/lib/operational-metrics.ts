import type { Resources } from "./operational-mappers";
import type { IntelligenceSummary } from "./intelligence-service";
import { dayKey, expensesInPeriod } from "./period-metrics";

/** Revenue and COGS come exclusively from the server ledger; reversals are additive. */
export function ledgerMetrics(entries: Resources["finance"]) {
  let revenue = 0;
  let cogs = 0;
  for (const entry of entries) {
    if (entry.kind === "revenue") revenue += entry.amount_cents;
    if (entry.kind === "reversal_revenue") revenue -= entry.amount_cents;
    if (entry.kind === "cogs") cogs += entry.amount_cents;
    if (entry.kind === "reversal_cogs") cogs -= entry.amount_cents;
  }
  return { revenueCents: revenue, cogsCents: cogs };
}

/**
 * Recorded figures for the last `periodDays` days. Revenue and COGS come from ledger entries in the
 * window; expenses count only when their competency date (falling back to the due date) is inside
 * the same window, so the net result compares the same days (same rule as Reports).
 */
export function recordedIntelligence(
  resources: Resources,
  periodDays: number,
  timeZone?: string,
  now: number = Date.now(),
): IntelligenceSummary {
  const threshold = now - periodDays * 86400000;
  const entries = resources.finance.filter((e) => Date.parse(e.created_at) >= threshold);
  const ledger = ledgerMetrics(entries);
  const dated = resources.expenses.flatMap((e) => {
    const p = e.payload;
    if (!p || typeof p !== "object" || Array.isArray(p) || typeof p["amountCents"] !== "number")
      return [];
    const day =
      typeof p["competencyDate"] === "string" && p["competencyDate"]
        ? p["competencyDate"]
        : typeof p["dueDate"] === "string"
          ? p["dueDate"]
          : "";
    return [
      {
        competencyDate: day.slice(0, 10),
        amountCents: p["amountCents"],
        isSimulation: p["isSimulation"] === true,
      },
    ];
  });
  const expenses = expensesInPeriod(
    dated,
    dayKey(new Date(threshold).toISOString(), timeZone),
    dayKey(new Date(now).toISOString(), timeZone),
  );
  const low = resources.inventory.filter((i) => i.quantity <= i.min_quantity).length;
  return {
    grossRevenueCents: ledger.revenueCents,
    netRevenueCents: ledger.revenueCents - ledger.cogsCents - expenses,
    foodCostCents: ledger.cogsCents,
    cmvRate: ledger.revenueCents > 0 ? (ledger.cogsCents / ledger.revenueCents) * 100 : 0,
    grossMarginRate:
      ledger.revenueCents > 0
        ? ((ledger.revenueCents - ledger.cogsCents) / ledger.revenueCents) * 100
        : 0,
    operatingExpensesCents: expenses,
    estimatedWasteCents: 0,
    lowStockItemCount: low,
    activeRecipeCount: resources.recipes.length,
    analyzedOrderCount: new Set(entries.flatMap((e) => (e.order_id ? [e.order_id] : []))).size,
    dataBreakdown: {
      realTransactionsCount: entries.length,
      realOrdersCount: new Set(entries.flatMap((e) => (e.order_id ? [e.order_id] : []))).size,
      inventoryCount: resources.inventory.length,
    },
    insights: [],
  };
}
