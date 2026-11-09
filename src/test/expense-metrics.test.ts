import { describe, expect, it } from "vitest";
import {
  cashOutForecast,
  effectiveStatus,
  financialResult,
  summarizeExpenses,
} from "@/lib/expense-metrics";
import type { Expense } from "@/lib/finance-service";

const base: Omit<Expense, "id" | "category" | "status" | "amountCents" | "dueDate"> = {
  orgId: "org",
  locationId: "loc-a",
  recurrence: "fixed",
  description: "x",
  competencyDate: "2026-11-01",
  responsiblePerson: "owner",
  currency: "usd",
  isSimulation: false,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
};
const e = (
  over: Partial<Expense> & Pick<Expense, "id" | "category" | "status" | "amountCents" | "dueDate">,
): Expense => ({
  ...base,
  ...over,
});

describe("expense metrics", () => {
  const today = "2026-11-08";
  const list: Expense[] = [
    e({ id: "1", category: "rent", status: "paid", amountCents: 100_00, dueDate: "2026-11-01" }),
    e({ id: "2", category: "payroll", status: "paid", amountCents: 300_00, dueDate: "2026-11-07" }),
    e({
      id: "3",
      category: "benefits",
      status: "pending",
      amountCents: 50_00,
      dueDate: "2026-11-10",
    }),
    e({
      id: "4",
      category: "energy",
      status: "pending",
      amountCents: 40_00,
      dueDate: "2026-11-05",
      locationId: "loc-b",
    }),
    e({ id: "5", category: "water", status: "pending", amountCents: 20_00, dueDate: "2026-12-30" }),
    e({
      id: "6",
      category: "marketing",
      status: "paid",
      amountCents: 999_00,
      dueDate: "2026-11-01",
      isSimulation: true,
    }),
  ];

  it("treats a pending bill past its due date as overdue", () => {
    expect(effectiveStatus(list[3]!, today)).toBe("overdue");
    expect(effectiveStatus(list[2]!, today)).toBe("pending");
    expect(effectiveStatus(list[0]!, today)).toBe("paid");
  });

  it("summarizes totals, personnel and excludes simulations", () => {
    const s = summarizeExpenses(list, today);
    expect(s.totalCents).toBe(510_00);
    expect(s.paidCents).toBe(400_00);
    expect(s.pendingCents).toBe(70_00);
    expect(s.overdueCents).toBe(40_00);
    expect(s.dueNext7DaysCents).toBe(50_00);
    expect(s.personnelCents).toBe(350_00);
    expect(s.operatingCents).toBe(160_00);
    expect(s.counts).toEqual({ paid: 2, pending: 2, overdue: 1 });
    expect(s.byLocation.find((l) => l.locationId === "loc-b")?.cents).toBe(40_00);
  });

  it("subtracts COGS before expenses in the financial result", () => {
    const r = financialResult({ revenueCents: 1000_00, cogsCents: 200_00, expensesCents: 300_00 });
    expect(r.grossProfitCents).toBe(800_00);
    expect(r.resultCents).toBe(500_00);
    expect(r.cogsRate).toBeCloseTo(0.2);
    expect(
      financialResult({ revenueCents: 0, cogsCents: 0, expensesCents: 10 }).grossMargin,
    ).toBeNull();
  });

  it("forecasts unpaid cash out per week, overdue in the first week", () => {
    const f = cashOutForecast(list, 4, today);
    expect(f[0]!.cents).toBe(90_00); // overdue energy + benefits due in 2 days
    expect(f.reduce((s, b) => s + b.cents, 0)).toBe(90_00); // water is beyond 4 weeks
  });
});
