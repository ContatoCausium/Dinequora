import { effectiveStatus, financialResult, type ExpenseStatusView } from "@/lib/expense-metrics";
import {
  PERSONNEL_CATEGORIES,
  type Expense,
  type ExpenseCategory,
  type ExpenseRecurrence,
  type ExpenseStatus,
} from "@/lib/finance-service";
import type { Resources } from "@/lib/operational-mappers";
import { ledgerMetrics } from "@/lib/operational-metrics";
import { dayKey } from "@/lib/period-metrics";
import { centsToDecimalString, parseMoneyInput } from "@/lib/money";

/**
 * Pure view-model helpers for the Finance screen. Every figure is derived from recorded rows:
 * revenue/COGS from `finance_entries` (via the shared `ledgerMetrics`), expenses from
 * `finance_expenses`. Purchases (stock acquisition) never enter here as expenses.
 */
export type LedgerEntry = Resources["finance"][number];
export type StoreRef = { id: string; name: string; dbId?: string | undefined };

/** Ledger rows belonging to one store slug (or all when `locationId` is "all"). */
export function ledgerForLocation(
  entries: readonly LedgerEntry[],
  locations: readonly StoreRef[],
  locationId: string,
): LedgerEntry[] {
  if (locationId === "all") return [...entries];
  const dbId = locations.find((l) => l.id === locationId)?.dbId;
  return dbId ? entries.filter((e) => e.location_id === dbId) : [];
}

/** Calendar month (YYYY-MM) an expense is accrued to: competency date, falling back to due date. */
export function expenseMonth(e: Pick<Expense, "competencyDate" | "dueDate">): string {
  return (e.competencyDate || e.dueDate).slice(0, 7);
}

export interface MonthPoint {
  month: string; // YYYY-MM
  revenueCents: number;
  cogsCents: number;
  expensesCents: number;
  resultCents: number;
}

/**
 * Monthly revenue, COGS, operating expenses and result for months that actually have records,
 * up to and including `currentMonth` (future bills belong to the forecast, not to history).
 * Months between the first and last recorded month are kept with zeros so the axis is continuous.
 */
export function monthlyTrend(
  entries: readonly LedgerEntry[],
  expenses: readonly Expense[],
  currentMonth: string,
  /** Store zone: a sale belongs to the month it happened in locally, like expense competency. */
  timeZone?: string,
): MonthPoint[] {
  const ledgerByMonth = new Map<string, LedgerEntry[]>();
  for (const e of entries) {
    // Without a store zone keep the previous UTC month, so callers that pass none are unchanged.
    const m = dayKey(e.created_at, timeZone ?? "UTC").slice(0, 7);
    if (m > currentMonth) continue;
    const list = ledgerByMonth.get(m) ?? [];
    list.push(e);
    ledgerByMonth.set(m, list);
  }
  const expByMonth = new Map<string, number>();
  for (const e of expenses) {
    if (e.isSimulation) continue;
    const m = expenseMonth(e);
    if (!/^\d{4}-\d{2}$/.test(m) || m > currentMonth) continue;
    expByMonth.set(m, (expByMonth.get(m) ?? 0) + e.amountCents);
  }
  const months = [...new Set([...ledgerByMonth.keys(), ...expByMonth.keys()])].sort();
  const first = months[0];
  const last = months[months.length - 1];
  if (!first || !last) return [];
  const out: MonthPoint[] = [];
  for (let m = first; m <= last; m = nextMonth(m)) {
    const { revenueCents, cogsCents } = ledgerMetrics(ledgerByMonth.get(m) ?? []);
    const expensesCents = expByMonth.get(m) ?? 0;
    out.push({
      month: m,
      revenueCents,
      cogsCents,
      expensesCents,
      resultCents: financialResult({ revenueCents, cogsCents, expensesCents }).resultCents,
    });
  }
  return out;
}

