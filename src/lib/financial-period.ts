import { shiftDay } from "./store-time";

/**
 * Reporting periods shared by Overview, Finance, Reports and Insights (wave 0). A period is a range
 * of LOCAL calendar days of each store, ending on that store's today. Two stores in different zones
 * therefore each contribute their own "today", "last 7 days" or "this month", and the same period
 * on two screens always covers the same days.
 */
export type PeriodSpec =
  { kind: "today" } | { kind: "days"; days: number } | { kind: "month" } | { kind: "all" };

/** Inclusive range of local days; `sinceDay` null = from the first record. */
export interface DayWindow {
  sinceDay: string | null;
  untilDay: string;
}

export const PERIOD = {
  today: { kind: "today" } as PeriodSpec,
  days: (days: number): PeriodSpec => ({ kind: "days", days }),
  month: { kind: "month" } as PeriodSpec,
  all: { kind: "all" } as PeriodSpec,
};

/** The days of a period for a store whose local today is `today`. */
export function periodWindow(spec: PeriodSpec, today: string): DayWindow {
  switch (spec.kind) {
    case "today":
      return { sinceDay: today, untilDay: today };
    case "days":
      return { sinceDay: shiftDay(today, -(Math.max(1, spec.days) - 1)), untilDay: today };
    case "month":
      return { sinceDay: `${today.slice(0, 7)}-01`, untilDay: today };
    case "all":
      return { sinceDay: null, untilDay: today };
  }
}

/**
 * The equal-length window right before the period (comparisons). "today" compares with yesterday
 * up to the same local time, which day totals cannot express: callers use the server's
 * same-time-yesterday totals instead (null here). "month" and "all" have no comparison.
 */
export function previousWindow(spec: PeriodSpec, today: string): DayWindow | null {
  if (spec.kind !== "days") return null;
  const n = Math.max(1, spec.days);
  return { sinceDay: shiftDay(today, -(2 * n - 1)), untilDay: shiftDay(today, -n) };
}

/** How many local days (ending today) must be read to cover a period and its comparison. */
export function readSpanDays(spec: PeriodSpec, compare: boolean): number | null {
  switch (spec.kind) {
    case "today":
      return 1;
    case "days":
      return Math.max(1, spec.days) * (compare ? 2 : 1);
    case "month":
      return 31;
    case "all":
      return null;
  }
}

export function inWindow(day: string, w: DayWindow): boolean {
  return (w.sinceDay === null || day >= w.sinceDay) && day <= w.untilDay;
}
