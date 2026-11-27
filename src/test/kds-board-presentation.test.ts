import { describe, expect, it } from "vitest";
import { COMPLETED_WINDOW_MS, formatPlacedAt, recentlyCompleted } from "@/lib/kds-service";

describe("KDS placed-at time uses the ticket's store zone", () => {
  // 2026-11-16 11:35 UTC = 06:35 in New York (EST) and 08:35 in São Paulo.
  const iso = "2026-11-16T11:35:00.000Z";

  it("formats in the store zone, whatever the device zone is", () => {
    expect(formatPlacedAt(iso, "en-US", "America/New_York")).toBe("06:35 AM");
    expect(formatPlacedAt(iso, "en-US", "America/Los_Angeles")).toBe("03:35 AM");
  });

  it("matches the Orders screen for the same ticket (same zone, same instant)", () => {
    const orders = new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "America/New_York",
    }).format(new Date(iso));
    expect(formatPlacedAt(iso, "en-US", "America/New_York")).toBe(orders);
  });
});

describe("KDS completed column shows the recent part of the shift", () => {
  const now = Date.parse("2026-11-16T15:00:00.000Z");
  const at = (minutesAgo: number) => new Date(now - minutesAgo * 60_000).toISOString();
  const order = (id: string, status: string, minutesAgo: number) => ({
    id,
    status,
    updatedAt: at(minutesAgo),
  });

  it("keeps only delivered tickets of the last two hours, most recent first", () => {
    const list = [
      order("old", "delivered", 15 * 60),
      order("a", "delivered", 30),
      order("b", "delivered", 5),
      order("edge", "delivered", 120),
      order("open", "ready", 1),
      order("too-old", "delivered", 121),
    ];
    expect(recentlyCompleted(list, now).map((o) => o.id)).toEqual(["b", "a", "edge"]);
    expect(COMPLETED_WINDOW_MS).toBe(2 * 60 * 60 * 1000);
  });

  it("shows at most ten tickets", () => {
    const list = Array.from({ length: 14 }, (_, i) => order(`t${i}`, "delivered", i));
    expect(recentlyCompleted(list, now)).toHaveLength(10);
    expect(recentlyCompleted(list, now)[0]?.id).toBe("t0");
  });
});
