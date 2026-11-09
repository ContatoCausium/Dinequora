import { describe, expect, it } from "vitest";
import {
  expensePayload,
  filterExpenses,
  groupExpenses,
  ledgerForLocation,
  markPaidPayload,
  monthlyTrend,
  nextMonth,
  overdueBills,
  parseAmountToCents,
  sortExpenses,
  storeResults,
  upcomingBills,
  withEffectiveStatus,
  type LedgerEntry,
} from "@/components/finance/finance-model";
import { generateFinancialReport, type Expense } from "@/lib/finance-service";

const today = "2026-11-08";
const stores = [
  { id: "downtown", name: "Downtown", dbId: "uuid-a" },
  { id: "harbor", name: "Harbor", dbId: "uuid-b" },
];

const exp = (over: Partial<Expense> & Pick<Expense, "id">): Expense => ({
  orgId: "org",
  locationId: "downtown",
  category: "rent",
  recurrence: "fixed",
  status: "pending",
  description: "Bill",
  amountCents: 100_00,
  currency: "usd",
  dueDate: "2026-11-15",
  competencyDate: "2026-11-01",
  responsiblePerson: "Owner",
  isSimulation: false,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
  ...over,
});

const entry = (over: Partial<LedgerEntry> & Pick<LedgerEntry, "id" | "kind" | "amount_cents">) =>
  ({
    actor_id: "u",
    client_event_id: over.id,
    created_at: "2026-11-08T12:00:00Z",
    description: "",
    location_id: "uuid-a",
    order_id: null,
    org_id: "o",
    reverses_id: null,
    ...over,
  }) as LedgerEntry;

const ledger: LedgerEntry[] = [
  entry({ id: "r1", kind: "revenue", amount_cents: 2000_00 }),
  entry({ id: "c1", kind: "cogs", amount_cents: 500_00 }),
  entry({ id: "r2", kind: "revenue", amount_cents: 1000_00, location_id: "uuid-b" }),
  entry({ id: "rv", kind: "reversal_revenue", amount_cents: 100_00 }),
  // Stock purchases are not revenue, COGS or expenses.
  entry({ id: "p1", kind: "purchase", amount_cents: 9999_00 }),
  entry({ id: "old", kind: "revenue", amount_cents: 300_00, created_at: "2026-09-03T10:00:00Z" }),
];

const expenses: Expense[] = [
  exp({ id: "rent", amountCents: 3000_00, status: "paid", dueDate: "2026-11-01" }),
  exp({ id: "pay", category: "payroll", amountCents: 1500_00, dueDate: "2026-11-10" }),
  exp({ id: "late", category: "maintenance", amountCents: 200_00, dueDate: "2026-11-02" }),
  exp({
    id: "energy",
    category: "energy",
    locationId: "harbor",
    amountCents: 400_00,
    dueDate: "2026-11-20",
    supplierName: "City Power",
  }),
  exp({ id: "sim", amountCents: 7777_00, isSimulation: true }),
  exp({ id: "future", amountCents: 50_00, dueDate: "2026-12-05", competencyDate: "2026-12-01" }),
];

