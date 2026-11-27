// localDayCache (Workers CPU budget): must return exactly localDay() for every instant, sorted or not,
// in every zone, across every DST switch.
import { describe, expect, it } from "vitest";
import { localDay, localDayCache } from "@/lib/store-time";
import { summaryFromRows, type LedgerRow } from "@/lib/ledger-reader";

const ZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/St_Johns", // −3:30 / −2:30
  "Asia/Kolkata", // +5:30, no DST
  "Australia/Lord_Howe", // 30-minute DST
  "Pacific/Chatham", // +12:45 / +13:45
  "Europe/London",
  "UTC",
];
const FROM = Date.parse("2025-01-01T00:00:00Z");
const TO = Date.parse("2027-12-31T00:00:00Z");

/** Deterministic pseudo-random instants (LCG) plus every 7-minute step around each US DST switch. */
function instants(): number[] {
  const out: number[] = [];
  let x = 12345;
  for (let i = 0; i < 4000; i++) {
    x = (x * 1103515245 + 12345) % 2 ** 31;
    out.push(FROM + Math.floor((x / 2 ** 31) * (TO - FROM)));
  }
  for (const sw of [
    "2025-03-09",
    "2025-11-02",
    "2026-03-08",
    "2026-11-01",
    "2027-03-14",
    "2027-11-07",
  ]) {
    const base = Date.parse(`${sw}T00:00:00Z`);
    for (let m = -36 * 60; m <= 36 * 60; m += 7) out.push(base + m * 60_000);
  }
  return out;
}

describe("localDayCache = localDay", () => {
  const all = instants();
  for (const zone of ZONES) {
    it(`${zone}: sorted and shuffled instants, ISO strings and Dates`, () => {
      const sorted = [...all].sort((a, b) => a - b);
      const cachedSorted = localDayCache(zone);
      for (const t of sorted) {
        const iso = new Date(t).toISOString();
        expect(cachedSorted(iso), iso).toBe(localDay(iso, zone));
      }
      const cachedShuffled = localDayCache(zone);
      for (const t of all) expect(cachedShuffled(new Date(t))).toBe(localDay(new Date(t), zone));
    });
  }

  it("accepts PostgreSQL timestamps with microseconds and an explicit offset", () => {
    const cached = localDayCache("America/New_York");
    for (const s of [
      "2026-11-01T05:59:59.999999+00:00",
      "2026-11-01T06:00:00.000001+00:00",
      "2026-11-02T04:59:59.123456+00:00",
      "2026-11-02T05:00:00+00:00",
    ])
      expect(cached(s), s).toBe(localDay(s, "America/New_York"));
  });

  it("the ledger summary buckets are unchanged (same rows, same days, same totals)", () => {
    const rows: LedgerRow[] = instants().map((t, i) => ({
      id: `r${i}`,
      kind: ["revenue", "cogs", "reversal_revenue"][i % 3]!,
      amount_cents: 100 + (i % 97),
      created_at: new Date(t).toISOString(),
      location_id: i % 2 ? "ny" : "hnl",
      order_id: null,
    }));
    const s = summaryFromRows(rows, {
      stores: [
        { id: "ny", timeZone: "America/New_York" },
        { id: "hnl", timeZone: "Pacific/Honolulu" },
      ],
      days: null,
      now: new Date(TO + 86_400_000),
    });
    // Recompute the same buckets with the plain per-row localDay.
    const expected = new Map<string, number>();
    for (const r of rows) {
      const zone = r.location_id === "ny" ? "America/New_York" : "Pacific/Honolulu";
      const k = `${r.location_id}|${localDay(r.created_at, zone)}|${r.kind}`;
      expected.set(k, (expected.get(k) ?? 0) + r.amount_cents);
    }
    const got = new Map(
      s.buckets.map((b) => [`${b.locationId}|${b.day}|${b.kind}`, b.amountCents]),
    );
    expect(got).toEqual(expected);
  });
});
