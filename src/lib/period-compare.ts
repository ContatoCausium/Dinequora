import { fmtPercent } from "./format";
import { periodStart } from "./recorded-data";

/**
 * Previous-period comparison (redesign phase 4). Presentation only: it reads the same records the
 * current period reads, through the same report function, for the window right before it.
 */
export type ComparablePeriod = "today" | "7d" | "30d" | "90d";

export interface PreviousWindow {
  /** Inclusive start (ISO). */
  since: string;
  /** Exclusive end (ISO). */
  end: string;
  days: number;
  /** "Now" for the daily buckets of the previous window (its last instant). */
  now: Date;
}

/**
 * The window of the same length right before the current one. "Today" compares with yesterday up
 * to the same time of day, so a morning is never compared with a whole day.
 */
export function previousWindow(period: ComparablePeriod, now = new Date()): PreviousWindow {
  const since = new Date(periodStart(period, now));
  if (period === "today") {
    const prevSince = new Date(since);
    prevSince.setDate(prevSince.getDate() - 1);
    const prevEnd = new Date(now);
    prevEnd.setDate(prevEnd.getDate() - 1);
    return { since: prevSince.toISOString(), end: prevEnd.toISOString(), days: 1, now: prevEnd };
  }
  const days = Number(period.replace("d", ""));
  const prevSince = new Date(since);
  prevSince.setDate(prevSince.getDate() - days);
  return {
    since: prevSince.toISOString(),
    end: since.toISOString(),
    days,
    now: new Date(since.getTime() - 1),
  };
}

/** Relative change; null when there is nothing to compare with (no previous value). */
export function relativeChange(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous <= 0) return null;
  return (current - previous) / previous;
}

export interface KpiDelta {
  direction: "up" | "down" | "flat" | null;
  /** "+12.4%", "−3%", "0%" — or the "no comparison" text. */
  text: string;
  tone: "positive" | "negative" | "neutral";
  /** "vs previous 7 days". */
  caption: string;
}

/** Changes under half a percent read as flat. */
export const FLAT_THRESHOLD = 0.005;

export function kpiDelta(
  current: number,
  previous: number | null | undefined,
  opts: { lng: string; caption: string; unavailable: string; goodWhen?: "up" | "down" | "none" },
): KpiDelta {
  const change = previous == null ? null : relativeChange(current, previous);
  if (change == null)
    return { direction: null, text: opts.unavailable, tone: "neutral", caption: opts.caption };
  const direction = Math.abs(change) < FLAT_THRESHOLD ? "flat" : change > 0 ? "up" : "down";
  const goodWhen = opts.goodWhen ?? "up";
  const tone =
    direction === "flat" || goodWhen === "none"
      ? "neutral"
      : (direction === "up") === (goodWhen === "up")
        ? "positive"
        : "negative";
  return {
    direction,
    text: direction === "flat" ? fmtPercent(0, opts.lng) : fmtPercent(change, opts.lng, true),
    tone,
    caption: opts.caption,
  };
}
