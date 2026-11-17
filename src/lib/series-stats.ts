import { averageCents, sumCents } from "./money";

export interface DayPoint {
  /** Local calendar day, "YYYY-MM-DD" (report-metrics dayKey). */
  day: string;
  cents: number;
}

export interface CompletedDayStats {
  highest: DayPoint;
  lowest: DayPoint;
  averageCents: number;
  /** How many completed days the figures cover. */
  days: number;
}

/**
 * Highest, lowest and average of the daily series, over completed days only: the day that is
 * still in progress (`today` and anything after it) would otherwise always look like the weakest
 * day. Ties keep the earliest day. Null when no completed day is in the window.
 * Presentation only: it reads the same daily series the chart draws, no extra query.
 */
export function completedDayStats(
  daily: readonly DayPoint[],
  today: string,
): CompletedDayStats | null {
  const done = daily.filter((d) => d.day < today);
  if (done.length === 0) return null;
  let highest = done[0]!;
  let lowest = done[0]!;
  for (const d of done) {
    if (d.cents > highest.cents) highest = d;
    if (d.cents < lowest.cents) lowest = d;
  }
  const total = sumCents(done.map((d) => d.cents));
  return { highest, lowest, averageCents: averageCents(total, done.length), days: done.length };
}
