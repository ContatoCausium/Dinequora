// M2 — mapping and fallback rules of the database aggregation (the real database is covered by
// src/test/integration/ledger-aggregate.db.test.ts).
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { isMissingFunction, readLedgerSummaryAggregated, toSummary } from "@/lib/ledger-aggregate";
import { summaryFromRows } from "@/lib/ledger-reader";
import { periodFigures, previousFigures } from "@/lib/financial-summary";
import { PERIOD } from "@/lib/financial-period";

const STORES = [
  { id: "s-ny", timeZone: "America/New_York" },
  { id: "s-hnl", timeZone: "Pacific/Honolulu" },
];
const client = (result: { data: unknown; error: unknown }) => {
  const rpc = vi.fn().mockResolvedValue(result);
  return { rpc, c: { rpc } as unknown as SupabaseClient<Database> };
};
const RAW = {
  read_until: "2026-11-03T15:00:00.123456+00:00",
  stores: [
    { id: "s-hnl", tz: "Pacific/Honolulu", today: "2026-11-03", since: "2026-11-03" },
    { id: "s-ny", tz: "America/New_York", today: "2026-11-03", since: "2026-11-03" },
  ],
  buckets: [
    ["s-ny", "2026-11-03", "revenue", 3000, 2],
    ["s-ny", "2026-11-03", "reversal_revenue", 1000, 1],
    ["s-ny", "2026-11-03", "cogs", 400, 2],
    ["s-hnl", "2026-11-03", "revenue", 500, 1],
  ],
  yesterday: [
    ["s-ny", "revenue", 2000, 2],
    ["s-ny", "reversal_revenue", 500, 1],
    ["s-hnl", "cogs", 70, 1],
  ],
};

describe("readLedgerSummaryAggregated", () => {
  it("calls ledger_day_totals with the scope's stores and maps the snapshot", async () => {
    const { rpc, c } = client({ data: RAW, error: null });
    const s = (await readLedgerSummaryAggregated(c, {
      orgId: "org",
      stores: STORES,
      days: 1,
      sameTimeYesterday: true,
    }))!;
    expect(rpc).toHaveBeenCalledWith("ledger_day_totals", {
      _org_id: "org",
      _location_ids: ["s-ny", "s-hnl"],
      _days: 1,
      _same_time_yesterday: true,
    });
    expect(s.complete).toBe(true);
    expect(s.stores.map((w) => w.locationId)).toEqual(["s-ny", "s-hnl"]); // caller's order
    expect(s.rowsRead).toBe(2 + 1 + 2 + 1 + 2 + 1 + 1);
    expect(periodFigures(s, PERIOD.today)).toEqual({
      revenueCents: 2500,
      cogsCents: 400,
      sales: 2, // 3 revenue rows − 1 reversal
      entries: 6,
    });
    expect(s.sameTimeYesterday).toEqual([
      { locationId: "s-ny", revenueCents: 1500, cogsCents: 0, sales: 1 },
      { locationId: "s-hnl", revenueCents: 0, cogsCents: 70, sales: 0 },
    ]);
    expect(previousFigures(s, PERIOD.today)?.revenueCents).toBe(1500);
  });

  it("whole history: no _days parameter is sent", async () => {
    const { rpc, c } = client({ data: { ...RAW, yesterday: [] }, error: null });
    await readLedgerSummaryAggregated(c, { orgId: "org", stores: STORES, days: null });
    expect(rpc.mock.calls[0]![1]).not.toHaveProperty("_days");
  });

  it("falls back (null) ONLY when the function does not exist", async () => {
    for (const code of ["PGRST202", "42883"]) {
      const { c } = client({ data: null, error: { code, message: "not found" } });
      expect(
        await readLedgerSummaryAggregated(c, { orgId: "o", stores: STORES, days: 7 }),
      ).toBeNull();
    }
    expect(isMissingFunction({ code: "42501" })).toBe(false);
  });

  it("any other error is raised, never a silent fallback (e.g. a timeout or a permission error)", async () => {
    for (const code of ["57014", "42501", "PGRST301", undefined]) {
      const { c } = client({ data: null, error: { code, message: "boom" } });
      await expect(
        readLedgerSummaryAggregated(c, { orgId: "o", stores: STORES, days: 7 }),
      ).rejects.toThrow("ledger_read_failed");
    }
  });

  it("a malformed answer is an error, not an empty (and falsely complete) summary", () => {
    expect(() => toSummary(null, STORES, false)).toThrow("ledger_read_failed");
    expect(() => toSummary({ stores: [] }, STORES, false)).toThrow("ledger_read_failed");
  });

  it("a store the caller cannot read is absent, as with the paged reader", () => {
    const s = toSummary({ ...RAW, stores: [RAW.stores[1]] }, STORES, false);
    expect(s.stores.map((w) => w.locationId)).toEqual(["s-ny"]);
  });

  it("no store in scope: an empty, complete summary without calling the database", async () => {
    const { rpc, c } = client({ data: RAW, error: null });
    const s = await readLedgerSummaryAggregated(c, { orgId: "o", stores: [], days: 7 });
    expect(rpc).not.toHaveBeenCalled();
    expect(s).toMatchObject({ complete: true, buckets: [], stores: [] });
  });

  it("same shape as the paged reader's summary (the screens consume either)", () => {
    const paged = summaryFromRows([], { stores: STORES, days: 1, now: new Date(RAW.read_until) });
    const agg = toSummary(RAW, STORES, true);
    expect(Object.keys(agg).sort()).toEqual(Object.keys(paged).sort());
  });
});
