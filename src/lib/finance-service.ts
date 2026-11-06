import {
  assertTenantContext,
  isLocationAllowed,
  readTenantRecords,
  TenantContextError,
  writeTenantRecords,
} from "./tenant-storage";
export type ExpenseRecurrence = "fixed" | "variable" | "recurring";
export type ExpenseStatus = "pending" | "paid" | "overdue";
export type ExpenseCategory =
  | "suppliers"
  | "taxes"
  | "rent"
  | "payroll"
  | "utilities"
  | "ingredients"
  | "maintenance"
  | "marketing"
  | "other";

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

export function buildCashFlowTimeline(
  expenses: Expense[],
  realSalesCents: number,
  granularity: CashFlowGranularity = "monthly",
  startingCashCents = 1500000,
): CashFlowTimeline {
  let runningBalance = startingCashCents;
  const bucketLabels =
    granularity === "daily"
      ? ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
      : granularity === "weekly"
        ? ["Week 1", "Week 2", "Week 3", "Week 4"]
        : ["May", "Jun", "Jul", "Aug", "Sep", "Oct"];

  const stepFactor = 1 / bucketLabels.length;
  const buckets: CashFlowBucket[] = bucketLabels.map((lbl, idx) => {
    const initial = runningBalance;
    const inflow = Math.round(realSalesCents * stepFactor * (0.85 + (idx % 3) * 0.15));
    const paidExpensesTotal = expenses
      .filter((e) => e.status === "paid")
      .reduce((s, e) => s + e.amountCents, 0);
    const outflow = Math.round(paidExpensesTotal * stepFactor * (0.9 + ((idx + 1) % 2) * 0.12));
    const net = inflow - outflow;
    const final = initial + net;
    runningBalance = final;

    return {
      label: lbl,
      initialBalanceCents: initial,
      inflowCents: inflow,
      outflowCents: outflow,
      netCents: net,
      finalBalanceCents: final,
      entriesCount: Math.max(1, Math.round(expenses.length * stepFactor)),
    };
  });

  const totalInflow = buckets.reduce((acc, b) => acc + b.inflowCents, 0);
  const totalOutflow = buckets.reduce((acc, b) => acc + b.outflowCents, 0);

  return {
    granularity,
    buckets,
    totalInflowCents: totalInflow,
    totalOutflowCents: totalOutflow,
    netOperatingCents: totalInflow - totalOutflow,
    initialOpeningCents: startingCashCents,
    closingCashCents: runningBalance,
  };
}

