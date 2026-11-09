import { describe, expect, it } from "vitest";
import { prepStats } from "@/lib/kitchen-metrics";

type Ev = {
  id: string;
  toStatus: "new" | "confirmed" | "in_prep" | "ready" | "delivered" | "cancelled";
  timestamp: string;
};
const order = (status: Ev["toStatus"], events: [Ev["toStatus"], string][]) => ({
  status,
  timeline: events.map(([toStatus, timestamp], i) => ({ id: String(i), toStatus, timestamp })),
});

describe("kitchen prep time", () => {
  it("averages in_prep → ready in minutes", () => {
    const s = prepStats([
      order("ready", [
        ["in_prep", "2026-11-08T12:00:00Z"],
        ["ready", "2026-11-08T12:10:00Z"],
      ]),
      order("delivered", [
        ["in_prep", "2026-11-08T12:00:00Z"],
        ["ready", "2026-11-08T12:20:00Z"],
        ["delivered", "2026-11-08T12:25:00Z"],
      ]),
    ]);
    expect(s).toEqual({ avgMinutes: 15, samples: 2, instant: 0 });
  });

  it("ignores (and counts) instantaneous automated transitions", () => {
    const s = prepStats([
      order("ready", [
        ["in_prep", "2026-11-08T12:00:00.000Z"],
        ["ready", "2026-11-08T12:00:00.020Z"],
      ]),
      order("ready", [
        ["in_prep", "2026-11-08T12:00:00Z"],
        ["ready", "2026-11-08T12:06:00Z"],
      ]),
    ]);
    expect(s).toEqual({ avgMinutes: 6, samples: 1, instant: 1 });
  });

  it("uses the first ready after the first in_prep and skips cancelled or unfinished tickets", () => {
    const s = prepStats([
      // ready before prep (out-of-order data) is not a sample
      order("in_prep", [
        ["ready", "2026-11-08T11:00:00Z"],
        ["in_prep", "2026-11-08T12:00:00Z"],
      ]),
      order("cancelled", [
        ["in_prep", "2026-11-08T12:00:00Z"],
        ["ready", "2026-11-08T12:05:00Z"],
      ]),
      // reopened: prep 12:00 → ready 12:08, later back to prep and ready again
      order("delivered", [
        ["in_prep", "2026-11-08T12:00:00Z"],
        ["ready", "2026-11-08T12:08:00Z"],
        ["in_prep", "2026-11-08T12:30:00Z"],
        ["ready", "2026-11-08T12:40:00Z"],
      ]),
    ]);
    expect(s).toEqual({ avgMinutes: 8, samples: 1, instant: 0 });
  });

  it("returns null average without samples", () => {
    expect(prepStats([])).toEqual({ avgMinutes: null, samples: 0, instant: 0 });
  });
});
