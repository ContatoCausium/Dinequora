import { describe, it, expect } from "vitest";
import { ledgerMetrics } from "../lib/operational-metrics";
import type { Resources } from "../lib/operational-mappers";
function entry(kind: string, amount: number): Resources["finance"][number] {
  return {
    id: kind,
    org_id: "org",
    location_id: "store",
    order_id: "order",
    kind,
    amount_cents: amount,
    client_event_id: kind,
    reverses_id: null,
    description: "test",
    actor_id: "actor",
    created_at: "2026-10-29T00:00:00Z",
  };
}
describe("Recorded financial ledger", () => {
  it("keeps revenue and configured COGS separate", () => {
    expect(ledgerMetrics([entry("revenue", 3100), entry("cogs", 400)])).toEqual({
      revenueCents: 3100,
      cogsCents: 400,
    });
  });
  it("reverses revenue and COGS without double counting purchase receipts", () => {
    expect(
      ledgerMetrics([
        entry("revenue", 3100),
        entry("cogs", 400),
        entry("reversal_revenue", 3100),
        entry("reversal_cogs", 400),
        entry("purchase", 6000),
      ]),
    ).toEqual({ revenueCents: 0, cogsCents: 0 });
  });
  it("never invents a baseline for an empty restaurant", () => {
    expect(ledgerMetrics([])).toEqual({ revenueCents: 0, cogsCents: 0 });
  });
});