export function generateMonthlyTrend(
  currentExpensesCents: number,
  currentRevenueCents: number,
): MonthlyTrend[] {
  const months = ["May", "Jun", "Jul", "Aug", "Sep", "Oct"];
  const factors = [0.85, 0.9, 0.96, 1.02, 0.98, 1.0];

  return months.map((m, idx) => {
    const factor = factors[idx] ?? 1.0;
    const rev = Math.round(currentRevenueCents * factor);
    const exp = Math.round(currentExpensesCents * (factor * 0.95));
    return {
      month: m,
      revenueCents: rev,
      expensesCents: exp,
      netProfitCents: rev - exp,
    };
  });
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
  dateOrKey: string;
  title: string;
  category: string;
  locationName: string;
  typeKind: "inflow" | "outflow" | "metric" | "neutral";
  amountCents: number;
  formattedAmount: string;
  statusBadge: string;
  notes?: string | undefined;
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
  productMargins?: ProductMarginMetric[];
  storeComparisons?: StoreFinancialComparison[];
}): FinancialReportResult {
  const {
    filters,
    restaurantName,
    locationName,
    expenses,
    orders,
    productMargins = [],
    storeComparisons = [],
  } = options;
  const generatedAt = new Date().toISOString();
  const periodLabel =
    filters.startDate && filters.endDate
      ? `${filters.startDate} - ${filters.endDate}`
      : "Year-To-Date (Current Cycle)";

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

  if (filters.reportType === "revenue") {
    orders.forEach((ord) => {
      const isSim = !!ord.isSimulated;
      const st: "realized" | "simulated" = isSim ? "simulated" : "realized";
      if (!matchesData(st)) return;
      if (isSim) simulatedCount += 1;
      else realizedCount += 1;
      totalInflowCents += ord.totalCents;
      rows.push({
        id: ord.id,
        dateOrKey: ord.createdAt ? ord.createdAt.split("T")[0] || "-" : "-",
        title: `Order #${ord.id.slice(0, 8)}`,
        category: "POS / Dining Sales",
        locationName,
        typeKind: "inflow",
        amountCents: ord.totalCents,
        formattedAmount: formatUsd(ord.totalCents),
        statusBadge: isSim ? "Simulated" : ord.status,
        notes: ord.discountCents ? `Discount: ${formatUsd(ord.discountCents)}` : undefined,
      });
    });
  } else if (filters.reportType === "expenses") {
    expenses.forEach((exp) => {
      if (filters.category && filters.category !== "all" && exp.category !== filters.category)
        return;
      const st: "realized" | "projected" = exp.status === "paid" ? "realized" : "projected";
      if (!matchesData(st)) return;
      if (st === "realized") realizedCount += 1;
      else projectedCount += 1;
      totalOutflowCents += exp.amountCents;
      rows.push({
        id: exp.id,
        dateOrKey: exp.dueDate,
        title: exp.description,
        category: exp.category,
        locationName,
        typeKind: "outflow",
        amountCents: exp.amountCents,
        formattedAmount: `-${formatUsd(exp.amountCents)}`,
        statusBadge: exp.status,
        notes: exp.supplierName ? `Supplier: ${exp.supplierName}` : undefined,
      });
    });
  } else if (filters.reportType === "cash_flow") {
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
          dateOrKey: o.createdAt.split("T")[0] || "-",
          title: `Cash Inflow (Order #${o.id.slice(0, 6)})`,
          category: "Sales Revenue",
          locationName,
          typeKind: "inflow",
          amountCents: o.totalCents,
          formattedAmount: `+${formatUsd(o.totalCents)}`,
          statusBadge: isSim ? "Simulated" : "Realized",
        });
      });
    expenses
      .filter((e) => e.status === "paid")
      .forEach((e) => {
        if (!matchesData("realized")) return;
        realizedCount += 1;
        totalOutflowCents += e.amountCents;
        rows.push({
          id: `out-${e.id}`,
          dateOrKey: e.paidAt ? e.paidAt.split("T")[0] || e.dueDate : e.dueDate,
          title: `Cash Outflow: ${e.description}`,
          category: e.category,
          locationName,
          typeKind: "outflow",
          amountCents: e.amountCents,
          formattedAmount: `-${formatUsd(e.amountCents)}`,
          statusBadge: "Paid",
        });
      });
  } else if (filters.reportType === "payables_receivables") {
    expenses.forEach((e) => {
      const isOverdue = e.status === "overdue";
      const isPending = e.status === "pending";
      if (!isOverdue && !isPending) return;
      projectedCount += 1;
      totalOutflowCents += e.amountCents;
      rows.push({
        id: e.id,
        dateOrKey: e.dueDate,
        title: `Payable: ${e.description}`,
        category: e.category,
        locationName,
        typeKind: "outflow",
        amountCents: e.amountCents,
        formattedAmount: `-${formatUsd(e.amountCents)}`,
        statusBadge: e.status,
        notes: e.supplierName,
      });
    });
  } else if (filters.reportType === "cogs_margins") {
    productMargins.forEach((pm) => {
      realizedCount += 1;
      totalInflowCents += pm.revenueCents;
      totalOutflowCents += pm.cogsCents;
      rows.push({
        id: pm.productId,
        dateOrKey: pm.category,
        title: pm.productName,
        category: `${pm.unitsSold} units · ${pm.grossMarginPct.toFixed(1)}% margin`,
        locationName,
        typeKind: "metric",
        amountCents: pm.grossProfitCents,
        formattedAmount: formatUsd(pm.grossProfitCents),
        statusBadge: pm.hasHighCostAlert ? "High Cost" : "Healthy",
        notes: `Rev: ${formatUsd(pm.revenueCents)} | COGS: ${formatUsd(pm.cogsCents)}`,
      });
    });
  } else if (filters.reportType === "store_performance") {
    storeComparisons.forEach((s) => {
      if (s.status === "simulated") simulatedCount += 1;
      else realizedCount += 1;
      totalInflowCents += s.grossRevenueCents;
      totalOutflowCents += s.operatingExpensesCents;
      rows.push({
        id: s.locationId,
        dateOrKey: `#${s.netProfitRank} in Profit`,
        title: s.locationName,
        category: `${s.orderCount} orders · Ticket: ${formatUsd(s.averageTicketCents)}`,
        locationName: s.locationName,
        typeKind: "metric",
        amountCents: s.estimatedNetProfitCents,
        formattedAmount: formatUsd(s.estimatedNetProfitCents),
        statusBadge: s.status,
        notes: `Rev: ${formatUsd(s.grossRevenueCents)} | Margin: ${s.netMarginPct.toFixed(1)}%`,
      });
    });
  } else {
    const trends = generateMonthlyTrend(totalOutflowCents || 2500000, totalInflowCents || 4200000);
    trends.forEach((tr, i) => {
      realizedCount += 1;
      totalInflowCents += tr.revenueCents;
      totalOutflowCents += tr.expensesCents;
      rows.push({
        id: `trend-${i}`,
        dateOrKey: tr.month,
        title: `Financial Performance ${tr.month}`,
        category: "Monthly Trend",
        locationName,
        typeKind: "metric",
        amountCents: tr.netProfitCents,
        formattedAmount: formatUsd(tr.netProfitCents),
        statusBadge: tr.netProfitCents >= 0 ? "Profitable" : "Loss",
        notes: `Rev: ${formatUsd(tr.revenueCents)} | Exp: ${formatUsd(tr.expensesCents)}`,
      });
    });
  }

  const reportTitles: Record<FinancialReportType, string> = {
    revenue: "Revenue & Sales Breakdown",
    expenses: "Operating Expenses Detail",
    cash_flow: "Cash Flow Activity Statement",
    payables_receivables: "Accounts Payable & Obligations",
    cogs_margins: "COGS & Product Profitability Margin",
    store_performance: "Multi-Store Financial Performance",
    monthly_trends: "Historical Monthly Trends & Variance",
  };

  return {
    title: reportTitles[filters.reportType] || "Executive Financial Report",
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
  };
}

