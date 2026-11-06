import type { Resources } from "./operational-mappers";
import type { IntelligenceSummary } from "./intelligence-service";

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

export function recordedIntelligence(
  resources: Resources,
  periodDays: number,
): IntelligenceSummary {
  const threshold = Date.now() - periodDays * 86400000;
  const entries = resources.finance.filter((e) => Date.parse(e.created_at) >= threshold);
  const ledger = ledgerMetrics(entries);
  const expenses = resources.expenses.reduce((sum, e) => {
    const p = e.payload;
    if (
      p &&
      typeof p === "object" &&
      !Array.isArray(p) &&
      typeof p["amountCents"] === "number" &&
      !p["isSimulation"]
    )
      return sum + p["amountCents"];
    return sum;
  }, 0);
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
