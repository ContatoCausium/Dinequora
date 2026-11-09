/**
 * Below this, an in_prep → ready interval cannot be real kitchen work: it comes from automated or
 * bulk status changes (imports, demo seeding, a manager clearing the board). Such intervals are
 * excluded — and counted — instead of dragging the average to "0 min".
 */
export const MIN_PLAUSIBLE_PREP_SECONDS = 15;

export interface PrepStats {
  /** Average minutes over plausible samples; null when there is none. */
  avgMinutes: number | null;
  /** Orders whose preparation was measured. */
  samples: number;
  /** Orders that went in_prep → ready faster than MIN_PLAUSIBLE_PREP_SECONDS (ignored). */
  instant: number;
}

/** Preparation time = first "ready" after the first "in_prep" (robust to reopened tickets). */
export function prepStats(
  orders: readonly {
    status: string;
    timeline: readonly { toStatus: string; timestamp: string }[];
  }[],
): PrepStats {
  const durations: number[] = [];
  let instant = 0;
  for (const o of orders) {
    if (o.status === "cancelled") continue;
    const at = (t: string) => Date.parse(t);
    const events = [...o.timeline].sort((a, b) => at(a.timestamp) - at(b.timestamp));
    const start = events.find((e) => e.toStatus === "in_prep");
    if (!start) continue;
    const end = events.find((e) => e.toStatus === "ready" && at(e.timestamp) > at(start.timestamp));
    if (!end) continue;
    const seconds = (Date.parse(end.timestamp) - Date.parse(start.timestamp)) / 1000;
    if (seconds < MIN_PLAUSIBLE_PREP_SECONDS) instant += 1;
    else durations.push(seconds / 60);
  }
  return {
    avgMinutes: durations.length
      ? Math.round((durations.reduce((s, v) => s + v, 0) / durations.length) * 10) / 10
      : null,
    samples: durations.length,
    instant,
  };
}