describe("finance model", () => {
  it("scopes ledger rows to the selected store", () => {
    expect(ledgerForLocation(ledger, stores, "all")).toHaveLength(ledger.length);
    expect(ledgerForLocation(ledger, stores, "harbor").map((e) => e.id)).toEqual(["r2"]);
    expect(ledgerForLocation(ledger, stores, "unknown")).toEqual([]);
  });

  it("builds the monthly trend only from recorded months, filling gaps with zeros", () => {
    const trend = monthlyTrend(ledger, expenses, "2026-11");
    expect(trend.map((p) => p.month)).toEqual(["2026-09", "2026-10", "2026-11"]);
    expect(trend[1]).toMatchObject({ revenueCents: 0, cogsCents: 0, expensesCents: 0 });
    const nov = trend[2]!;
    expect(nov.revenueCents).toBe(2900_00); // 2000 + 1000 - 100 reversal, purchase ignored
    expect(nov.cogsCents).toBe(500_00);
    // Simulation and future-month expenses are excluded.
    expect(nov.expensesCents).toBe(3000_00 + 1500_00 + 200_00 + 400_00);
    expect(nov.resultCents).toBe(2900_00 - 500_00 - 5100_00);
  });

  it("returns no trend when nothing was recorded", () => {
    expect(monthlyTrend([], [], "2026-11")).toEqual([]);
    expect(nextMonth("2026-12")).toBe("2027-01");
  });

  it("filters by effective status, category, store and search", () => {
    const base = {
      status: "all",
      category: "all",
      locationId: "all",
      recurrence: "all",
      search: "",
    } as const;
    expect(
      filterExpenses(expenses, { ...base, status: "overdue" }, today).map((e) => e.id),
    ).toEqual(["late"]);
    expect(
      filterExpenses(expenses, { ...base, locationId: "harbor" }, today).map((e) => e.id),
    ).toEqual(["energy"]);
    expect(
      filterExpenses(expenses, { ...base, search: "city power" }, today).map((e) => e.id),
    ).toEqual(["energy"]);
    expect(
      filterExpenses(expenses, { ...base, category: "payroll" }, today).map((e) => e.id),
    ).toEqual(["pay"]);
  });

  it("sorts overdue first, then pending by due date, then paid", () => {
    const ids = sortExpenses(
      expenses.filter((e) => !e.isSimulation),
      today,
    ).map((e) => e.id);
    expect(ids).toEqual(["late", "pay", "energy", "future", "rent"]);
  });

  it("groups by store and by category excluding simulations", () => {
    const byStore = groupExpenses(expenses, "store", today);
    expect(byStore.map((g) => g.key)).toEqual(["downtown", "harbor"]);
    expect(byStore[0]).toMatchObject({
      totalCents: 4750_00,
      openCents: 1750_00,
      overdueCents: 200_00,
      count: 4,
    });
    const byCat = groupExpenses(expenses, "category", today);
    expect(byCat[0]?.key).toBe("rent");
  });

  it("lists upcoming and overdue bills", () => {
    expect(upcomingBills(expenses, today, 14).map((e) => e.id)).toEqual(["pay", "energy"]);
    expect(overdueBills(expenses, today).map((e) => e.id)).toEqual(["late"]);
    expect(withEffectiveStatus(expenses, today).find((e) => e.id === "late")?.status).toBe(
      "overdue",
    );
  });

  it("computes per-store results with the shared definitions", () => {
    const [downtown, harbor] = storeResults(stores, ledger, expenses);
    expect(downtown).toMatchObject({
      revenueCents: 2200_00, // 2000 - 100 reversal + 300 (September)
      cogsCents: 500_00,
      grossProfitCents: 1700_00,
      expensesCents: 4750_00,
      personnelCents: 1500_00,
      resultCents: 1700_00 - 4750_00,
    });
    expect(harbor).toMatchObject({
      revenueCents: 1000_00,
      expensesCents: 400_00,
      resultCents: 600_00,
    });
  });

  it("builds a complete payload for updates and mark-as-paid", () => {
    const e = expenses.find((x) => x.id === "energy")!;
    const p = markPaidPayload(e, "2026-11-08T10:00:00.000Z");
    expect(p).toMatchObject({
      id: "energy",
      status: "paid",
      paidAt: "2026-11-08T10:00:00.000Z",
      amountCents: 400_00,
      category: "energy",
      supplierName: "City Power",
      competencyDate: "2026-11-01",
      isSimulation: false,
    });
    // paidAt is dropped when the bill is not paid.
    expect(expensePayload({ ...e, paidAt: "x" })).not.toHaveProperty("paidAt");
  });

  it("parses user-typed amounts in both decimal conventions", () => {
    expect(parseAmountToCents("1234.5")).toBe(123450);
    expect(parseAmountToCents("1,234.50")).toBe(123450);
    expect(parseAmountToCents("1.234,50")).toBe(123450);
    expect(parseAmountToCents("85,9")).toBe(8590);
    expect(parseAmountToCents("1,234")).toBe(123400);
    expect(parseAmountToCents("abc")).toBeNull();
    expect(parseAmountToCents("")).toBeNull();
  });

  it("never fabricates monthly-trend report rows", () => {
    const empty = generateFinancialReport({
      filters: { reportType: "monthly_trends", locationId: "all" },
      restaurantName: "R",
      locationName: "All",
      expenses: [],
      orders: [],
    });
    expect(empty.rows).toEqual([]);
    const withData = generateFinancialReport({
      filters: { reportType: "monthly_trends", locationId: "all" },
      restaurantName: "R",
      locationName: "All",
      expenses: [],
      orders: [],
      monthlyTrend: monthlyTrend(ledger, expenses, "2026-11"),
    });
    expect(withData.rows.map((r) => r.dateOrKey)).toEqual(["2026-09", "2026-10", "2026-11"]);
  });

  it("uses ledger revenue for the revenue report when provided", () => {
    const report = generateFinancialReport({
      filters: { reportType: "revenue", locationId: "all" },
      restaurantName: "R",
      locationName: "All",
      expenses: [],
      orders: [],
      ledger: ledger.map((e) => ({
        id: e.id,
        createdAt: e.created_at,
        kind: e.kind,
        amountCents: e.amount_cents,
        locationName: "Downtown",
      })),
    });
    expect(report.totalInflowCents).toBe(2000_00 + 1000_00 - 100_00 + 300_00);
    expect(report.rows.every((r) => r.isoDate)).toBe(true);
  });
});
