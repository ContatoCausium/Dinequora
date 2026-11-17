import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Badge } from "@/components/ui/badge";
import { monthlyTrend, type LedgerEntry } from "@/components/finance/finance-model";
import type { Expense } from "@/lib/finance-service";
import type { Resources } from "@/lib/operational-mappers";
import { rawExpensesInWindows, recordedIntelligence } from "@/lib/operational-metrics";
import { summaryFromRows, type LedgerRow } from "@/lib/ledger-reader";
import { PERIOD } from "@/lib/financial-period";
import { periodFigures, storeWindows } from "@/lib/financial-summary";
import { dayKey, expensesInPeriod } from "@/lib/report-metrics";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-09T15:00:00Z");
const STORE = { id: "store-db", timeZone: "America/New_York" };

function resources(expenses: Array<Record<string, unknown>>): Resources {
  return {
    expenses: expenses.map((payload, i) => ({ id: `e${i}`, location_id: STORE.id, payload })),
    inventory: [],
    recipes: [],
  } as unknown as Resources;
}
const row = (kind: string, amount: number, at: number, i: number): LedgerRow => ({
  id: `f${i}`,
  kind,
  amount_cents: amount,
  created_at: new Date(at).toISOString(),
  location_id: STORE.id,
  order_id: null,
});

describe("Intelligence net result compares the same period", () => {
  const ledgerRows = [
    row("revenue", 100_000, NOW - 2 * DAY, 0),
    row("cogs", 20_000, NOW - 2 * DAY, 1),
    // outside a 7-day window
    row("revenue", 500_000, NOW - 20 * DAY, 2),
  ];
  const r = resources([
    { amountCents: 30_000, competencyDate: "2026-11-05", dueDate: "2026-11-10" }, // inside 7d
    { amountCents: 900_000, competencyDate: "2026-10-01", dueDate: "2026-10-05" }, // only in 90d
    { amountCents: 70_000, competencyDate: "2026-11-06", isSimulation: true }, // never counted
    { amountCents: 5_000, dueDate: "2026-11-08" }, // legacy row without competency: due date
  ]);
  const insights = (days: number) => {
    const summary = summaryFromRows(ledgerRows, {
      stores: [STORE],
      days: days * 2,
      now: new Date(NOW),
    });
    const spec = PERIOD.days(days);
    return recordedIntelligence(
      r,
      periodFigures(summary, spec),
      rawExpensesInWindows(r.expenses, storeWindows(summary, spec)),
    );
  };

  it("7 days: only ledger and expenses inside the store's 7 local days", () => {
    const s = insights(7);
    expect(s.grossRevenueCents).toBe(100_000);
    expect(s.operatingExpensesCents).toBe(35_000);
    expect(s.netRevenueCents).toBe(100_000 - 20_000 - 35_000);
  });

  it("90 days: the October expense and the older sale are both in range", () => {
    const s = insights(90);
    expect(s.grossRevenueCents).toBe(600_000);
    expect(s.operatingExpensesCents).toBe(935_000);
  });

  it("uses the same competency rule as Reports (the store's 7 local days)", () => {
    const today = dayKey(new Date(NOW).toISOString(), "America/New_York");
    expect(
      expensesInPeriod(
        [
          { competencyDate: "2026-11-05", amountCents: 30_000, isSimulation: false },
          { competencyDate: "2026-11-08", amountCents: 5_000, isSimulation: false },
        ],
        "2026-11-03",
        today,
      ),
    ).toBe(insights(7).operatingExpensesCents);
  });
});

describe("Monthly trend places each sale in the store's local month", () => {
  // 02:00 UTC on Nov 1 is still Oct 31 in New York.
  const ledger = [
    { id: "a", kind: "revenue", amount_cents: 10_000, created_at: "2026-11-01T02:00:00Z" },
  ] as unknown as LedgerEntry[];
  const noExpenses: Expense[] = [];

  it("with the store zone the sale belongs to October", () => {
    const trend = monthlyTrend(ledger, noExpenses, "2026-11", "America/New_York");
    expect(trend.map((p) => [p.month, p.revenueCents])).toEqual([["2026-10", 10_000]]);
  });

  it("without a zone it keeps the previous UTC behaviour", () => {
    const trend = monthlyTrend(ledger, noExpenses, "2026-11");
    expect(trend.map((p) => [p.month, p.revenueCents])).toEqual([["2026-11", 10_000]]);
  });
});

describe("Badge", () => {
  it("renders inline (span), so it is valid inside paragraphs and headings", () => {
    const { container } = render(
      <p>
        Due soon <Badge>Overdue</Badge>
      </p>,
    );
    const badge = container.querySelector("p > span");
    expect(badge?.textContent).toBe("Overdue");
    expect(container.querySelector("p div")).toBeNull();
  });
});
