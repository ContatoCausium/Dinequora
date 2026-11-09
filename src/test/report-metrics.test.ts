import { describe, expect, it } from "vitest";
import { buildReport, expensesInPeriod, isRecordedSale } from "@/lib/report-metrics";
import type { RecordedOrder } from "@/lib/recorded-data";

const order = (
  o: Partial<RecordedOrder> & Pick<RecordedOrder, "id" | "status" | "createdAt">,
): RecordedOrder =>
  ({
    orgId: "org",
    locationId: "store-a",
    orderNumber: "#X",
    type: "dine_in",
    customer: { name: "Guest", phone: "" },
    items: [
      {
        id: "i",
        productId: "p",
        productName: "Burger",
        quantity: 2,
        basePriceCents: 1000,
        subtotalCents: 2000,
        isItemReady: false,
        modifiers: [],
      },
    ],
    subtotalCents: 2000,
    discountCents: 0,
    taxRatePercent: 10,
    taxCents: 200,
    totalCents: 2200,
    updatedAt: o.createdAt,
    isSimulated: false,
    paid: true,
    timeline: [],
    ...o,
  }) as RecordedOrder;

describe("report metrics", () => {
  const now = new Date("2026-11-08T15:00:00Z");
  const orders = [
    order({ id: "1", status: "delivered", createdAt: "2026-11-08T13:00:00Z" }),
    order({
      id: "2",
      status: "confirmed",
      createdAt: "2026-11-07T13:00:00Z",
      locationId: "store-b",
      type: "delivery",
    }),
    order({ id: "3", status: "cancelled", createdAt: "2026-11-08T13:00:00Z" }),
    order({ id: "4", status: "new", createdAt: "2026-11-08T13:00:00Z", paid: false }),
    // unpaid tab already sent to the kitchen: not a sale
    order({ id: "7", status: "in_prep", createdAt: "2026-11-08T13:00:00Z", paid: false }),
    order({ id: "5", status: "delivered", createdAt: "2026-11-08T13:00:00Z", isSimulated: true }),
    order({ id: "6", status: "delivered", createdAt: "2026-10-01T13:00:00Z" }),
  ];

  it("counts only paid, non-cancelled, non-simulated orders as sales", () => {
    expect(orders.filter(isRecordedSale).map((o) => o.id)).toEqual(["1", "2", "6"]);
  });

  it("aggregates the period by day, store, channel and product", () => {
    const r = buildReport({
      orders,
      ledger: [],
      since: "2026-11-02T00:00:00Z",
      days: 7,
      timeZone: "UTC",
      now,
    });
    expect(r.orderCount).toBe(2);
    expect(r.avgTicketCents).toBe(2000); // net of tax
    expect(r.daily).toHaveLength(7);
    expect(r.daily.at(-1)).toEqual({ day: "2026-11-08", cents: 2000 });
    expect(r.daysWithSales).toBe(2);
    expect(r.byStore.map((s) => s.locationId).sort()).toEqual(["store-a", "store-b"]);
    expect(r.byChannel.find((c) => c.channel === "delivery")?.orders).toBe(1);
    expect(r.products).toEqual([{ name: "Burger", qty: 4, cents: 4000 }]);
  });

  it("includes only expenses whose competency date is inside the period", () => {
    const ex = [
      { competencyDate: "2026-11-01", isSimulation: false, amountCents: 100 },
      { competencyDate: "2026-10-31", isSimulation: false, amountCents: 50 },
      { competencyDate: "2026-11-05", isSimulation: true, amountCents: 999 },
    ];
    expect(expensesInPeriod(ex, "2026-11-01", "2026-11-08")).toBe(100);
  });
});
