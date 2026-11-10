import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Badge } from "@/components/ui/badge";
import { monthlyTrend, type LedgerEntry } from "@/components/finance/finance-model";
import type { Expense } from "@/lib/finance-service";
import type { Resources } from "@/lib/operational-mappers";
import { recordedIntelligence } from "@/lib/operational-metrics";
import { dayKey, expensesInPeriod } from "@/lib/report-metrics";

const DAY = 86_400_000;
const NOW = Date.parse("2026-11-09T15:00:00Z");

function resources(
  finance: Array<Partial<Resources["finance"][number]>>,
  expenses: Array<Record<string, unknown>>,
): Resources {
  return {
    finance: finance.map((f, i) => ({ id: `f${i}`, order_id: null, ...f })),
    expenses: expenses.map((payload, i) => ({ id: `e${i}`, payload })),
    inventory: [],
    recipes: [],
  } as unknown as Resources;
}

describe("Intelligence net result compares the same period", () => {
  const r = resources(
    [
      { kind: "revenue", amount_cents: 100_000, created_at: new Date(NOW - 2 * DAY).toISOString() },
      { kind: "cogs", amount_cents: 20_000, created_at: new Date(NOW - 2 * DAY).toISOString() },
      // outside a 7-day window
      {
        kind: "revenue",
        amount_cents: 500_000,
        created_at: new Date(NOW - 20 * DAY).toISOString(),
      },
    ],
    [
      { amountCents: 30_000, competencyDate: "2026-11-05", dueDate: "2026-11-10" }, // inside 7d
      { amountCents: 900_000, competencyDate: "2026-10-01", dueDate: "2026-10-05" }, // only in 90d
      { amountCents: 70_000, competencyDate: "2026-11-06", isSimulation: true }, // never counted
      { amountCents: 5_000, dueDate: "2026-11-08" }, // legacy row without competency: due date
    ],
  );

  it("7 days: only ledger and expenses inside the window", () => {
    const s = recordedIntelligence(r, 7, "America/New_York", NOW);
    expect(s.grossRevenueCents).toBe(100_000);
    expect(s.operatingExpensesCents).toBe(35_000);
    expect(s.netRevenueCents).toBe(100_000 - 20_000 - 35_000);
  });

  it("90 days: the October expense and the older sale are both in range", () => {
    const s = recordedIntelligence(r, 90, "America/New_York", NOW);
    expect(s.grossRevenueCents).toBe(600_000);
    expect(s.operatingExpensesCents).toBe(935_000);
  });

  it("uses the same competency rule as Reports", () => {
    const since = dayKey(new Date(NOW - 7 * DAY).toISOString(), "America/New_York");
    const today = dayKey(new Date(NOW).toISOString(), "America/New_York");
    expect(
      expensesInPeriod(
        [
          { competencyDate: "2026-11-05", amountCents: 30_000, isSimulation: false },
          { competencyDate: "2026-11-08", amountCents: 5_000, isSimulation: false },
        ],
        since,
        today,
      ),
    ).toBe(recordedIntelligence(r, 7, "America/New_York", NOW).operatingExpensesCents);
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