export function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const year = y ?? 1970;
  const mon = m ?? 1;
  return mon === 12 ? `${year + 1}-01` : `${year}-${String(mon + 1).padStart(2, "0")}`;
}

export interface ExpenseFilters {
  status: ExpenseStatusView | "all";
  category: ExpenseCategory | "all";
  locationId: string; // "all" or a store slug
  recurrence: Expense["recurrence"] | "all";
  search: string;
}

export function filterExpenses(
  expenses: readonly Expense[],
  f: ExpenseFilters,
  today: string,
): Expense[] {
  const q = f.search.trim().toLowerCase();
  return expenses.filter((e) => {
    if (f.status !== "all" && effectiveStatus(e, today) !== f.status) return false;
    if (f.category !== "all" && e.category !== f.category) return false;
    if (f.locationId !== "all" && e.locationId !== f.locationId) return false;
    if (f.recurrence !== "all" && e.recurrence !== f.recurrence) return false;
    if (q) {
      const hay = `${e.description} ${e.supplierName ?? ""} ${e.responsiblePerson}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Overdue first, then pending by due date, then paid (most recent due date first). */
export function sortExpenses(expenses: readonly Expense[], today: string): Expense[] {
  const rank: Record<ExpenseStatusView, number> = { overdue: 0, pending: 1, paid: 2 };
  return [...expenses].sort((a, b) => {
    const sa = rank[effectiveStatus(a, today)];
    const sb = rank[effectiveStatus(b, today)];
    if (sa !== sb) return sa - sb;
    if (sa === 2) return b.dueDate.localeCompare(a.dueDate);
    return a.dueDate.localeCompare(b.dueDate);
  });
}

export interface ExpenseGroup {
  key: string;
  totalCents: number;
  openCents: number; // pending + overdue
  overdueCents: number;
  count: number;
}

export function groupExpenses(
  expenses: readonly Expense[],
  by: "store" | "category",
  today: string,
): ExpenseGroup[] {
  const map = new Map<string, ExpenseGroup>();
  for (const e of expenses) {
    if (e.isSimulation) continue;
    const key = by === "store" ? e.locationId : e.category;
    const g = map.get(key) ?? { key, totalCents: 0, openCents: 0, overdueCents: 0, count: 0 };
    const st = effectiveStatus(e, today);
    g.totalCents += e.amountCents;
    g.count += 1;
    if (st !== "paid") g.openCents += e.amountCents;
    if (st === "overdue") g.overdueCents += e.amountCents;
    map.set(key, g);
  }
  return [...map.values()].sort((a, b) => b.totalCents - a.totalCents);
}

function addDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Pending (not overdue) bills due between today and `today + days`, soonest first. */
export function upcomingBills(expenses: readonly Expense[], today: string, days = 14): Expense[] {
  const horizon = addDays(today, days);
  return expenses
    .filter(
      (e) => !e.isSimulation && effectiveStatus(e, today) === "pending" && e.dueDate <= horizon,
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Overdue bills (explicitly overdue or pending past due date), oldest first. */
export function overdueBills(expenses: readonly Expense[], today: string): Expense[] {
  return expenses
    .filter((e) => !e.isSimulation && effectiveStatus(e, today) === "overdue")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Copies with the status the user should see (pending past due ⇒ overdue). Used for exports. */
export function withEffectiveStatus(expenses: readonly Expense[], today: string): Expense[] {
  return expenses.map((e) => ({ ...e, status: effectiveStatus(e, today) }));
}

export interface StoreResult {
  locationId: string;
  locationName: string;
  revenueCents: number;
  cogsCents: number;
  grossProfitCents: number;
  grossMargin: number | null;
  expensesCents: number;
  personnelCents: number;
  resultCents: number;
  hasData: boolean;
}

/** Per-store P&L using the same definitions as the consolidated view. */
export function storeResults(
  locations: readonly StoreRef[],
  entries: readonly LedgerEntry[],
  expenses: readonly Expense[],
): StoreResult[] {
  return locations.map((loc) => {
    const ledger = ledgerMetrics(ledgerForLocation(entries, locations, loc.id));
    const own = expenses.filter((e) => e.locationId === loc.id && !e.isSimulation);
    const expensesCents = own.reduce((s, e) => s + e.amountCents, 0);
    const personnelCents = own
      .filter((e) => PERSONNEL_CATEGORIES.includes(e.category))
      .reduce((s, e) => s + e.amountCents, 0);
    const r = financialResult({ ...ledger, expensesCents });
    return {
      locationId: loc.id,
      locationName: loc.name,
      revenueCents: ledger.revenueCents,
      cogsCents: ledger.cogsCents,
      grossProfitCents: r.grossProfitCents,
      grossMargin: r.grossMargin,
      expensesCents,
      personnelCents,
      resultCents: r.resultCents,
      hasData: ledger.revenueCents !== 0 || ledger.cogsCents !== 0 || own.length > 0,
    };
  });
}

/**
 * The JSON payload stored in `finance_expenses.payload`. `save_operational_record` replaces the
 * payload as a whole, so updates must resend every stored field; `id` targets the same record.
 */
export function expensePayload(
  e: Pick<
    Expense,
    | "category"
    | "recurrence"
    | "status"
    | "description"
    | "amountCents"
    | "dueDate"
    | "competencyDate"
    | "responsiblePerson"
    | "isSimulation"
  > & { id?: string | undefined; supplierName?: string | undefined; paidAt?: string | undefined },
): Record<string, string | number | boolean> {
  const payload: Record<string, string | number | boolean> = {
    category: e.category,
    recurrence: e.recurrence,
    status: e.status,
    description: e.description,
    amountCents: e.amountCents,
    currency: "usd",
    dueDate: e.dueDate,
    competencyDate: e.competencyDate,
    responsiblePerson: e.responsiblePerson,
    isSimulation: e.isSimulation,
  };
  if (e.id) payload["id"] = e.id;
  if (e.supplierName) payload["supplierName"] = e.supplierName;
  if (e.status === "paid" && e.paidAt) payload["paidAt"] = e.paidAt;
  return payload;
}

/** Payload for the quick "Mark as paid" action: same record, status paid, paidAt now. */
export function markPaidPayload(e: Expense, nowIso: string) {
  return expensePayload({ ...e, status: "paid", paidAt: nowIso });
}

/** Parses a user-typed amount ("1234.5", "1,234.50", "1.234,50") into integer cents; null if invalid. */
export function parseAmountToCents(input: string): number | null {
  return parseMoneyInput(input.replace(/\s/g, ""));
}

/** Series colors in fixed order (dataviz rule: tokens chart-1..6, never raw palette values). */
export const SERIES = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)"];

/* Expense form */

export interface ExpenseFormValues {
  locationId: string;
  description: string;
  amount: string;
  dueDate: string;
  category: ExpenseCategory;
  recurrence: ExpenseRecurrence;
  status: ExpenseStatus;
  supplierName: string;
  responsiblePerson: string;
}

export function initialFormValues(
  editing: Expense | null,
  defaults: { locationId: string; dueDate: string; responsiblePerson: string },
): ExpenseFormValues {
  if (editing) {
    return {
      locationId: editing.locationId,
      description: editing.description,
      amount: centsToDecimalString(editing.amountCents),
      dueDate: editing.dueDate,
      category: editing.category,
      recurrence: editing.recurrence,
      // "overdue" is derived from the due date; the form only chooses paid or not paid.
      status: editing.status === "paid" ? "paid" : "pending",
      supplierName: editing.supplierName ?? "",
      responsiblePerson: editing.responsiblePerson,
    };
  }
  return {
    locationId: defaults.locationId,
    description: "",
    amount: "",
    dueDate: defaults.dueDate,
    category: "rent",
    recurrence: "fixed",
    status: "pending",
    supplierName: "",
    responsiblePerson: defaults.responsiblePerson,
  };
}
