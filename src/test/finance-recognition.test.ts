import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isRecognizedInPeriod, recognizedExpenses, expensesInPeriod } from "@/lib/period-metrics";
import { summarizeExpenses } from "@/lib/expense-metrics";
import {
  financePeriodStart,
  initialFormValues,
  ledgerInPeriod,
  monthlyTrend,
  pnlExpenseGroups,
  type LedgerEntry,
} from "@/components/finance/finance-model";
import type { Expense, ExpenseCategory } from "@/lib/finance-service";

// Recognition rule (owner decision, Phase 0): an expense counts in a period only when its
// competency date falls inside the period AND has already arrived. Future bills are never
// anticipated; revenue and expenses always cover the same days.

const TODAY = "2026-11-16";

function exp(over: Partial<Expense> & { category?: ExpenseCategory }): Expense {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    orgId: "org-test",
    locationId: "downtown",
    category: "rent",
    recurrence: "fixed",
    status: "pending",
    description: "x",
    amountCents: 100_00,
    currency: "usd",
    dueDate: over.competencyDate ?? TODAY,
    competencyDate: TODAY,
    responsiblePerson: "Owner",
    isSimulation: false,
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    ...over,
  };
}

function entry(day: string, kind: string, amount: number): LedgerEntry {
  return {
    id: `${day}-${kind}`,
    location_id: "L1",
    kind,
    amount_cents: amount,
    created_at: `${day}T15:00:00.000Z`,
  } as unknown as LedgerEntry;
}

describe("expense recognition", () => {
  const rent = exp({ category: "rent", amountCents: 6500_00, competencyDate: "2026-11-01" });
  const payroll1 = exp({ category: "payroll", amountCents: 4750_00, competencyDate: "2026-11-14" });
  const payroll2 = exp({ category: "payroll", amountCents: 4750_00, competencyDate: "2026-11-28" });
  const october = exp({ category: "energy", amountCents: 980_00, competencyDate: "2026-10-10" });
  const simulated = exp({
    amountCents: 9_999_00,
    competencyDate: "2026-11-02",
    isSimulation: true,
  });
  const all = [rent, payroll1, payroll2, october, simulated];

  it("never anticipates a bill whose competency date has not arrived", () => {
    expect(isRecognizedInPeriod(payroll2, "2026-11-01", TODAY)).toBe(false);
    expect(isRecognizedInPeriod(payroll1, "2026-11-01", TODAY)).toBe(true);
    expect(expensesInPeriod(all, "2026-11-01", TODAY)).toBe(6500_00 + 4750_00);
  });

  it("excludes simulations and anything before the period", () => {
    expect(recognizedExpenses(all, "2026-11-01", TODAY).map((e) => e.amountCents)).toEqual([
      6500_00, 4750_00,
    ]);
    expect(isRecognizedInPeriod(october, "2026-11-01", TODAY)).toBe(false);
    expect(isRecognizedInPeriod(october, null, TODAY)).toBe(true); // "all recorded data"
    expect(isRecognizedInPeriod(simulated, null, TODAY)).toBe(false);
  });

  it("the second payroll is recognized once its day arrives", () => {
    expect(isRecognizedInPeriod(payroll2, "2026-11-01", "2026-11-28")).toBe(true);
  });

  it("rejects a malformed competency date instead of guessing", () => {
    expect(isRecognizedInPeriod(exp({ competencyDate: "2026-11" }), null, TODAY)).toBe(false);
  });
});

