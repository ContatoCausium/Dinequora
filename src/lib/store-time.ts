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
