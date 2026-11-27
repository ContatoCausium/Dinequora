/**
 * Calendar arithmetic in a store's IANA time zone (wave 0). Dependency-free and DST-aware: a
 * restaurant's "day" is its local calendar day, and the instant that day starts is computed from
 * the zone's offset at that moment (23- and 25-hour days around the US DST switches included).
 */

const partsFormatter = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string) {
  let f = partsFormatter.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    partsFormatter.set(timeZone, f);
  }
  return f;
}

/** Wall-clock fields of an instant in a zone. */
export function zonedParts(at: Date, timeZone: string) {
  const p: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(at))
    if (part.type !== "literal") p[part.type] = Number(part.value);
  return {
    year: p["year"]!,
    month: p["month"]!,
    day: p["day"]!,
    hour: p["hour"]! % 24,
    minute: p["minute"]!,
    second: p["second"]!,
  };
}

/** Offset of the zone from UTC at an instant, in minutes (New York in winter: −300). */
export function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const z = zonedParts(at, timeZone);
  const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

/** Local calendar day (YYYY-MM-DD) of an instant in a zone. */
export function localDay(at: Date | string, timeZone: string): string {
  const z = zonedParts(typeof at === "string" ? new Date(at) : at, timeZone);
  return `${z.year}-${String(z.month).padStart(2, "0")}-${String(z.day).padStart(2, "0")}`;
}

/**
 * localDay() for many instants of ONE zone, without one Intl call per instant (Workers CPU budget):
 * the bounds of the last local day seen are kept — [its local midnight, the next local midnight) —
 * and an instant inside them gets that day at the cost of a comparison. The result is always
 * identical to localDay().
 *
 * Ledger rows arrive sorted by time, so most misses are "the next day": it starts exactly where the
 * previous one ended, and it ends 24 h later unless the zone's offset changes during it (DST). That
 * is checked with ONE offset lookup (if the offset 24 h later equals the offset at the day's start,
 * no transition happened, so that instant is the next local midnight); otherwise the exact local
 * midnight is computed. Any other miss (first instant, a gap, out of order) computes the day and its
 * bounds from scratch with localDay/startOfLocalDay.
 */
export function localDayCache(timeZone: string): (at: string | Date) => string {
  const DAY_MS = 86_400_000;
  let day = "";
  let from = Number.POSITIVE_INFINITY;
  let until = Number.NEGATIVE_INFINITY;
  let untilOffset = 0; // the zone's offset (minutes) at `until`
  /** The local midnight after the day that starts at `start` (whose offset is `startOffset`). */
  const nextMidnight = (start: number, startOffset: number, dayOfStart: string) => {
    const estimate = start + DAY_MS;
    const offset = zoneOffsetMinutes(new Date(estimate), timeZone);
    if (offset === startOffset) return { at: estimate, offset };
    const exact = startOfLocalDay(shiftDay(dayOfStart, 1), timeZone).getTime();
    return { at: exact, offset: zoneOffsetMinutes(new Date(exact), timeZone) };
  };
  return (at) => {
    const t = typeof at === "string" ? Date.parse(at) : at.getTime();
    if (t >= from && t < until) return day;
    if (t >= until && Number.isFinite(until)) {
      // Most likely the next local day (rows sorted by time).
      const nextDay = shiftDay(day, 1);
      const next = nextMidnight(until, untilOffset, nextDay);
      if (t < next.at) {
        day = nextDay;
        from = until;
        until = next.at;
        untilOffset = next.offset;
        return day;
      }
    }
    // From scratch: the day of the instant and its exact bounds.
    day = localDay(new Date(t), timeZone);
    from = startOfLocalDay(day, timeZone).getTime();
    const next = nextMidnight(from, zoneOffsetMinutes(new Date(from), timeZone), day);
    until = next.at;
    untilOffset = next.offset;
    // Defensive: if the bounds do not contain the instant (they always should), cache nothing.
    if (!(t >= from && t < until)) {
      from = Number.POSITIVE_INFINITY;
      until = Number.NEGATIVE_INFINITY;
    }
    return day;
  };
}

/** YYYY-MM-DD shifted by whole days (pure calendar arithmetic, no zone involved). */
export function shiftDay(day: string, days: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The UTC instant at which a local wall-clock time happens in a zone. Two passes resolve the
 * offset around DST changes; US switches happen at 02:00, so midnight always exists.
 */
export function zonedTimeToUtc(
  day: string,
  timeZone: string,
  time: { hour: number; minute: number; second: number } = { hour: 0, minute: 0, second: 0 },
): Date {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const wall = Date.UTC(y, m - 1, d, time.hour, time.minute, time.second);
  const first = wall - zoneOffsetMinutes(new Date(wall), timeZone) * 60000;
  const second = wall - zoneOffsetMinutes(new Date(first), timeZone) * 60000;
  return new Date(second);
}

/** The instant a local day starts in a zone. */
export function startOfLocalDay(day: string, timeZone: string): Date {
  return zonedTimeToUtc(day, timeZone);
}

/** Every day from `first` to `last`, inclusive (empty when first > last). */
export function daysBetween(first: string, last: string): string[] {
  const out: string[] = [];
  for (let d = first; d <= last; d = shiftDay(d, 1)) out.push(d);
  return out;
}