describe("finance periods", () => {
  it("each period ends today and starts on the expected day", () => {
    expect(financePeriodStart("month", TODAY)).toBe("2026-11-01");
    expect(financePeriodStart("30d", TODAY)).toBe("2026-10-18");
    expect(financePeriodStart("90d", TODAY)).toBe("2026-08-19");
    expect(financePeriodStart("all", TODAY)).toBeNull();
  });

  it("revenue uses the same days as the expenses (store zone, inclusive bounds, no future rows)", () => {
    const rows = [
      entry("2026-10-31", "revenue", 100),
      entry("2026-11-01", "revenue", 200),
      entry(TODAY, "revenue", 300),
      entry("2026-11-17", "revenue", 999),
    ];
    const inMonth = ledgerInPeriod(rows, "2026-11-01", TODAY, "America/New_York");
    expect(inMonth.map((r) => r.amount_cents)).toEqual([200, 300]);
    expect(ledgerInPeriod(rows, null, TODAY, "America/New_York")).toHaveLength(3);
  });
});

describe("monthly trend", () => {
  it("leaves out expenses whose competency date is after today", () => {
    const expenses = [
      exp({ amountCents: 1000, competencyDate: "2026-11-01" }),
      exp({ amountCents: 5000, competencyDate: "2026-11-28" }),
    ];
    const nov = monthlyTrend([], expenses, "2026-11", "America/New_York", TODAY).find(
      (m) => m.month === "2026-11",
    );
    expect(nov?.expensesCents).toBe(1000);
    // Without `today` the previous behavior (whole competency month) is unchanged for other callers.
    expect(
      monthlyTrend([], expenses, "2026-11").find((m) => m.month === "2026-11")?.expensesCents,
    ).toBe(6000);
  });
});

describe("P&L grouping", () => {
  it("lists every category once, under its own parent", () => {
    const summary = summarizeExpenses(
      [
        exp({ category: "payroll", amountCents: 5780_000, competencyDate: "2026-11-14" }),
        exp({ category: "benefits", amountCents: 100_00, competencyDate: "2026-11-14" }),
        exp({ category: "rent", amountCents: 4300_000, competencyDate: "2026-11-01" }),
        exp({ category: "energy", amountCents: 582_000, competencyDate: "2026-11-10" }),
      ],
      TODAY,
    );
    const g = pnlExpenseGroups(summary);
    expect(g.personnel.map((c) => c.category).sort()).toEqual(["benefits", "payroll"]);
    expect(g.operating.map((c) => c.category).sort()).toEqual(["energy", "rent"]);
    const sum = (rows: { cents: number }[]) => rows.reduce((s, r) => s + r.cents, 0);
    expect(sum(g.personnel)).toBe(summary.personnelCents);
    expect(sum(g.operating)).toBe(summary.operatingCents);
    expect(sum(g.personnel) + sum(g.operating)).toBe(summary.totalCents);
  });
});

describe("expense form", () => {
  it("defaults the competency date to the due date and keeps a stored one when editing", () => {
    const fresh = initialFormValues(null, {
      locationId: "d",
      dueDate: TODAY,
      responsiblePerson: "",
    });
    expect(fresh.competencyDate).toBe(TODAY);
    const edited = initialFormValues(exp({ competencyDate: "2026-11-01", dueDate: "2026-11-05" }), {
      locationId: "d",
      dueDate: TODAY,
      responsiblePerson: "",
    });
    expect(edited.competencyDate).toBe("2026-11-01");
  });
});

describe("the Overview never anticipates costs either", () => {
  it("its cost breakdown uses the costs recognized this month, like the month-to-date result", () => {
    const src = readFileSync(resolve(__dirname, "../components/app/recorded-overview.tsx"), "utf8");
    // Wave 0: one recognized set (each store's own month) feeds both the result and the breakdown.
    expect(src).toMatch(/const monthRecognized = recognizedInStoreWindows\(mapped\.expenses,/);
    expect(src).toMatch(/monthCosts: summarizeExpenses\(monthRecognized, today\)/);
    expect(src).toMatch(/const monthExpenses = monthRecognized\.reduce\(/);
    expect(src).toContain("view.monthCosts.personnelCents");
    expect(src).toContain("view.monthCosts.operatingCents");
    expect(src).not.toContain("view.expenses.personnelCents");
  });
});