export function exportReportToCsv(report: FinancialReportResult): string {
  const headers = [
    "ID",
    "Date/Key",
    "Title",
    "Category",
    "Location",
    "Kind",
    "Amount_USD",
    "Status",
    "Notes",
  ];
  const lines: string[] = [
    `# Restaurant: ${report.restaurantName}`,
    `# Location: ${report.locationName}`,
    `# Report: ${report.title}`,
    `# Period: ${report.periodLabel}`,
    `# Generated At: ${report.generatedAt}`,
    `# Currency: USD`,
    headers.join(","),
  ];

  for (const r of report.rows) {
    const safeTitle = `"${(r.title || "").replace(/"/g, '""')}"`;
    const safeCategory = `"${(r.category || "").replace(/"/g, '""')}"`;
    const safeLocation = `"${(r.locationName || "").replace(/"/g, '""')}"`;
    const safeNotes = `"${(r.notes || "").replace(/"/g, '""')}"`;
    const amountNum = (r.amountCents / 100).toFixed(2);

    lines.push(
      [
        r.id,
        r.dateOrKey,
        safeTitle,
        safeCategory,
        safeLocation,
        r.typeKind,
        amountNum,
        r.statusBadge,
        safeNotes,
      ].join(","),
    );
  }

  return lines.join("\r\n");
}

export function exportReportToXmlSpreadsheet(report: FinancialReportResult): string {
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
   <Font ss:Bold="1" ss:Color="#FFFFFF"/>
   <Interior ss:Color="#0F172A" ss:Pattern="Solid"/>
  </Style>
 </Styles>
 <Worksheet ss:Name="Financial Report">
  <Table>
   <Row>
    <Cell><Data ss:Type="String">Restaurant: ${escapeXml(report.restaurantName)}</Data></Cell>
    <Cell><Data ss:Type="String">Location: ${escapeXml(report.locationName)}</Data></Cell>
    <Cell><Data ss:Type="String">Period: ${escapeXml(report.periodLabel)}</Data></Cell>
    <Cell><Data ss:Type="String">Generated: ${report.generatedAt}</Data></Cell>
   </Row>
   <Row ss:StyleID="Header">
    <Cell><Data ss:Type="String">Date / Key</Data></Cell>
    <Cell><Data ss:Type="String">Description</Data></Cell>
    <Cell><Data ss:Type="String">Category</Data></Cell>
    <Cell><Data ss:Type="String">Location</Data></Cell>
    <Cell><Data ss:Type="String">Amount (USD)</Data></Cell>
    <Cell><Data ss:Type="String">Status</Data></Cell>
    <Cell><Data ss:Type="String">Notes</Data></Cell>
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
