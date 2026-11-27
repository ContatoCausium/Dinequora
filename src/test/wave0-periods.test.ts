// Wave 0: store-local periods (four US zones, DST) and cross-module financial consistency.
import { describe, expect, it } from "vitest";
import {
  daysBetween,
  localDay,
  shiftDay,
  startOfLocalDay,
  zoneOffsetMinutes,
  zonedTimeToUtc,
} from "@/lib/store-time";
import { PERIOD, periodWindow, previousWindow, readSpanDays } from "@/lib/financial-period";
import { summaryFromRows, type LedgerRow } from "@/lib/ledger-reader";
import {
  bucketRows,
  bucketsInPeriod,
  dailyRevenue,
  figuresByStore,
  periodFigures,
  previousFigures,
  recognizedInStoreWindows,
  storeWindows,
  summaryRows,
} from "@/lib/financial-summary";
import { buildPreviousReport, buildReport, ordersReadSince } from "@/lib/report-metrics";
import { rawExpensesInWindows, recordedIntelligence } from "@/lib/operational-metrics";
import { monthlyTrend, storeResults } from "@/components/finance/finance-model";
import { financialResult } from "@/lib/expense-metrics";
import type { Resources } from "@/lib/operational-mappers";
import type { Expense } from "@/lib/finance-service";

const ZONES = {
  ny: "America/New_York",
  chi: "America/Chicago",
  la: "America/Los_Angeles",
  hnl: "Pacific/Honolulu",
} as const;

