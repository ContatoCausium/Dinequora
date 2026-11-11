import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { storeMetricsSince, storeSalesMetrics } from "@/lib/location-metrics";
import {
  listSuspendedSales,
  QUARANTINE_SUSPENDED_PREFIX,
  SUSPENDED_SALE_TTL_MS,
  suspendSale,
  type SuspendedSale,
} from "@/lib/pos-service";
import en from "@/locales/en-US/locations.json";
import pt from "@/locales/pt-BR/locations.json";
import enCommon from "@/locales/en-US/common.json";
import ptCommon from "@/locales/pt-BR/common.json";

const NOW = new Date("2026-11-09T12:00:00.000Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const order = (o: Partial<Parameters<typeof storeSalesMetrics>[0][number]>) => ({
  locationId: "loc_a",
  createdAt: day(1),
  status: "delivered" as const,
  isSimulated: false,
  paid: true,
  totalCents: 1100,
  taxCents: 100,
  ...o,
});

describe("Locations page — recorded per-store sales (no synthetic numbers for real orgs)", () => {
  it("sums net sales of paid, non-cancelled, non-simulated orders of that store in 30 days", () => {
    const m = storeSalesMetrics(
      [
        order({}),
        order({ createdAt: day(29) }),
        order({ status: "cancelled" }),
        order({ isSimulated: true }),
        order({ paid: false }),
        order({ locationId: "loc_b" }),
        order({ createdAt: day(31) }), // previous window
      ],
      "loc_a",
      NOW,
    );
    expect(m.salesCents).toBe(2000);
    expect(m.orders).toBe(2);
    expect(m.growth).toBeCloseTo(1); // 2000 vs 1000
  });

  it("reports zero (not invented figures) for a store without sales and no growth baseline", () => {
    expect(storeSalesMetrics([], "loc_a", NOW)).toEqual({ salesCents: 0, orders: 0, growth: null });
  });

  it("queries from the start of the comparison window", () => {
    expect(storeMetricsSince(NOW)).toBe(day(60));
  });
});

describe("POS held tickets — expiry and quarantine (key servora.pos.suspended.<org> kept)", () => {
  const ORG = "org_phase0";
  const KEY = `servora.pos.suspended.${ORG}`;
  const QKEY = `${QUARANTINE_SUSPENDED_PREFIX}${ORG}`;
  const held = (id: string, ageMs: number, extra: Partial<SuspendedSale> = {}): SuspendedSale =>
    ({
      id,
      orgId: ORG,
      locationId: "loc_1",
      attendantName: "a",
      customerName: "Customer",
      orderType: "dine_in",
      // A real held line carries its amounts in whole cents (a line without them is quarantined).
      items: [
        {
          id: "line",
          productId: "p",
          productName: "Item",
          quantity: 1,
          basePriceCents: 500,
          modifiers: [],
          subtotalCents: 500,
        },
      ],
      discountCents: 0,
      taxRatePpm: 0,
      suspendedAt: new Date(Date.now() - ageMs).toISOString(),
      ...extra,
    }) as unknown as SuspendedSale;

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("offers recent tickets and moves expired ones to quarantine without deleting them", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([held("fresh", 60_000), held("old", SUSPENDED_SALE_TTL_MS + 60_000)]),
    );
    expect(listSuspendedSales(ORG).map((s) => s.id)).toEqual(["fresh"]);
    expect(JSON.parse(localStorage.getItem(KEY)!).map((s: SuspendedSale) => s.id)).toEqual([
      "fresh",
    ]);
    const q = JSON.parse(localStorage.getItem(QKEY)!);
    expect(q).toHaveLength(1);
    expect(q[0].entry.id).toBe("old");
    expect(typeof q[0].quarantinedAt).toBe("string");
  });

  it("quarantines malformed and foreign-org entries instead of showing or crashing", () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        held("ok", 1000),
        { id: "no-items", locationId: "loc_1", items: [], suspendedAt: new Date().toISOString() },
        held("other-org", 1000, { orgId: "org_other" }),
        "garbage",
      ]),
    );
    expect(listSuspendedSales(ORG).map((s) => s.id)).toEqual(["ok"]);
    expect(JSON.parse(localStorage.getItem(QKEY)!)).toHaveLength(3);
  });

  it("preserves an unreadable value in quarantine", () => {
    localStorage.setItem(KEY, "{not json");
    expect(listSuspendedSales(ORG)).toEqual([]);
    expect(JSON.parse(localStorage.getItem(QKEY)!)[0].entry).toEqual({ unreadable: "{not json" });
  });

  it("still holds and lists a new ticket under the same key", () => {
    suspendSale(ORG, held("new", 0));
    expect(listSuspendedSales(ORG, "loc_1").map((s) => s.id)).toEqual(["new"]);
    expect(localStorage.getItem(KEY)).toContain('"new"');
  });
});

describe("Phase 0 strings exist in both languages", () => {
  it("locations and notifications keys", () => {
    for (const j of [en, pt]) {
      expect(j.metrics.unavailable).toBeTruthy();
      expect(j.metrics.truncated).toBeTruthy();
      expect(j.recordedNote).toBeTruthy();
      expect(j.setupNote).toBeTruthy();
      expect(j.recordedNote).not.toMatch(/synthetic|demonstra/i);
    }
    expect(enCommon.shell.notificationsEmpty).toBeTruthy();
    expect(ptCommon.shell.notificationsEmpty).toBeTruthy();
  });
});
