import { PERSONNEL_CATEGORIES, type Expense, type ExpenseCategory } from "./finance-service";

/**
 * Pure, shared definitions so Dashboard, Finance and Reports can never disagree:
 *  - revenue  = POS sales net of tax (ledger "revenue" minus reversals)
 *  - COGS     = recipe cost of what was sold (ledger "cogs" minus reversals)
 *  - gross profit = revenue - COGS
 *  - operating expenses = finance_expenses (non-simulation)
 *  - result   = gross profit - operating expenses
 * Purchases (stock acquisition) are NOT expenses here: their cost reaches the P&L through COGS.
 */
export type ExpenseStatusView = "paid" | "pending" | "overdue";

/** Local calendar date as YYYY-MM-DD (due dates are stored as plain dates). */
export function todayIso(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** A pending bill whose due date has passed is overdue even if nobody updated its status yet. */
export function effectiveStatus(
  e: Pick<Expense, "status" | "dueDate">,
  today: string,
): ExpenseStatusView {
  if (e.status === "paid") return "paid";
  if (e.status === "overdue") return "overdue";
  return e.dueDate && e.dueDate < today ? "overdue" : "pending";
}

function addDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export interface ExpenseSummary {
  totalCents: number;
  paidCents: number;
  pendingCents: number;
  overdueCents: number;
  dueNext7DaysCents: number;
  personnelCents: number;
  operatingCents: number;
  counts: Record<ExpenseStatusView, number>;
  byCategory: { category: ExpenseCategory; cents: number }[];
  byLocation: { locationId: string; cents: number }[];
}

export function summarizeExpenses(
  expenses: readonly Expense[],
  today = todayIso(),
): ExpenseSummary {
  const real = expenses.filter((e) => !e.isSimulation);
  const s: ExpenseSummary = {
    totalCents: 0,
    paidCents: 0,
    pendingCents: 0,
    overdueCents: 0,
    dueNext7DaysCents: 0,
    personnelCents: 0,
    operatingCents: 0,
    counts: { paid: 0, pending: 0, overdue: 0 },
    byCategory: [],
    byLocation: [],
  };
  const cat = new Map<ExpenseCategory, number>();
  const loc = new Map<string, number>();
  const horizon = addDays(today, 7);
  for (const e of real) {
    const st = effectiveStatus(e, today);
    s.totalCents += e.amountCents;
    s.counts[st] += 1;
    if (st === "paid") s.paidCents += e.amountCents;
    if (st === "pending") {
      s.pendingCents += e.amountCents;
      if (e.dueDate <= horizon) s.dueNext7DaysCents += e.amountCents;
    }
    if (st === "overdue") s.overdueCents += e.amountCents;
    if (PERSONNEL_CATEGORIES.includes(e.category)) s.personnelCents += e.amountCents;
    else s.operatingCents += e.amountCents;
    cat.set(e.category, (cat.get(e.category) ?? 0) + e.amountCents);
    loc.set(e.locationId, (loc.get(e.locationId) ?? 0) + e.amountCents);
  }
  s.byCategory = [...cat]
    .map(([category, cents]) => ({ category, cents }))
    .sort((a, b) => b.cents - a.cents);
  s.byLocation = [...loc]
    .map(([locationId, cents]) => ({ locationId, cents }))
    .sort((a, b) => b.cents - a.cents);
  return s;
}

export function financialResult(i: {
  revenueCents: number;
  cogsCents: number;
  expensesCents: number;
}) {
  const grossProfitCents = i.revenueCents - i.cogsCents;
  const resultCents = grossProfitCents - i.expensesCents;
  return {
    grossProfitCents,
    resultCents,
    grossMargin: i.revenueCents > 0 ? grossProfitCents / i.revenueCents : null,
    cogsRate: i.revenueCents > 0 ? i.cogsCents / i.revenueCents : null,
  };
}

/** Upcoming cash out by week (pending + overdue), for the cash-flow forecast. Overdue lands in week 0. */
export function cashOutForecast(expenses: readonly Expense[], weeks = 6, today = todayIso()) {
  const buckets = Array.from({ length: weeks }, (_, i) => ({
    weekStart: addDays(today, i * 7),
    cents: 0,
  }));
  for (const e of expenses) {
    if (e.isSimulation) continue;
    const st = effectiveStatus(e, today);
    if (st === "paid") continue;
    const idx =
      st === "overdue"
        ? 0
        : Math.floor((Date.parse(e.dueDate) - Date.parse(today)) / (7 * 86400000));
    if (idx >= 0 && idx < weeks) buckets[idx]!.cents += e.amountCents;
  }
  return buckets;
}
