import type { LedgerBucket, LedgerSummary } from "./ledger-reader";
import {
  inWindow,
  periodWindow,
  previousWindow,
  type DayWindow,
  type PeriodSpec,
} from "./financial-period";
import { daysBetween } from "./store-time";

/**
 * Canonical financial figures for Overview, Finance, Reports and Insights (wave 0). Every screen
 * reads the same server summary (complete ledger read, day totals per store in the store's zone)
 * through these selectors, so the same period shows the same revenue, COGS, margin and result.
 *
 * Definitions:
 * - revenue = Σ revenue − Σ reversal_revenue (net sales, tax excluded, as recorded by the sale);
 * - COGS = Σ cogs − Σ reversal_cogs (recipe cost at sale time);
 * - gross profit = revenue − COGS; gross margin = gross profit ÷ revenue;
 * - operating expenses are recognized by competency date (see period-metrics) per store window;
 * - result = gross profit − operating expenses.
 */

export interface LedgerFigures {
  revenueCents: number;
  cogsCents: number;
  /**
   * Net recorded sales: revenue rows minus revenue reversals. A sale writes one revenue row and its
   * cancellation one reversal of it, so a cancelled sale is not counted (counted on the day of each
   * event, like the amounts).
   */
  sales: number;
  /** Ledger rows behind the figures. */
  entries: number;
}

export const ZERO_FIGURES: LedgerFigures = { revenueCents: 0, cogsCents: 0, sales: 0, entries: 0 };

export function foldBuckets(buckets: readonly LedgerBucket[]): LedgerFigures {
  const f = { ...ZERO_FIGURES };
  for (const b of buckets) {
    f.entries += b.entries;
    if (b.kind === "revenue") {
      f.revenueCents += b.amountCents;
      f.sales += b.entries;
    } else if (b.kind === "reversal_revenue") {
      f.revenueCents -= b.amountCents;
      f.sales -= b.entries;
    } else if (b.kind === "cogs") f.cogsCents += b.amountCents;
    else if (b.kind === "reversal_cogs") f.cogsCents -= b.amountCents;
  }
  return f;
}

type Which = "current" | "previous";

function windowFor(spec: PeriodSpec, today: string, which: Which): DayWindow | null {
  return which === "current" ? periodWindow(spec, today) : previousWindow(spec, today);
}

/** The buckets of each store inside that store's own window (its local today and days). */
export function bucketsInPeriod(
  summary: LedgerSummary,
  spec: PeriodSpec,
  which: Which = "current",
): LedgerBucket[] {
  const windows = new Map<string, DayWindow | null>(
    summary.stores.map((s) => [s.locationId, windowFor(spec, s.today, which)]),
  );
  return summary.buckets.filter((b) => {
    const w = windows.get(b.locationId);
    return w ? inWindow(b.day, w) : false;
  });
}

export function periodFigures(summary: LedgerSummary, spec: PeriodSpec): LedgerFigures {
  return foldBuckets(bucketsInPeriod(summary, spec));
}

/**
 * The comparison period: "today" → yesterday up to the same local time (server totals); "N days"
 * → the N days before; otherwise none.
 */
export function previousFigures(summary: LedgerSummary, spec: PeriodSpec): LedgerFigures | null {
  if (spec.kind === "today") {
    if (!summary.sameTimeYesterday) return null;
    return summary.sameTimeYesterday.reduce<LedgerFigures>(
      (f, t) => ({
        revenueCents: f.revenueCents + t.revenueCents,
        cogsCents: f.cogsCents + t.cogsCents,
        sales: f.sales + t.sales,
        entries: f.entries,
      }),
      { ...ZERO_FIGURES },
    );
  }
  if (spec.kind !== "days") return null;
  return foldBuckets(bucketsInPeriod(summary, spec, "previous"));
}

/** Per-store figures for the period (keyed by store database id). */
export function figuresByStore(
  summary: LedgerSummary,
  spec: PeriodSpec,
): Map<string, LedgerFigures> {
  const by = new Map<string, LedgerBucket[]>();
  for (const b of bucketsInPeriod(summary, spec)) {
    const list = by.get(b.locationId) ?? [];
    list.push(b);
    by.set(b.locationId, list);
  }
  return new Map([...by].map(([id, list]) => [id, foldBuckets(list)]));
}

/**
 * Net sales per local day over the period, zero-filled. Days of different stores are merged by
 * calendar date (each store contributes its own local day).
 */