describe("store-time: local days and DST (US 2026: Mar 8 → Nov 1)", () => {
  it("offsets before/after the fall-back and in Honolulu (no DST)", () => {
    expect(zoneOffsetMinutes(new Date("2026-10-31T12:00:00Z"), ZONES.ny)).toBe(-240);
    expect(zoneOffsetMinutes(new Date("2026-11-02T12:00:00Z"), ZONES.ny)).toBe(-300);
    expect(zoneOffsetMinutes(new Date("2026-10-31T12:00:00Z"), ZONES.chi)).toBe(-300);
    expect(zoneOffsetMinutes(new Date("2026-11-02T12:00:00Z"), ZONES.la)).toBe(-480);
    expect(zoneOffsetMinutes(new Date("2026-07-01T12:00:00Z"), ZONES.hnl)).toBe(-600);
    expect(zoneOffsetMinutes(new Date("2026-12-01T12:00:00Z"), ZONES.hnl)).toBe(-600);
  });

  it("local midnight is the right instant on both sides of each switch", () => {
    expect(startOfLocalDay("2026-11-01", ZONES.ny).toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(startOfLocalDay("2026-11-02", ZONES.ny).toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(startOfLocalDay("2026-03-08", ZONES.la).toISOString()).toBe("2026-03-08T08:00:00.000Z");
    expect(startOfLocalDay("2026-03-09", ZONES.la).toISOString()).toBe("2026-03-09T07:00:00.000Z");
    expect(startOfLocalDay("2026-11-01", ZONES.hnl).toISOString()).toBe("2026-11-01T10:00:00.000Z");
  });

  it("the fall-back day lasts 25 hours and the spring-forward day 23", () => {
    const len = (d: string, z: string) =>
      (startOfLocalDay(shiftDay(d, 1), z).getTime() - startOfLocalDay(d, z).getTime()) / 3.6e6;
    expect(len("2026-11-01", ZONES.ny)).toBe(25);
    expect(len("2026-11-01", ZONES.chi)).toBe(25);
    expect(len("2026-11-01", ZONES.la)).toBe(25);
    expect(len("2026-03-08", ZONES.ny)).toBe(23);
    expect(len("2026-11-01", ZONES.hnl)).toBe(24);
  });

  it("an instant belongs to each store's own calendar day", () => {
    const at = "2026-11-02T05:30:00Z"; // 00:30 NY, 23:30 Chicago (Nov 1), 21:30 LA, 19:30 HNL
    expect(localDay(at, ZONES.ny)).toBe("2026-11-02");
    expect(localDay(at, ZONES.chi)).toBe("2026-11-01");
    expect(localDay(at, ZONES.la)).toBe("2026-11-01");
    expect(localDay(at, ZONES.hnl)).toBe("2026-11-01");
  });

  it("same local time yesterday, across the switch", () => {
    // Nov 2 10:00 EST → Nov 1 10:00 EST (after the 02:00 fall-back).
    expect(
      zonedTimeToUtc("2026-11-01", ZONES.ny, { hour: 10, minute: 0, second: 0 }).toISOString(),
    ).toBe("2026-11-01T15:00:00.000Z");
    expect(daysBetween("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
  });
});

describe("financial-period: one definition for every screen", () => {
  it("windows end on the store's today", () => {
    expect(periodWindow(PERIOD.today, "2026-11-03")).toEqual({
      sinceDay: "2026-11-03",
      untilDay: "2026-11-03",
    });
    expect(periodWindow(PERIOD.days(7), "2026-11-03").sinceDay).toBe("2026-10-28");
    expect(periodWindow(PERIOD.month, "2026-11-03").sinceDay).toBe("2026-11-01");
    expect(periodWindow(PERIOD.all, "2026-11-03").sinceDay).toBeNull();
    expect(previousWindow(PERIOD.days(7), "2026-11-03")).toEqual({
      sinceDay: "2026-10-21",
      untilDay: "2026-10-27",
    });
    expect(previousWindow(PERIOD.month, "2026-11-03")).toBeNull();
    expect(readSpanDays(PERIOD.days(30), true)).toBe(60);
    expect(readSpanDays(PERIOD.all, true)).toBeNull();
  });

  it("orders are read from the earliest store's local midnight", () => {
    const now = new Date("2026-11-03T15:00:00Z");
    expect(
      ordersReadSince([{ timeZone: ZONES.ny }, { timeZone: ZONES.hnl }], PERIOD.today, now),
    ).toBe("2026-11-03T05:00:00.000Z");
  });
});

// ── Cross-module consistency ──────────────────────────────────────────────────────────────────

const NOW = new Date("2026-11-03T15:00:00Z"); // 10:00 NY, 05:00 HNL
const STORES = [
  { slug: "ny", dbId: "db-ny", timeZone: ZONES.ny, name: "NY" },
  { slug: "chi", dbId: "db-chi", timeZone: ZONES.chi, name: "Chicago" },
  { slug: "la", dbId: "db-la", timeZone: ZONES.la, name: "LA" },
  { slug: "hnl", dbId: "db-hnl", timeZone: ZONES.hnl, name: "Honolulu" },
];

/** Hourly synthetic ledger rows over 40 days at every store, crossing the Nov 1 fall-back. */
function syntheticRows(): LedgerRow[] {
  const rows: LedgerRow[] = [];
  const start = Date.parse("2026-09-25T00:30:00Z");
  let i = 0;
  for (const st of STORES)
    for (let h = 0; start + h * 3.6e6 < NOW.getTime(); h += 1) {
      const at = new Date(start + h * 3.6e6).toISOString();
      const kinds = ["revenue", "cogs", "revenue", "reversal_revenue", "reversal_cogs", "purchase"];
      const kind = kinds[h % kinds.length]!;
      rows.push({
        id: `r${i++}`,
        kind,
        amount_cents: 100 + ((h * 37) % 900),
        created_at: at,
        location_id: st.dbId,
        order_id: null,
      });
    }
  return rows;
}

function expenses(): Expense[] {
  return STORES.flatMap((st, i) => [
    { id: `e${i}a`, locationId: st.slug, amountCents: 50_000, competencyDate: "2026-11-01" },
    { id: `e${i}b`, locationId: st.slug, amountCents: 20_000, competencyDate: "2026-10-20" },
    { id: `e${i}c`, locationId: st.slug, amountCents: 99_999, competencyDate: "2026-11-30" },
    {
      id: `e${i}d`,
      locationId: st.slug,
      amountCents: 7_000,
      competencyDate: "2026-11-02",
      isSimulation: true,
    },
  ]).map(
    (e) =>
      ({
        isSimulation: false,
        category: "rent",
        dueDate: e.competencyDate,
        status: "pending",
        ...e,
      }) as unknown as Expense,
  );
}

describe("Overview, Finance, Reports and Insights agree for the same period", () => {
  const rows = syntheticRows();
  const summary = summaryFromRows(rows, {
    stores: STORES.map((s) => ({ id: s.dbId, timeZone: s.timeZone })),
    days: null,
    now: NOW,
  });
  const exp = expenses();
  const dbIdOf = new Map(STORES.map((s) => [s.slug, s.dbId]));
  const rawExpenses = exp.map((e) => ({
    location_id: dbIdOf.get(e.locationId)!,
    payload: {
      amountCents: e.amountCents,
      competencyDate: e.competencyDate,
      isSimulation: e.isSimulation,
    },
  })) as unknown as Resources["expenses"];
  const resources = { expenses: rawExpenses, inventory: [], recipes: [] } as unknown as Resources;
  const reportStores = STORES.map(({ slug, dbId, timeZone }) => ({ slug, dbId, timeZone }));

  /** SQL-like truth: rows whose store-local day is in that store's window. */
  function truth(spec: Parameters<typeof periodWindow>[0]) {
    let revenue = 0;
    let cogs = 0;
    for (const r of rows) {
      const st = STORES.find((s) => s.dbId === r.location_id)!;
      const w = periodWindow(spec, localDay(NOW, st.timeZone));
      const d = localDay(r.created_at, st.timeZone);
      if ((w.sinceDay && d < w.sinceDay) || d > w.untilDay) continue;
      if (r.kind === "revenue") revenue += r.amount_cents;
      if (r.kind === "reversal_revenue") revenue -= r.amount_cents;
      if (r.kind === "cogs") cogs += r.amount_cents;
      if (r.kind === "reversal_cogs") cogs -= r.amount_cents;
    }
    return { revenue, cogs };
  }

  for (const [label, spec] of [
    ["today", PERIOD.today],
    ["7 days", PERIOD.days(7)],
    ["30 days", PERIOD.days(30)],
    ["month", PERIOD.month],
    ["all", PERIOD.all],
  ] as const) {
    it(`${label}: revenue, COGS, expenses, result and margin are identical everywhere`, () => {
      const t = truth(spec);
      // Overview / Reports
      const report = buildReport({ orders: [], summary, spec, stores: reportStores });
      // Finance cards
      const finance = periodFigures(summary, spec);
      const windows = storeWindows(summary, spec);
      const recognized = recognizedInStoreWindows(exp, (e) =>
        windows.get(dbIdOf.get(e.locationId)!),
      );
      const financeExpenses = recognized.reduce((s, e) => s + e.amountCents, 0);
      const financeResult = financialResult({ ...finance, expensesCents: financeExpenses });
      // Finance per-store table
      const storeRefs = STORES.map((s) => ({ id: s.slug, name: s.name, dbId: s.dbId }));
      const perStore = storeResults(
        storeRefs,
        bucketRows(bucketsInPeriod(summary, spec)),
        recognized,
      );
      // Insights
      const insights = recordedIntelligence(
        resources,
        finance,
        rawExpensesInWindows(resources.expenses, windows),
      );

      expect(report.revenueCents).toBe(t.revenue);
      expect(finance.revenueCents).toBe(t.revenue);
      expect(insights.grossRevenueCents).toBe(t.revenue);
      expect(perStore.reduce((s, r) => s + r.revenueCents, 0)).toBe(t.revenue);
      expect(report.byStore.reduce((s, r) => s + r.cents, 0)).toBe(t.revenue);
      expect(report.daily.reduce((s, d) => s + d.cents, 0)).toBe(t.revenue);

      expect(report.cogsCents).toBe(t.cogs);
      expect(insights.foodCostCents).toBe(t.cogs);
      expect(perStore.reduce((s, r) => s + r.cogsCents, 0)).toBe(t.cogs);

      expect(insights.operatingExpensesCents).toBe(financeExpenses);
      expect(perStore.reduce((s, r) => s + r.expensesCents, 0)).toBe(financeExpenses);
      expect(insights.netRevenueCents).toBe(financeResult.resultCents);
      expect(perStore.reduce((s, r) => s + r.resultCents, 0)).toBe(financeResult.resultCents);
      if (finance.revenueCents > 0)
        expect(insights.grossMarginRate / 100).toBeCloseTo(financeResult.grossMargin!, 10);
    });
  }

  it("future and simulated expenses never count; Nov 1 counts in every zone's month", () => {
    const windows = storeWindows(summary, PERIOD.month);
    const recognized = recognizedInStoreWindows(exp, (e) => windows.get(dbIdOf.get(e.locationId)!));
    expect(recognized.map((e) => e.amountCents)).toEqual([50_000, 50_000, 50_000, 50_000]);
  });

  it("the monthly trend sums to the same totals as 'all time'", () => {
    const trend = monthlyTrend(summaryRows(summary), [], "2026-11");
    const all = periodFigures(summary, PERIOD.all);
    expect(trend.reduce((s, m) => s + m.revenueCents, 0)).toBe(all.revenueCents);
    expect(trend.reduce((s, m) => s + m.cogsCents, 0)).toBe(all.cogsCents);
  });

  it("per-store figures use each store's own today (Honolulu is 5 h behind NY)", () => {
    const today = figuresByStore(summary, PERIOD.today);
    expect([...today.keys()].sort()).toEqual(["db-chi", "db-hnl", "db-la", "db-ny"]);
    expect(summary.stores.find((s) => s.locationId === "db-hnl")?.today).toBe("2026-11-03");
  });

  it("comparisons come from the same summary and are equal-length", () => {
    const p = buildPreviousReport(summary, PERIOD.days(7))!;
    expect(p.daily).toHaveLength(7);
    expect(p.revenueCents).toBe(previousFigures(summary, PERIOD.days(7))!.revenueCents);
    expect(p.daily.reduce((s, d) => s + d.cents, 0)).toBe(p.revenueCents);
    const y = buildPreviousReport(summary, PERIOD.today)!;
    expect(y.daily).toHaveLength(1);
    expect(dailyRevenue(summary, PERIOD.today)).toHaveLength(1);
  });
});
