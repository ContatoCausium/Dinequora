import { describe, it, expect } from "vitest";
import {
  calculateElapsedMinutes,
  getTicketUrgency,
  assignDefaultStation,
  filterOrdersByStation,
  mergeKDSOrders,
  DEFAULT_THRESHOLDS,
} from "@/lib/kds-service";
import { Order } from "../lib/orders-service";

describe("kds-service", () => {
  it("calculates elapsed minutes accurately", () => {
    const now = new Date("2026-05-10T12:30:00Z");
    const tenMinAgo = new Date("2026-05-10T12:20:00Z").toISOString();
    expect(calculateElapsedMinutes(tenMinAgo, now)).toBe(10);
  });

  it("determines urgency correctly according to thresholds", () => {
    const now = new Date("2026-05-10T12:30:00Z");
    const normalTime = new Date("2026-05-10T12:25:00Z").toISOString(); // 5m
    const warnTime = new Date("2026-05-10T12:18:00Z").toISOString(); // 12m
    const delayTime = new Date("2026-05-10T12:05:00Z").toISOString(); // 25m

    expect(getTicketUrgency(normalTime, DEFAULT_THRESHOLDS, now)).toBe("normal");
    expect(getTicketUrgency(warnTime, DEFAULT_THRESHOLDS, now)).toBe("warning");
    expect(getTicketUrgency(delayTime, DEFAULT_THRESHOLDS, now)).toBe("delayed");
  });

  it("assigns default stations by product name semantics", () => {
    expect(assignDefaultStation("Classic Double Burger")).toBe("grill");
    expect(assignDefaultStation("Truffle Rosemary Fries")).toBe("fryer");
    expect(assignDefaultStation("Vanilla Bourbon Milkshake")).toBe("bar");
    expect(assignDefaultStation("Caesar Salad Bowl")).toBe("assembly");
  });

  it("filters orders by kitchen station", () => {
    const mockOrders: Order[] = [
      {
        id: "ord-1",
        orgId: "org-1",
        locationId: "loc-1",
        orderNumber: "#101",
        type: "dine_in",
        status: "new",
        customer: { name: "John", phone: "123" },
        items: [
          {
            id: "i-1",
            productId: "p-1",
            productName: "Smash Burger",
            quantity: 1,
            basePriceCents: 1000,
            modifiers: [],
            subtotalCents: 1000,
            station: "grill",
          },
        ],
        subtotalCents: 1000,
        discountCents: 0,
        taxRatePercent: 8.875,
        taxCents: 89,
        totalCents: 1089,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        timeline: [],
        isSimulated: true,
      },
      {
        id: "ord-2",
        orgId: "org-1",
        locationId: "loc-1",
        orderNumber: "#102",
        type: "takeout",
        status: "new",
        customer: { name: "Jane", phone: "456" },
        items: [
          {
            id: "i-2",
            productId: "p-2",
            productName: "Fries Basket",
            quantity: 1,
            basePriceCents: 500,
            modifiers: [],
            subtotalCents: 500,
            station: "fryer",
          },
        ],
        subtotalCents: 500,
        discountCents: 0,
        taxRatePercent: 8.875,
        taxCents: 44,
        totalCents: 544,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        timeline: [],
        isSimulated: true,
      },
    ];

    const grillOnly = filterOrdersByStation(mockOrders, "grill");
    expect(grillOnly.length).toBe(1);
    expect(grillOnly[0]?.orderNumber).toBe("#101");

    const all = filterOrdersByStation(mockOrders, "all");
    expect(all.length).toBe(2);
  });

  it("deduplicates and merges orders respecting update timestamps", () => {
    const initial: Order[] = [
      {
        id: "ord-1",
        orgId: "org-1",
        locationId: "loc-1",
        orderNumber: "#101",
        type: "dine_in",
        status: "new",
        customer: { name: "A", phone: "" },
        isSimulated: false,
        items: [],
        subtotalCents: 1000,
        discountCents: 0,
        taxRatePercent: 8,
        taxCents: 80,
        totalCents: 1080,
        createdAt: "2026-05-10T12:00:00Z",
        updatedAt: "2026-05-10T12:00:00Z",
        timeline: [],
      },
    ];

    const incoming: Order[] = [
      {
        id: "ord-1",
        orgId: "org-1",
        locationId: "loc-1",
        orderNumber: "#101",
        type: "dine_in",
        status: "in_prep",
        customer: { name: "A", phone: "" },
        isSimulated: false,
        items: [],
        subtotalCents: 1000,
        discountCents: 0,
        taxRatePercent: 8,
        taxCents: 80,
        totalCents: 1080,
        createdAt: "2026-05-10T12:00:00Z",
        updatedAt: "2026-05-10T12:05:00Z",
        timeline: [],
      },
      {
        id: "ord-2",
        orgId: "org-1",
        locationId: "loc-1",
        orderNumber: "#102",
        type: "takeout",
        status: "new",
        customer: { name: "B", phone: "" },
        isSimulated: false,
        items: [],
        subtotalCents: 500,
        discountCents: 0,
        taxRatePercent: 8,
        taxCents: 40,
        totalCents: 540,
        createdAt: "2026-05-10T12:06:00Z",
        updatedAt: "2026-05-10T12:06:00Z",
        timeline: [],
      },
    ];

    const merged = mergeKDSOrders(initial, incoming);
    expect(merged.length).toBe(2);
    const ord1 = merged.find((o) => o.id === "ord-1");
    expect(ord1?.status).toBe("in_prep");
  });

  it("handles duplicate realtime events without corrupting order state", () => {
    const initial: Order[] = [
      {
        id: "ord-dup-1",
        orgId: "org-1",
        locationId: "loc-1",
        orderNumber: "#201",
        type: "dine_in",
        status: "new",
        customer: { name: "Test Guest", phone: "" },
        isSimulated: false,
        items: [],
        subtotalCents: 1200,
        discountCents: 0,
        taxRatePercent: 8,
        taxCents: 96,
        totalCents: 1296,
        createdAt: "2026-05-10T14:00:00Z",
        updatedAt: "2026-05-10T14:00:00Z",
        timeline: [],
      },
    ];

    const duplicatePayload: Order[] = [
      { ...initial[0]!, updatedAt: "2026-05-10T14:00:00Z" },
      { ...initial[0]!, updatedAt: "2026-05-10T14:00:00Z" },
    ];

    const result = mergeKDSOrders(initial, duplicatePayload);
    expect(result.length).toBe(1);
    expect(result[0]?.id).toBe("ord-dup-1");
  });

  it("merges updated status correctly when reconnected after offline period", () => {
    const staleOrder: Order = {
      id: "ord-offline-1",
      orgId: "org-1",
      locationId: "loc-1",
      orderNumber: "#301",
      type: "dine_in",
      status: "new",
      customer: { name: "Offline Customer", phone: "" },
      isSimulated: false,
      items: [],
      subtotalCents: 1500,
      discountCents: 0,
      taxRatePercent: 8.25,
      taxCents: 124,
      totalCents: 1624,
      createdAt: "2026-05-10T15:00:00Z",
      updatedAt: "2026-05-10T15:00:00Z",
      timeline: [],
    };

    const refetchedOrder: Order = {
      ...staleOrder,
      status: "ready",
      updatedAt: "2026-05-10T15:12:00Z",
    };

    const merged = mergeKDSOrders([staleOrder], [refetchedOrder]);
    expect(merged.length).toBe(1);
    expect(merged[0]?.status).toBe("ready");
  });

  it("preserves station routing even with empty item lists", () => {
    const emptyOrder: Order = {
      id: "ord-empty",
      orgId: "org-1",
      locationId: "loc-1",
      orderNumber: "#302",
      type: "takeout",
      status: "new",
      customer: { name: "Empty Cart", phone: "" },
      isSimulated: false,
      items: [],
      subtotalCents: 0,
      discountCents: 0,
      taxRatePercent: 8.25,
      taxCents: 0,
      totalCents: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      timeline: [],
    };

    const allFiltered = filterOrdersByStation([emptyOrder], "all");
    expect(allFiltered.length).toBe(1);

    const grillFiltered = filterOrdersByStation([emptyOrder], "grill");
    expect(grillFiltered.length).toBe(0);
  });
});
