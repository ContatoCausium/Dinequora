import type { Resources } from "./operational-mappers";
import type { IntelligenceSummary } from "./intelligence-service";
import type { LedgerFigures } from "./financial-summary";
import { inWindow, type DayWindow } from "./financial-period";

/** A ledger amount row: what the revenue/COGS arithmetic needs (server row or summary row). */
export interface LedgerAmountRow {
  kind: string;
  amount_cents: number;
}

/** Revenue and COGS come exclusively from the server ledger; reversals are additive. */
export function ledgerMetrics(entries: readonly LedgerAmountRow[]) {
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

/** Competency day of a raw expense row (competency date, falling back to the due date). */
function expenseRow(e: Resources["expenses"][number]) {
  const p = e.payload;
  if (!p || typeof p !== "object" || Array.isArray(p) || typeof p["amountCents"] !== "number")
    return null;
  const day =
    typeof p["competencyDate"] === "string" && p["competencyDate"]
      ? p["competencyDate"]
      : typeof p["dueDate"] === "string"
        ? p["dueDate"]
        : "";
  return {
    storeDbId: e.location_id,
    competencyDate: day.slice(0, 10),
    amountCents: p["amountCents"] as number,
    isSimulation: p["isSimulation"] === true,
  };
}

/**
 * Operating expenses recognized in each store's own window (competency date inside that store's
 * local days; simulated rows never count) — the same rule as Finance, Reports and the Overview.
 */
export function rawExpensesInWindows(
  expenses: Resources["expenses"],
  windows: ReadonlyMap<string, DayWindow | null>,
): number {
  let total = 0;
  for (const e of expenses) {
    const row = expenseRow(e);
    if (!row || row.isSimulation || !/^\d{4}-\d{2}-\d{2}$/.test(row.competencyDate)) continue;
    const w = windows.get(row.storeDbId);
    if (w && inWindow(row.competencyDate, w)) total += row.amountCents;
  }
  return total;
}

/**
 * Insights figures for a period: revenue and COGS from the complete ledger summary (the same
 * figures as the Overview, Finance and Reports for that period), expenses recognized in the same
 * store windows.
 */
export function recordedIntelligence(
  resources: Resources,
  ledger: LedgerFigures,
  operatingExpensesCents: number,
): IntelligenceSummary {
  const low = resources.inventory.filter((i) => i.quantity <= i.min_quantity).length;
  return {
    grossRevenueCents: ledger.revenueCents,
    netRevenueCents: ledger.revenueCents - ledger.cogsCents - operatingExpensesCents,
    foodCostCents: ledger.cogsCents,
    cmvRate: ledger.revenueCents > 0 ? (ledger.cogsCents / ledger.revenueCents) * 100 : 0,
    grossMarginRate:
      ledger.revenueCents > 0
        ? ((ledger.revenueCents - ledger.cogsCents) / ledger.revenueCents) * 100
        : 0,
    operatingExpensesCents,
    estimatedWasteCents: 0,
    lowStockItemCount: low,
    activeRecipeCount: resources.recipes.length,
    analyzedOrderCount: ledger.sales,
    dataBreakdown: {
      realTransactionsCount: ledger.entries,
      realOrdersCount: ledger.sales,
      inventoryCount: resources.inventory.length,
    },
    insights: [],
  };
}
