import { Order, KitchenStation, OrderStatus, saveOrder } from "./orders-service";

export interface KDSThresholds {
  warningMinutes: number;
  delayedMinutes: number;
}

export const DEFAULT_THRESHOLDS: KDSThresholds = {
  warningMinutes: 10,
  delayedMinutes: 20,
};

export function calculateElapsedMinutes(createdAtIso: string, now: Date = new Date()): number {
  const created = new Date(createdAtIso).getTime();
  const diffMs = Math.max(0, now.getTime() - created);
  return Math.floor(diffMs / 60000);
}

export function getTicketUrgency(
  createdAtIso: string,
  thresholds: KDSThresholds = DEFAULT_THRESHOLDS,
  now: Date = new Date(),
): "normal" | "warning" | "delayed" {
  const minutes = calculateElapsedMinutes(createdAtIso, now);
  if (minutes >= thresholds.delayedMinutes) return "delayed";
  if (minutes >= thresholds.warningMinutes) return "warning";
  return "normal";
}

export function assignDefaultStation(productName: string): KitchenStation {
  const lower = productName.toLowerCase();
  if (
    lower.includes("burger") ||
    lower.includes("patty") ||
    lower.includes("steak") ||
    lower.includes("smash")
  ) {
    return "grill";
  }
  if (
    lower.includes("fries") ||
    lower.includes("rings") ||
    lower.includes("crispy") ||
    lower.includes("fried")
  ) {
    return "fryer";
  }
  if (
    lower.includes("shake") ||
    lower.includes("soda") ||
    lower.includes("drink") ||
    lower.includes("beer") ||
    lower.includes("wine")
  ) {
    return "bar";
  }
  if (
    lower.includes("salad") ||
    lower.includes("wrap") ||
    lower.includes("taco") ||
    lower.includes("dessert")
  ) {
    return "assembly";
  }
  return "expo";
}

export function filterOrdersByStation(orders: Order[], station: KitchenStation | "all"): Order[] {
  if (station === "all") return orders;
  return orders.filter((order) =>
    order.items.some((item) => {
      const resolvedStation = item.station || assignDefaultStation(item.productName);
      return resolvedStation === station;
    }),
  );
}

/** Deduplicate orders favoring latest updated_at or non-simulated */
export function mergeKDSOrders(existing: Order[], incoming: Order[]): Order[] {
  const map = new Map<string, Order>();
  for (const ord of existing) {
    map.set(ord.id, ord);
  }
  for (const ord of incoming) {
    const curr = map.get(ord.id);
    if (!curr) {
      map.set(ord.id, ord);
      continue;
    }
    const currTime = new Date(curr.updatedAt || curr.createdAt).getTime();
    const incomingTime = new Date(ord.updatedAt || ord.createdAt).getTime();
    if (incomingTime >= currTime) {
      map.set(ord.id, ord);
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
}

export function simulateIncomingOrder(orgId: string, locationId: string): Order {
  const rand = Math.floor(1000 + Math.random() * 9000);
  const newOrder: Order = {
    id: `sim-kds-${Date.now()}`,
    orgId,
    locationId,
    orderNumber: `#${rand}`,
    type: Math.random() > 0.5 ? "dine_in" : "takeout",
    status: "new",
    customer: {
      name:
        ["Alex Reed", "Taylor Swift", "Jordan Lee", "Morgan Fox"][Math.floor(Math.random() * 4)] ||
        "Customer",
      phone: "+1 (555) 019-2834",
      tableNumber: `Table ${Math.floor(1 + Math.random() * 12)}`,
    },
    items: [
      {
        id: `si-${Date.now()}-1`,
        productId: "item-1",
        productName: "Double Cheeseburger",
        quantity: 1,
        basePriceCents: 1350,
        modifiers: [
          {
            groupId: "g1",
            groupName: "Cook",
            optionId: "o1",
            optionName: "Medium Rare",
            priceCents: 0,
          },
        ],
        subtotalCents: 1350,
        station: "grill",
        isItemReady: false,
      },
      {
        id: `si-${Date.now()}-2`,
        productId: "item-2",
        productName: "Seasoned Garlic Fries",
        quantity: 1,
        basePriceCents: 650,
        modifiers: [],
        subtotalCents: 650,
        station: "fryer",
        isItemReady: false,
      },
    ],
    subtotalCents: 2000,
    discountCents: 0,
    taxRatePercent: 8.875,
    taxCents: 178,
    totalCents: 2178,
    specialInstructions: "Rush order if possible",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    timeline: [
      {
        id: `tl-${Date.now()}`,
        toStatus: "new",
        timestamp: new Date().toISOString(),
        authorName: "Simulated KDS Engine",
      },
    ],
    isSimulated: true,
  };

  saveOrder(orgId, newOrder);
  return newOrder;
}