export function dailyRevenue(
  summary: LedgerSummary,
  spec: PeriodSpec,
  which: Which = "current",
): { day: string; cents: number }[] {
  const windows = summary.stores
    .map((s) => windowFor(spec, s.today, which))
    .filter((w): w is DayWindow => w !== null);
  if (!windows.length) return [];
  const inPeriod = bucketsInPeriod(summary, spec, which);
  const sinceDays = windows.map((w) => w.sinceDay);
  const first =
    sinceDays.some((d) => d === null) || !sinceDays.length
      ? (inPeriod.map((b) => b.day).sort()[0] ?? windows[0]!.untilDay)
      : (sinceDays as string[]).sort()[0]!;
  const last = windows.map((w) => w.untilDay).sort()[windows.length - 1]!;
  const cents = new Map<string, number>();
  for (const b of inPeriod) {
    if (b.kind === "revenue") cents.set(b.day, (cents.get(b.day) ?? 0) + b.amountCents);
    if (b.kind === "reversal_revenue") cents.set(b.day, (cents.get(b.day) ?? 0) - b.amountCents);
  }
  return daysBetween(first, last).map((day) => ({ day, cents: cents.get(day) ?? 0 }));
}

/**
 * Ledger-shaped rows from the summary (one per store, day and kind) for the month-based helpers
 * (trend, P&L by month). `local_day` carries the store's own calendar day, so no zone is re-applied.
 */
export interface SummaryLedgerRow {
  id: string;
  kind: string;
  amount_cents: number;
  created_at: string;
  location_id: string;
  order_id: null;
  local_day: string;
}

export function summaryRows(summary: Pick<LedgerSummary, "buckets">): SummaryLedgerRow[] {
  return summary.buckets.map((b) => ({
    id: `${b.locationId}:${b.day}:${b.kind}`,
    kind: b.kind,
    amount_cents: b.amountCents,
    // Noon UTC of the local day: only a stable placeholder; consumers read local_day.
    created_at: `${b.day}T12:00:00.000Z`,
    location_id: b.locationId,
    order_id: null,
    local_day: b.day,
  }));
}

/** Whether the figures can be shown as complete. */
export function summaryIncomplete(summary: LedgerSummary | null | undefined) {
  return summary ? !summary.complete : false;
}

/** Day windows per store (database id) for the period, e.g. to recognize expenses per store. */
export function storeWindows(
  summary: LedgerSummary,
  spec: PeriodSpec,
  which: Which = "current",
): Map<string, DayWindow | null> {
  return new Map(summary.stores.map((s) => [s.locationId, windowFor(spec, s.today, which)]));
}

/** The summary restricted to some stores (database ids); null = every store of the summary. */
export function scopeSummary(summary: LedgerSummary, storeDbIds: readonly string[] | null) {
  if (storeDbIds === null) return summary;
  const keep = new Set(storeDbIds);
  return {
    ...summary,
    stores: summary.stores.filter((s) => keep.has(s.locationId)),
    buckets: summary.buckets.filter((b) => keep.has(b.locationId)),
    ...(summary.sameTimeYesterday
      ? { sameTimeYesterday: summary.sameTimeYesterday.filter((t) => keep.has(t.locationId)) }
      : {}),
  } satisfies LedgerSummary;
}

/** Ledger-shaped rows for some buckets (see summaryRows). */
export function bucketRows(buckets: readonly LedgerBucket[]): SummaryLedgerRow[] {
  return summaryRows({ buckets: [...buckets] });
}

/**
 * Expenses recognized in each store's own window: competency date inside the window of the
 * expense's store, never simulated (the rule of period-metrics.isRecognizedInPeriod per store).
 * `windowOf` returns the window of an expense's store (null/undefined = store not in scope).
 */
export function recognizedInStoreWindows<
  T extends { competencyDate: string; isSimulation: boolean },
>(expenses: readonly T[], windowOf: (e: T) => DayWindow | null | undefined): T[] {
  return expenses.filter((e) => {
    if (e.isSimulation || !/^\d{4}-\d{2}-\d{2}$/.test(e.competencyDate)) return false;
    const w = windowOf(e);
    return w ? inWindow(e.competencyDate, w) : false;
  });
}

/** The latest local today among the summary's stores (US stores differ by a few hours at most). */
export function summaryToday(summary: LedgerSummary, fallback: string): string {
  return (
    summary.stores
      .map((s) => s.today)
      .sort()
      .at(-1) ?? fallback
  );
}
