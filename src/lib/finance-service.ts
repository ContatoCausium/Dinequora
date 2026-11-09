import {
  assertTenantContext,
  isLocationAllowed,
  readTenantRecords,
  TenantContextError,
  writeTenantRecords,
} from "./tenant-storage";
export type ExpenseRecurrence = "fixed" | "variable" | "recurring";
export type ExpenseStatus = "pending" | "paid" | "overdue";
/**
 * Single source of truth for expense categories (stored in finance_expenses.payload.category).
 * "utilities" is kept for records created before energy/water/internet were split out.
 */
export const EXPENSE_CATEGORIES = [
  "rent",
  "payroll",
  "benefits",
  "energy",
  "water",
  "internet",
  "utilities",
  "maintenance",
  "marketing",
  "taxes",
  "suppliers",
  "ingredients",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
/** Personnel cost = salaries/payroll + benefits. */
export const PERSONNEL_CATEGORIES: readonly ExpenseCategory[] = ["payroll", "benefits"];

export interface Expense {
  id: string;
  orgId: string;
  locationId: string;
  category: ExpenseCategory;
  recurrence: ExpenseRecurrence;
  status: ExpenseStatus;
  supplierName?: string | undefined;
  description: string;
  amountCents: number;
  currency: "usd";
  dueDate: string;
  paidAt?: string | undefined;
  competencyDate: string;
  responsiblePerson: string;
  receiptAttachment?: string | undefined;
  isSimulation: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CashFlowGranularity = "daily" | "weekly" | "monthly";
export type TransactionKind = "inflow" | "outflow";
export type EntryOrigin = "pos_orders" | "purchase_orders" | "manual_expense" | "manual_revenue";
export type RealizationStatus = "realized" | "projected" | "simulated";

export interface CashFlowEntry {
  id: string;
  date: string;
  description: string;
  kind: TransactionKind;
  amountCents: number;
  status: RealizationStatus;
  origin: EntryOrigin;
  category: string;
  responsiblePerson?: string;
  paymentMethod?: string;
  referenceDoc?: string;
}

export interface CashFlowBucket {
  label: string;
  initialBalanceCents: number;
  inflowCents: number;
  outflowCents: number;
  netCents: number;
  finalBalanceCents: number;
  entriesCount: number;
}

export interface CashFlowTimeline {
  granularity: CashFlowGranularity;
  buckets: CashFlowBucket[];
  totalInflowCents: number;
  totalOutflowCents: number;
  netOperatingCents: number;
  initialOpeningCents: number;
  closingCashCents: number;
}

export interface FinanceSummary {
  totalRevenueCents: number;
  simulatedRevenueCents: number;
  fixedExpensesCents: number;
  variableExpensesCents: number;
  totalExpensesCents: number;
  estimatedNetCents: number;
  marginPercent: number;
  pendingPayablesCents: number;
  overduePayablesCents: number;
  paidCents: number;
  receivablesPendingCents: number;
  initialCashBalanceCents: number;
  closingCashBalanceCents: number;
}

export interface MonthlyTrend {
  month: string;
  revenueCents: number;
  expensesCents: number;
  netProfitCents: number;
}

export interface ProductMarginMetric {
  productId: string;
  productName: string;
  category: string;
  unitsSold: number;
  revenueCents: number;
  cogsCents: number;
  grossProfitCents: number;
  grossMarginPct: number;
  cogsPct: number;
  hasHighCostAlert: boolean;
  hasLowMarginAlert: boolean;
}

export interface CategoryMarginMetric {
  category: string;
  revenueCents: number;
  cogsCents: number;
  grossProfitCents: number;
  grossMarginPct: number;
  cogsPct: number;
}

export type DataReliabilityStatus = "realized" | "projected" | "estimated" | "simulated" | "empty";

export interface StoreFinancialComparison {
  locationId: string;
  locationName: string;
  orderCount: number;
  grossRevenueCents: number;
  discountsCents: number;
  taxesCents: number;
  netRevenueCents: number;
  cogsCents: number;
  cogsPct: number;
  operatingExpensesCents: number;
  grossProfitCents: number;
  grossMarginPct: number;
  estimatedNetProfitCents: number;
  netMarginPct: number;
  averageTicketCents: number;
  simulatedRevenueCents: number;
  hasRealData: boolean;
  status: DataReliabilityStatus;
  revenueRank: number;
  marginRank: number;
  netProfitRank: number;
  isBestPerformer: boolean;
  hasHighCostAlert: boolean;
  hasLowMarginAlert: boolean;
}

export interface StoreComparisonSummary {
  stores: StoreFinancialComparison[];
  benchmarkTotalGrossRevenueCents: number;
  benchmarkTotalNetProfitCents: number;
  benchmarkAvgMarginPct: number;
  topRevenueStoreName: string;
  topMarginStoreName: string;
  highestExpenseStoreName: string;
}

export interface DreStatement {
  grossRevenueCents: number;
  discountsCents: number;
  taxesCents: number;
  netRevenueCents: number;
  cogsCents: number;
  cogsPct: number;
  grossProfitCents: number;
  grossMarginPct: number;
  operatingExpensesCents: number;
  fixedExpensesCents: number;
  variableExpensesCents: number;
  operatingProfitCents: number;
  operatingMarginPct: number;
  estimatedNetProfitCents: number;
  netMarginPct: number;
  simulatedGrossRevenueCents: number;
  projectedExpensesCents: number;
  alertsCount: number;
}

/** Expenses persist per organization; only the demo org receives the synthetic seed. */
function getStorage(orgId: string): Expense[] {
  return readTenantRecords<Expense>("finance_expenses", orgId, () =>
    orgId === "demo" ? seedDefaultExpenses().map((e) => ({ ...e, orgId: "demo" })) : [],
  );
}

function setStorage(orgId: string, items: Expense[]) {
  writeTenantRecords("finance_expenses", orgId, items);
}

export function seedDefaultExpenses(): Expense[] {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");

  const defaults: Expense[] = [
    {
      id: "exp-001",
      orgId: "default",
      locationId: "all",
      category: "rent",
      recurrence: "fixed",
      status: "paid",
      supplierName: "Midtown Real Estate Partners",
      description: "Main dining room commercial lease",
      amountCents: 650000,
      currency: "usd",
      dueDate: `${y}-${m}-01`,
      paidAt: `${y}-${m}-01T12:00:00Z`,
      competencyDate: `${y}-${m}-01`,
      responsiblePerson: "Operations Team",
      receiptAttachment: "data:application/pdf;base64,demo-lease-receipt",
      isSimulation: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "exp-002",
      orgId: "default",
      locationId: "all",
      category: "payroll",
      recurrence: "recurring",
      status: "paid",
      supplierName: "ADP TotalSource",
      description: "Kitchen and Front-of-House Bi-weekly payroll",
      amountCents: 1240000,
      currency: "usd",
      dueDate: `${y}-${m}-15`,
      paidAt: `${y}-${m}-15T09:30:00Z`,
      competencyDate: `${y}-${m}-01`,
      responsiblePerson: "Finance Dept",
      receiptAttachment: undefined,
      isSimulation: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "exp-003",
      orgId: "default",
      locationId: "all",
      category: "suppliers",
      recurrence: "variable",
      status: "pending",
      supplierName: "Sysco Wholesale Foods",
      description: "Weekly meat and dairy replenishment delivery",
      amountCents: 345000,
      currency: "usd",
      dueDate: `${y}-${m}-28`,
      competencyDate: `${y}-${m}-01`,
      responsiblePerson: "Kitchen Lead",
      receiptAttachment: undefined,
      isSimulation: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "exp-004",
      orgId: "default",
      locationId: "all",
      category: "utilities",
      recurrence: "fixed",
      status: "pending",
      supplierName: "ConEdison Power & Gas",
      description: "Electric power commercial account",
      amountCents: 142000,
      currency: "usd",
      dueDate: `${y}-${m}-25`,
      competencyDate: `${y}-${m}-01`,
      responsiblePerson: "Store Manager",
      receiptAttachment: undefined,
      isSimulation: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "exp-005",
      orgId: "default",
      locationId: "all",
      category: "taxes",
      recurrence: "fixed",
      status: "overdue",
      supplierName: "State Dept of Revenue",
      description: "Quarterly sales tax filing balance",
      amountCents: 215000,
      currency: "usd",
      dueDate: `${y}-${m}-10`,
      competencyDate: `${y}-${m}-01`,
      responsiblePerson: "CFO",
      receiptAttachment: undefined,
      isSimulation: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    {
      id: "exp-006",
      orgId: "default",
      locationId: "all",
      category: "ingredients",
      recurrence: "variable",
      status: "paid",
      supplierName: "Fresh Produce Express",
      description: "Organic vegetables and salad greens wholesale lot",
      amountCents: 98000,
      currency: "usd",
      dueDate: `${y}-${m}-12`,
      paidAt: `${y}-${m}-12T14:10:00Z`,
      competencyDate: `${y}-${m}-01`,
      responsiblePerson: "Sous Chef",
      receiptAttachment: undefined,
      isSimulation: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  ];

  // Pure: no longer writes a shared global key. The demo org namespace persists it on first read.
  return defaults;
}

export function listExpenses(
  orgId: string,
  locationId?: string,
  allowedLocationIds?: readonly string[],
): Expense[] {
  assertTenantContext(orgId);
  if (locationId && locationId !== "all" && !isLocationAllowed(locationId, allowedLocationIds))
    return [];
  return getStorage(orgId).filter((exp) => {
    if (exp.orgId !== orgId) return false;
    // "all" expenses are org-wide (shared costs); store expenses require store authorization.
    if (exp.locationId !== "all" && !isLocationAllowed(exp.locationId, allowedLocationIds))
      return false;
    if (
      locationId &&
      locationId !== "all" &&
      exp.locationId !== "all" &&
      exp.locationId !== locationId
    ) {
      return false;
    }
    return true;
  });
}

function assertExpenseWritable(
  locationId: string,
  allowedLocationIds: readonly string[] | undefined,
): void {
  if (!allowedLocationIds) return;
  if (locationId === "all" || !allowedLocationIds.includes(locationId))
    throw new TenantContextError("location_forbidden");
}

export function saveExpense(
  expense: Omit<Expense, "id" | "createdAt" | "updatedAt"> & { id?: string | undefined },
  allowedLocationIds?: readonly string[],
): Expense {
  const orgId = assertTenantContext(expense.orgId);
  assertExpenseWritable(expense.locationId, allowedLocationIds);
  const all = getStorage(orgId);
  const isEdit = !!expense.id;
  const id = expense.id ?? `exp-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const existing = all.find((i) => i.id === id);
  if (existing) assertExpenseWritable(existing.locationId, allowedLocationIds);

  const nextItem: Expense = {
    ...expense,
    orgId,
    id,
    createdAt: isEdit ? (existing?.createdAt ?? now) : now,
    updatedAt: now,
  };

  const filtered = all.filter((i) => i.id !== id);
  setStorage(orgId, [nextItem, ...filtered]);
  return nextItem;
}

export function deleteExpense(
  expenseId: string,
  orgId: string,
  allowedLocationIds?: readonly string[],
): boolean {
  assertTenantContext(orgId);
  const all = getStorage(orgId);
  const target = all.find((i) => i.id === expenseId);
  if (!target) return false;
  assertExpenseWritable(target.locationId, allowedLocationIds);
  setStorage(
    orgId,
    all.filter((i) => i.id !== expenseId),
  );
  return true;
}

export function updateExpenseStatus(
  expenseId: string,
  status: ExpenseStatus,
  orgId: string,
  allowedLocationIds?: readonly string[],
): Expense | null {
  assertTenantContext(orgId);
  const all = getStorage(orgId);
  const idx = all.findIndex((i) => i.id === expenseId);
  if (idx === -1) return null;

  const existing = all[idx];
  if (!existing) return null;
  assertExpenseWritable(existing.locationId, allowedLocationIds);

  const updated: Expense = {
    ...existing,
    status,
    paidAt: status === "paid" ? new Date().toISOString() : undefined,
    updatedAt: new Date().toISOString(),
  };

  all[idx] = updated;
  setStorage(orgId, all);
  return updated;
}

export function computeFinanceSummary(
  expenses: Expense[],
  realSalesCents = 0,
  simulatedSalesCents = 0,
  initialOpeningCents = 1500000,
  receivablesPendingCents = 0,
): FinanceSummary {
  let fixed = 0;
  let variable = 0;
  let pending = 0;
  let overdue = 0;
  let paid = 0;

  for (const exp of expenses) {
    if (exp.recurrence === "fixed") {
      fixed += exp.amountCents;
    } else {
      variable += exp.amountCents;
    }

    if (exp.status === "paid") {
      paid += exp.amountCents;
    } else if (exp.status === "overdue") {
      overdue += exp.amountCents;
    } else {
      pending += exp.amountCents;
    }
  }

  const totalExpenses = fixed + variable;
  const estimatedNet = realSalesCents - totalExpenses;
  const margin = realSalesCents > 0 ? (estimatedNet / realSalesCents) * 100 : 0;
  const closingCash = initialOpeningCents + realSalesCents - paid;

  return {
    totalRevenueCents: realSalesCents,
    simulatedRevenueCents: simulatedSalesCents,
    fixedExpensesCents: fixed,
    variableExpensesCents: variable,
    totalExpensesCents: totalExpenses,
    estimatedNetCents: estimatedNet,
    marginPercent: margin,
    pendingPayablesCents: pending,
    overduePayablesCents: overdue,
    paidCents: paid,
    receivablesPendingCents,
    initialCashBalanceCents: initialOpeningCents,
    closingCashBalanceCents: closingCash,
  };
}

export function calculateDreStatement(
  realSalesCents: number,
  discountsCents: number,
  taxesCents: number,
  cogsCents: number,
  expenses: Expense[],
  simulatedSalesCents = 0,
): DreStatement {
  const grossRevenueCents = Math.max(0, realSalesCents);
  const netRevenueCents = Math.max(
    0,
    grossRevenueCents - Math.max(0, discountsCents) - Math.max(0, taxesCents),
  );
  const safeCogsCents = Math.max(0, cogsCents);
  const grossProfitCents = netRevenueCents - safeCogsCents;
  const grossMarginPct = netRevenueCents > 0 ? (grossProfitCents / netRevenueCents) * 100 : 0;
  const cogsPct = netRevenueCents > 0 ? (safeCogsCents / netRevenueCents) * 100 : 0;

  let fixedExp = 0;
  let varExp = 0;
  let projExp = 0;

  for (const exp of expenses) {
    if (exp.isSimulation) continue;
    if (exp.category === "ingredients" || exp.category === "suppliers") continue; // Exclude direct COGS from OpEx
    if (exp.recurrence === "fixed") {
      fixedExp += exp.amountCents;
    } else {
      varExp += exp.amountCents;
    }
    if (exp.status === "pending" || exp.status === "overdue") {
      projExp += exp.amountCents;
    }
  }

  const operatingExpensesCents = fixedExp + varExp;
  const operatingProfitCents = grossProfitCents - operatingExpensesCents;
  const operatingMarginPct =
    netRevenueCents > 0 ? (operatingProfitCents / netRevenueCents) * 100 : 0;
  const estimatedNetProfitCents = operatingProfitCents;
  const netMarginPct = netRevenueCents > 0 ? (estimatedNetProfitCents / netRevenueCents) * 100 : 0;

  let alerts = 0;
  if (netRevenueCents > 0 && safeCogsCents / netRevenueCents > 0.35) alerts += 1;
  if (grossMarginPct < 60 && netRevenueCents > 0) alerts += 1;

  return {
    grossRevenueCents,
    discountsCents: Math.max(0, discountsCents),
    taxesCents: Math.max(0, taxesCents),
    netRevenueCents,
    cogsCents: safeCogsCents,
    grossProfitCents,
    grossMarginPct,
    cogsPct,
    operatingExpensesCents,
    fixedExpensesCents: fixedExp,
    variableExpensesCents: varExp,
    operatingProfitCents,
    operatingMarginPct,
    estimatedNetProfitCents,
    netMarginPct,
    simulatedGrossRevenueCents: Math.max(0, simulatedSalesCents),
    projectedExpensesCents: projExp,
    alertsCount: alerts,
  };
}

export function calculateProductMargins(
  products: Array<{
    id: string;
    name: string;
    category?: string;
    priceCents: number;
    recipeCostCents?: number;
    unitsSold?: number;
  }>,
): ProductMarginMetric[] {
  return products.map((p) => {
    const units = p.unitsSold ?? 1;
    const unitPrice = p.priceCents;
    const unitCost = p.recipeCostCents ?? Math.round(unitPrice * 0.28);
    const rev = unitPrice * units;
    const cogs = unitCost * units;
    const gross = rev - cogs;
    const marginPct = rev > 0 ? (gross / rev) * 100 : 0;
    const cogsPct = rev > 0 ? (cogs / rev) * 100 : 0;

    return {
      productId: p.id,
      productName: p.name,
      category: p.category || "General",
      unitsSold: units,
      revenueCents: rev,
      cogsCents: cogs,
      grossProfitCents: gross,
      grossMarginPct: marginPct,
      cogsPct,
      hasHighCostAlert: cogsPct > 35,
      hasLowMarginAlert: marginPct < 60,
    };
  });
}

export function calculateCategoryMargins(
  productMetrics: ProductMarginMetric[],
): CategoryMarginMetric[] {
  const grouped = new Map<string, { rev: number; cogs: number; gross: number }>();

  for (const m of productMetrics) {
    const cat = m.category || "General";
    const cur = grouped.get(cat) ?? { rev: 0, cogs: 0, gross: 0 };
    cur.rev += m.revenueCents;
    cur.cogs += m.cogsCents;
    cur.gross += m.grossProfitCents;
    grouped.set(cat, cur);
  }

  return Array.from(grouped.entries()).map(([category, val]) => ({
    category,
    revenueCents: val.rev,
    cogsCents: val.cogs,
    grossProfitCents: val.gross,
    grossMarginPct: val.rev > 0 ? (val.gross / val.rev) * 100 : 0,
    cogsPct: val.rev > 0 ? (val.cogs / val.rev) * 100 : 0,
  }));
}

export function compareStoreFinancials(
  storesInput: Array<{
    id: string;
    name: string;
    orders: Array<{
      id: string;
      totalCents: number;
      discountCents?: number;
      taxCents?: number;
      status: string;
      isSimulated?: boolean;
    }>;
    expenses: Expense[];
    cogsRatio?: number;
  }>,
): StoreComparisonSummary {
  if (storesInput.length === 0) {
    return {
      stores: [],
      benchmarkTotalGrossRevenueCents: 0,
      benchmarkTotalNetProfitCents: 0,
      benchmarkAvgMarginPct: 0,
      topRevenueStoreName: "-",
      topMarginStoreName: "-",
      highestExpenseStoreName: "-",
    };
  }

  const results: StoreFinancialComparison[] = storesInput.map((store) => {
    const realOrders = store.orders.filter((o) => o.status === "delivered" && !o.isSimulated);
    const simOrders = store.orders.filter((o) => o.isSimulated);

    const grossRevenueCents = realOrders.reduce((acc, o) => acc + o.totalCents, 0);
    const simulatedRevenueCents = simOrders.reduce((acc, o) => acc + o.totalCents, 0);
    const discountsCents = realOrders.reduce((acc, o) => acc + (o.discountCents || 0), 0);
    const taxesCents = realOrders.reduce((acc, o) => acc + (o.taxCents || 0), 0);
    const netRevenueCents = Math.max(0, grossRevenueCents - discountsCents - taxesCents);

    const ratio = store.cogsRatio ?? 0.28;
    const cogsCents = Math.round(netRevenueCents * ratio);
    const grossProfitCents = netRevenueCents - cogsCents;
    const grossMarginPct = netRevenueCents > 0 ? (grossProfitCents / netRevenueCents) * 100 : 0;
    const cogsPct = netRevenueCents > 0 ? (cogsCents / netRevenueCents) * 100 : 0;

    const operatingExpensesCents = store.expenses
      .filter((e) => !e.isSimulation && e.category !== "ingredients" && e.category !== "suppliers")
      .reduce((acc, e) => acc + e.amountCents, 0);

    const estimatedNetProfitCents = grossProfitCents - operatingExpensesCents;
    const netMarginPct =
      netRevenueCents > 0 ? (estimatedNetProfitCents / netRevenueCents) * 100 : 0;
    const averageTicketCents =
      realOrders.length > 0 ? Math.round(grossRevenueCents / realOrders.length) : 0;

    const hasRealData = realOrders.length > 0 || store.expenses.length > 0;
    let status: DataReliabilityStatus = "empty";
    if (hasRealData) {
      status = simulatedRevenueCents > grossRevenueCents ? "simulated" : "realized";
    } else if (simulatedRevenueCents > 0) {
      status = "simulated";
    }

    return {
      locationId: store.id,
      locationName: store.name,
      orderCount: realOrders.length,
      grossRevenueCents,
      discountsCents,
      taxesCents,
      netRevenueCents,
      cogsCents,
      cogsPct,
      operatingExpensesCents,
      grossProfitCents,
      grossMarginPct,
      estimatedNetProfitCents,
      netMarginPct,
      averageTicketCents,
      simulatedRevenueCents,
      hasRealData,
      status,
      revenueRank: 1,
      marginRank: 1,
      netProfitRank: 1,
      isBestPerformer: false,
      hasHighCostAlert:
        cogsPct > 35 || (netRevenueCents > 0 && operatingExpensesCents / netRevenueCents > 0.45),
      hasLowMarginAlert: netRevenueCents > 0 && netMarginPct < 10,
    };
  });

  // Sort and assign ranks
  const revSorted = [...results].sort((a, b) => b.grossRevenueCents - a.grossRevenueCents);
  revSorted.forEach((item, index) => {
    const match = results.find((r) => r.locationId === item.locationId);
    if (match) match.revenueRank = index + 1;
  });

  const marginSorted = [...results].sort((a, b) => b.netMarginPct - a.netMarginPct);
  marginSorted.forEach((item, index) => {
    const match = results.find((r) => r.locationId === item.locationId);
    if (match) match.marginRank = index + 1;
  });

  const netProfitSorted = [...results].sort(
    (a, b) => b.estimatedNetProfitCents - a.estimatedNetProfitCents,
  );
  netProfitSorted.forEach((item, index) => {
    const match = results.find((r) => r.locationId === item.locationId);
    if (match) {
      match.netProfitRank = index + 1;
      if (index === 0 && match.grossRevenueCents > 0) {
        match.isBestPerformer = true;
      }
    }
  });

  const expSorted = [...results].sort(
    (a, b) => b.operatingExpensesCents - a.operatingExpensesCents,
  );

  const totalGross = results.reduce((acc, r) => acc + r.grossRevenueCents, 0);
  const totalNetProfit = results.reduce((acc, r) => acc + r.estimatedNetProfitCents, 0);
  const activeCount = results.filter((r) => r.hasRealData).length || 1;
  const avgMargin = results.reduce((acc, r) => acc + r.netMarginPct, 0) / activeCount;

  return {
    stores: results,
    benchmarkTotalGrossRevenueCents: totalGross,
    benchmarkTotalNetProfitCents: totalNetProfit,
    benchmarkAvgMarginPct: avgMargin,
    topRevenueStoreName: revSorted[0]?.locationName ?? "-",
    topMarginStoreName: marginSorted[0]?.locationName ?? "-",
    highestExpenseStoreName: expSorted[0]?.locationName ?? "-",
  };
}

export function formatUsd(cents: number): string {
  const abs = Math.abs(cents) / 100;
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type FinancialReportType =
  | "revenue"
  | "expenses"
  | "cash_flow"
  | "payables_receivables"
  | "cogs_margins"
  | "store_performance"
  | "monthly_trends";

export interface FinancialReportFilters {
  reportType: FinancialReportType;
  locationId: string;
  startDate?: string;
  endDate?: string;
  category?: string;
  dataType?: "all" | "realized" | "projected" | "simulated";
}

export interface FinancialReportRow {
  id: string;
  /** Machine-friendly key used in exports: an ISO date when `isoDate` is set. */
  dateOrKey: string;
  /** Set when the row is dated, so the UI can format it for the active language. */
  isoDate?: string | undefined;
  title: string;
  category: string;
  locationName: string;
  typeKind: "inflow" | "outflow" | "metric" | "neutral";
  amountCents: number;
  formattedAmount: string;
  statusBadge: string;
  notes?: string | undefined;
}

/** Column and header labels carried with the report so exports use the same language as the UI. */
export interface ReportHeadings {
  restaurant: string;
  location: string;
  report: string;
  period: string;
  generatedAt: string;
  currency: string;
  colDate: string;
  colTitle: string;
  colCategory: string;
  colLocation: string;
  colKind: string;
  colAmount: string;
  colStatus: string;
  colNotes: string;
  sheetName: string;
}

export interface FinancialReportResult {
  title: string;
  reportType: FinancialReportType;
  generatedAt: string;
  restaurantName: string;
  locationName: string;
  periodLabel: string;
  currency: "USD";
  totalInflowCents: number;
  totalOutflowCents: number;
  netBalanceCents: number;
  realizedCount: number;
  projectedCount: number;
  simulatedCount: number;
  rows: FinancialReportRow[];
  headings: ReportHeadings;
}

/** Text used inside generated reports. English defaults; the UI passes translated strings. */
export const DEFAULT_REPORT_TEXT = {
  title_revenue: "Revenue & Sales Breakdown",
  title_expenses: "Operating Expenses Detail",
  title_cash_flow: "Cash Flow Activity Statement",
  title_payables_receivables: "Accounts Payable & Obligations",
  title_cogs_margins: "COGS & Gross Margin by Store",
  title_store_performance: "Multi-Store Financial Performance",
  title_monthly_trends: "Monthly Trends",
  periodAll: "All recorded data",
  order: "Order {{id}}",
  posSales: "POS sales",
  revenueEntry: "Recorded revenue (net of tax)",
  revenueReversal: "Revenue reversal",
  discount: "Discount: {{amount}}",
  supplier: "Supplier: {{name}}",
  cashIn: "Cash in",
  cashOut: "Cash out: {{description}}",
  payable: "Payable: {{description}}",
  storeCogs: "Revenue {{revenue}} · COGS {{cogs}}",
  grossMargin: "Gross margin {{margin}}",
  storeRow: "Revenue {{revenue}} · COGS {{cogs}} · Expenses {{expenses}}",
  monthRow: "Revenue {{revenue}} · COGS {{cogs}} · Expenses {{expenses}}",
  monthlyTrend: "Monthly result",
  realized: "Realized",
  simulated: "Simulated",
  profitable: "Profitable",
  loss: "Loss",
  noData: "No data",
  marginUnavailable: "n/a",
  restaurant: "Restaurant",
  location: "Location",
  report: "Report",
  period: "Period",
  generatedAt: "Generated at",
  currency: "Currency",
  colDate: "Date / Key",
  colTitle: "Title",
  colCategory: "Category",
  colLocation: "Location",
  colKind: "Kind",
  colAmount: "Amount (USD)",
  colStatus: "Status",
  colNotes: "Notes",
  sheetName: "Financial Report",
} as const;
export type ReportTextKey = keyof typeof DEFAULT_REPORT_TEXT;

export interface ReportFormatters {
  text: (key: ReportTextKey, vars?: Record<string, string | number>) => string;
  money: (cents: number) => string;
  percent: (ratio: number) => string;
  category: (category: string) => string;
  status: (status: string) => string;
}

function interpolate(template: string, vars?: Record<string, string | number>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(vars?.[k] ?? ""));
}

export const defaultReportFormatters: ReportFormatters = {
  text: (key, vars) => interpolate(DEFAULT_REPORT_TEXT[key], vars),
  money: formatUsd,
  percent: (r) => `${(r * 100).toFixed(1)}%`,
  category: (c) => c,
  status: (s) => s,
};

/** Ledger revenue rows (finance_entries) already resolved to a store name. */
export interface ReportLedgerEntry {
  id: string;
  createdAt: string;
  kind: string;
  amountCents: number;
  locationName: string;
}

/** Per-store recorded P&L (same definitions as the Finance screen). */
export interface ReportStoreResult {
  locationId: string;
  locationName: string;
  revenueCents: number;
  cogsCents: number;
  grossProfitCents: number;
  grossMargin: number | null;
  expensesCents: number;
  resultCents: number;
  hasData: boolean;
}

export function generateFinancialReport(options: {
  filters: FinancialReportFilters;
  restaurantName: string;
  locationName: string;
  expenses: Expense[];
  orders: Array<{
    id: string;
    totalCents: number;
    discountCents?: number;
    taxCents?: number | undefined;
    status: string;
    isSimulated?: boolean;
    createdAt: string;
    locationId?: string | undefined;
  }>;
  /** When given, revenue and cash inflows come from the ledger instead of order totals. */
  ledger?: ReportLedgerEntry[] | undefined;
  stores?: ReportStoreResult[] | undefined;
  monthlyTrend?:
    | Array<{
        month: string;
        revenueCents: number;
        cogsCents: number;
        expensesCents: number;
        resultCents: number;
      }>
    | undefined;
  /** Resolves a store slug to its display name (for consolidated reports). */
  storeName?: ((locationId: string) => string) | undefined;
  formatters?: Partial<ReportFormatters> | undefined;
}): FinancialReportResult {
  const { filters, restaurantName, locationName, expenses, orders, ledger, stores = [] } = options;
  const f: ReportFormatters = { ...defaultReportFormatters, ...options.formatters };
  const storeOf = (id: string | undefined) =>
    id && options.storeName ? options.storeName(id) : locationName;
  const generatedAt = new Date().toISOString();
  const periodLabel =
    filters.startDate && filters.endDate
      ? `${filters.startDate} - ${filters.endDate}`
      : f.text("periodAll");

  const rows: FinancialReportRow[] = [];
  let totalInflowCents = 0;
  let totalOutflowCents = 0;
  let realizedCount = 0;
  let projectedCount = 0;
  let simulatedCount = 0;

  const matchesData = (st: "realized" | "projected" | "simulated") => {
    if (!filters.dataType || filters.dataType === "all") return true;
    return filters.dataType === st;
  };
  const day = (iso: string) => iso.slice(0, 10);

  const pushLedgerRevenue = (asCashFlow: boolean) => {
    for (const entry of ledger ?? []) {
      const reversal = entry.kind === "reversal_revenue";
      if (entry.kind !== "revenue" && !reversal) continue;
      if (!matchesData("realized")) continue;
      realizedCount += 1;
      const signed = reversal ? -entry.amountCents : entry.amountCents;
      totalInflowCents += signed;
      rows.push({
        id: `${asCashFlow ? "in-" : ""}${entry.id}`,
        dateOrKey: day(entry.createdAt),
        isoDate: day(entry.createdAt),
        title: asCashFlow
          ? f.text("cashIn")
          : f.text(reversal ? "revenueReversal" : "revenueEntry"),
        category: f.text("posSales"),
        locationName: entry.locationName,
        typeKind: "inflow",
        amountCents: signed,
        formattedAmount: f.money(signed),
        statusBadge: f.text("realized"),
      });
    }
  };

  if (filters.reportType === "revenue") {
    if (ledger) {
      pushLedgerRevenue(false);
    } else {
      orders.forEach((ord) => {
        const isSim = !!ord.isSimulated;
        const st: "realized" | "simulated" = isSim ? "simulated" : "realized";
        if (!matchesData(st)) return;
        if (isSim) simulatedCount += 1;
        else realizedCount += 1;
        totalInflowCents += ord.totalCents;
        const date = ord.createdAt ? day(ord.createdAt) : "";
        rows.push({
          id: ord.id,
          dateOrKey: date || "-",
          isoDate: date || undefined,
          title: f.text("order", { id: ord.id.slice(0, 8) }),
          category: f.text("posSales"),
          locationName: storeOf(ord.locationId),
          typeKind: "inflow",
          amountCents: ord.totalCents,
          formattedAmount: f.money(ord.totalCents),
          statusBadge: isSim ? f.text("simulated") : f.status(ord.status),
          notes: ord.discountCents
            ? f.text("discount", { amount: f.money(ord.discountCents) })
            : undefined,
        });
      });
    }
  } else if (filters.reportType === "expenses") {
    expenses.forEach((exp) => {
      if (exp.isSimulation && !matchesData("simulated")) return;
      if (filters.category && filters.category !== "all" && exp.category !== filters.category)
        return;
      const st: "realized" | "projected" | "simulated" = exp.isSimulation
        ? "simulated"
        : exp.status === "paid"
          ? "realized"
          : "projected";
      if (!matchesData(st)) return;
      if (st === "realized") realizedCount += 1;
      else if (st === "simulated") simulatedCount += 1;
      else projectedCount += 1;
      totalOutflowCents += exp.amountCents;
      rows.push({
        id: exp.id,
        dateOrKey: exp.dueDate,
        isoDate: exp.dueDate,
        title: exp.description,
        category: f.category(exp.category),
        locationName: storeOf(exp.locationId),
        typeKind: "outflow",
        amountCents: exp.amountCents,
        formattedAmount: `-${f.money(exp.amountCents)}`,
        statusBadge: f.status(exp.status),
        notes: exp.supplierName ? f.text("supplier", { name: exp.supplierName }) : undefined,
      });
    });
  } else if (filters.reportType === "cash_flow") {
    if (ledger) {
      pushLedgerRevenue(true);
    } else {
      orders
        .filter((o) => o.status === "delivered")
        .forEach((o) => {
          const isSim = !!o.isSimulated;
          const st = isSim ? "simulated" : "realized";
          if (!matchesData(st)) return;
          if (isSim) simulatedCount += 1;
          else realizedCount += 1;
          totalInflowCents += o.totalCents;
          rows.push({
            id: `in-${o.id}`,
            dateOrKey: day(o.createdAt) || "-",
            isoDate: day(o.createdAt) || undefined,
            title: f.text("cashIn"),
            category: f.text("posSales"),
            locationName: storeOf(o.locationId),
            typeKind: "inflow",
            amountCents: o.totalCents,
            formattedAmount: `+${f.money(o.totalCents)}`,
            statusBadge: isSim ? f.text("simulated") : f.text("realized"),
          });
        });
    }
    expenses
      .filter((e) => e.status === "paid" && !e.isSimulation)
      .forEach((e) => {
        if (!matchesData("realized")) return;
        realizedCount += 1;
        totalOutflowCents += e.amountCents;
        const date = e.paidAt ? day(e.paidAt) : e.dueDate;
        rows.push({
          id: `out-${e.id}`,
          dateOrKey: date,
          isoDate: date,
          title: f.text("cashOut", { description: e.description }),
          category: f.category(e.category),
          locationName: storeOf(e.locationId),
          typeKind: "outflow",
          amountCents: e.amountCents,
          formattedAmount: `-${f.money(e.amountCents)}`,
          statusBadge: f.status("paid"),
        });
      });
  } else if (filters.reportType === "payables_receivables") {
    expenses.forEach((e) => {
      if (e.isSimulation) return;
      if (e.status !== "overdue" && e.status !== "pending") return;
      if (!matchesData("projected")) return;
      projectedCount += 1;
      totalOutflowCents += e.amountCents;
      rows.push({
        id: e.id,
        dateOrKey: e.dueDate,
        isoDate: e.dueDate,
        title: f.text("payable", { description: e.description }),
        category: f.category(e.category),
        locationName: storeOf(e.locationId),
        typeKind: "outflow",
        amountCents: e.amountCents,
        formattedAmount: `-${f.money(e.amountCents)}`,
        statusBadge: f.status(e.status),
        notes: e.supplierName,
      });
    });
  } else if (filters.reportType === "cogs_margins") {
    stores.forEach((s) => {
      if (!matchesData("realized")) return;
      realizedCount += 1;
      totalInflowCents += s.revenueCents;
      totalOutflowCents += s.cogsCents;
      rows.push({
        id: `cogs-${s.locationId}`,
        dateOrKey: "-",
        title: s.locationName,
        category:
          s.grossMargin === null
            ? f.text("marginUnavailable")
            : f.text("grossMargin", { margin: f.percent(s.grossMargin) }),
        locationName: s.locationName,
        typeKind: "metric",
        amountCents: s.grossProfitCents,
        formattedAmount: f.money(s.grossProfitCents),
        statusBadge: s.hasData ? f.text("realized") : f.text("noData"),
        notes: f.text("storeCogs", {
          revenue: f.money(s.revenueCents),
          cogs: f.money(s.cogsCents),
        }),
      });
    });
  } else if (filters.reportType === "store_performance") {
    stores.forEach((s) => {
      if (!matchesData("realized")) return;
      realizedCount += 1;
      totalInflowCents += s.revenueCents;
      totalOutflowCents += s.cogsCents + s.expensesCents;
      rows.push({
        id: s.locationId,
        dateOrKey: "-",
        title: s.locationName,
        category:
          s.grossMargin === null
            ? f.text("marginUnavailable")
            : f.text("grossMargin", { margin: f.percent(s.grossMargin) }),
        locationName: s.locationName,
        typeKind: "metric",
        amountCents: s.resultCents,
        formattedAmount: f.money(s.resultCents),
        statusBadge: !s.hasData
          ? f.text("noData")
          : s.resultCents >= 0
            ? f.text("profitable")
            : f.text("loss"),
        notes: f.text("storeRow", {
          revenue: f.money(s.revenueCents),
          cogs: f.money(s.cogsCents),
          expenses: f.money(s.expensesCents),
        }),
      });
    });
  } else {
    // Only months that actually have records — never synthesized history.
    (options.monthlyTrend ?? []).forEach((tr) => {
      if (!matchesData("realized")) return;
      realizedCount += 1;
      totalInflowCents += tr.revenueCents;
      totalOutflowCents += tr.cogsCents + tr.expensesCents;
      rows.push({
        id: `trend-${tr.month}`,
        dateOrKey: tr.month,
        title: f.text("monthlyTrend"),
        category: tr.month,
        locationName,
        typeKind: "metric",
        amountCents: tr.resultCents,
        formattedAmount: f.money(tr.resultCents),
        statusBadge: tr.resultCents >= 0 ? f.text("profitable") : f.text("loss"),
        notes: f.text("monthRow", {
          revenue: f.money(tr.revenueCents),
          cogs: f.money(tr.cogsCents),
          expenses: f.money(tr.expensesCents),
        }),
      });
    });
  }

  const headings: ReportHeadings = {
    restaurant: f.text("restaurant"),
    location: f.text("location"),
    report: f.text("report"),
    period: f.text("period"),
    generatedAt: f.text("generatedAt"),
    currency: f.text("currency"),
    colDate: f.text("colDate"),
    colTitle: f.text("colTitle"),
    colCategory: f.text("colCategory"),
    colLocation: f.text("colLocation"),
    colKind: f.text("colKind"),
    colAmount: f.text("colAmount"),
    colStatus: f.text("colStatus"),
    colNotes: f.text("colNotes"),
    sheetName: f.text("sheetName"),
  };

  return {
    title: f.text(`title_${filters.reportType}`),
    reportType: filters.reportType,
    generatedAt,
    restaurantName,
    locationName,
    periodLabel,
    currency: "USD",
    totalInflowCents,
    totalOutflowCents,
    netBalanceCents: totalInflowCents - totalOutflowCents,
    realizedCount,
    projectedCount,
    simulatedCount,
    rows,
    headings,
  };
}

function csvCell(v: string) {
  return `"${v.replace(/"/g, '""')}"`;
}

export function exportReportToCsv(report: FinancialReportResult): string {
  const h = report.headings;
  const headers = [
    "ID",
    h.colDate,
    h.colTitle,
    h.colCategory,
    h.colLocation,
    h.colKind,
    h.colAmount,
    h.colStatus,
    h.colNotes,
  ].map(csvCell);
  const lines: string[] = [
    `# ${h.restaurant}: ${report.restaurantName}`,
    `# ${h.location}: ${report.locationName}`,
    `# ${h.report}: ${report.title}`,
    `# ${h.period}: ${report.periodLabel}`,
    `# ${h.generatedAt}: ${report.generatedAt}`,
    `# ${h.currency}: USD`,
    headers.join(","),
  ];

  for (const r of report.rows) {
    lines.push(
      [
        r.id,
        r.dateOrKey,
        csvCell(r.title || ""),
        csvCell(r.category || ""),
        csvCell(r.locationName || ""),
        r.typeKind,
        (r.amountCents / 100).toFixed(2),
        csvCell(r.statusBadge),
        csvCell(r.notes || ""),
      ].join(","),
    );
  }

  return lines.join("\r\n");
}

export function exportReportToXmlSpreadsheet(report: FinancialReportResult): string {
  const h = report.headings;
  const rowsXml = report.rows
    .map(
      (r) => `<Row>
        <Cell><Data ss:Type="String">${escapeXml(r.dateOrKey)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(r.title)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(r.category)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(r.locationName)}</Data></Cell>
        <Cell><Data ss:Type="Number">${(r.amountCents / 100).toFixed(2)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(r.statusBadge)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(r.notes || "")}</Data></Cell>
      </Row>`,
    )
    .join("\n");

  return `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:o="urn:schemas-microsoft-com:office:office"
 xmlns:x="urn:schemas-microsoft-com:office:excel"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:html="http://www.w3.org/TR/REC-html40">
 <DocumentProperties xmlns="urn:schemas-microsoft-com:office:office">
  <Title>${escapeXml(report.title)}</Title>
  <Author>${escapeXml(report.restaurantName)}</Author>
  <Created>${report.generatedAt}</Created>
 </DocumentProperties>
 <Styles>
  <Style ss:ID="Default" ss:Name="Normal">
   <Alignment ss:Vertical="Bottom"/>
  </Style>
  <Style ss:ID="Header">
   <Font ss:Bold="1"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="${escapeXml(h.sheetName)}">
  <Table>
   <Row>
    <Cell><Data ss:Type="String">${escapeXml(`${h.restaurant}: ${report.restaurantName}`)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(`${h.location}: ${report.locationName}`)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(`${h.period}: ${report.periodLabel}`)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(`${h.generatedAt}: ${report.generatedAt}`)}</Data></Cell>
   </Row>
   <Row ss:StyleID="Header">
    <Cell><Data ss:Type="String">${escapeXml(h.colDate)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(h.colTitle)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(h.colCategory)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(h.colLocation)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(h.colAmount)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(h.colStatus)}</Data></Cell>
    <Cell><Data ss:Type="String">${escapeXml(h.colNotes)}</Data></Cell>
   </Row>
   ${rowsXml}
  </Table>
 </Worksheet>
</Workbook>`;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function triggerFileDownload(filename: string, content: string, mimeType: string) {
  if (typeof window === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
