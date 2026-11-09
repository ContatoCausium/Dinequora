import { assertLocationAllowed, assertTenantContext, isLocationAllowed } from "./tenant-storage";
import { MenuItem, ModifierGroup, ModifierOption } from "./menu-service";

export type OrderType = "dine_in" | "takeout" | "delivery";

export type OrderStatus = "new" | "confirmed" | "in_prep" | "ready" | "delivered" | "cancelled";

export interface SelectedModifier {
  groupId: string;
  groupName: string;
  optionId: string;
  optionName: string;
  priceCents: number;
}

export type KitchenStation = "grill" | "fryer" | "assembly" | "bar" | "expo";

export interface OrderItem {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  basePriceCents: number;
  modifiers: SelectedModifier[];
  subtotalCents: number;
  notes?: string | undefined;
  station?: KitchenStation;
  isItemReady?: boolean;
}

export interface OrderTimelineEntry {
  id: string;
  fromStatus?: OrderStatus;
  toStatus: OrderStatus;
  timestamp: string;
  authorName: string;
  note?: string | undefined;
}

export interface CustomerInfo {
  name: string;
  phone: string;
  email?: string;
  tableNumber?: string;
  deliveryAddress?: string;
}

export interface Order {
  id: string;
  orgId: string;
  locationId: string;
  orderNumber: string;
  type: OrderType;
  status: OrderStatus;
  customer: CustomerInfo;
  items: OrderItem[];
  subtotalCents: number;
  discountCents: number;
  taxRatePercent: number;
  taxCents: number;
  totalCents: number;
  specialInstructions?: string;
  createdAt: string;
  updatedAt: string;
  timeline: OrderTimelineEntry[];
  isSimulated: boolean;
}

const STORAGE_PREFIX = "servora.orders.";

export function calculateItemTotal(
  basePriceCents: number,
  quantity: number,
  modifiers: SelectedModifier[],
): number {
  const modSum = modifiers.reduce((acc, m) => acc + m.priceCents, 0);
  return (basePriceCents + modSum) * Math.max(1, quantity);
}

export function calculateOrderSummary(
  items: OrderItem[],
  taxRatePercent: number = 8.875,
  discountCents: number = 0,
): { subtotalCents: number; taxCents: number; totalCents: number } {
  const subtotalCents = items.reduce((acc, item) => acc + item.subtotalCents, 0);
  const taxableCents = Math.max(0, subtotalCents - discountCents);
  const taxCents = Math.round((taxableCents * taxRatePercent) / 100);
  const totalCents = taxableCents + taxCents;
  return { subtotalCents, taxCents, totalCents };
}

function getStorageKey(orgId: string): string {
  return `${STORAGE_PREFIX}${assertTenantContext(orgId)}`;
}

export function getInitialDemoOrders(orgId: string, locationId: string): Order[] {
  const now = new Date();
  const subHours = (h: number) => new Date(now.getTime() - h * 3600000).toISOString();

  return [
    {
      id: `ord-${orgId}-101`,
      orgId,
      locationId,
      orderNumber: "#1042",
      type: "dine_in",
      status: "in_prep",
      customer: {
        name: "Sarah Jenkins",
        phone: "+1 (212) 555-0144",
        tableNumber: "Table 4",
      },
      items: [
        {
          id: "oi-1",
          productId: "item-1",
          productName: "The Classic Double Smash",
          quantity: 2,
          basePriceCents: 1450,
          modifiers: [
            {
              groupId: "mg-temp",
              groupName: "Patty Cook Temperature",
              optionId: "opt-med",
              optionName: "Medium",
              priceCents: 0,
            },
            {
              groupId: "mg-extras",
              groupName: "Add Extra Goodness",
              optionId: "opt-bacon",
              optionName: "Applewood Smoked Bacon",
              priceCents: 250,
            },
          ],
          subtotalCents: 3400,
          notes: "Extra napkins please",
        },
        {
          id: "oi-2",
          productId: "item-2",
          productName: "Truffle Rosemary Fries",
          quantity: 1,
          basePriceCents: 750,
          modifiers: [
            {
              groupId: "mg-sauce",
              groupName: "Dipping Sauce",
              optionId: "opt-aioli",
              optionName: "House Garlic Aioli",
              priceCents: 0,
            },
          ],
          subtotalCents: 750,
        },
      ],
      subtotalCents: 4150,
      discountCents: 0,
      taxRatePercent: 8.875,
      taxCents: 368,
      totalCents: 4518,
      specialInstructions: "Serve fries first if ready",
      createdAt: subHours(0.3),
      updatedAt: subHours(0.1),
      timeline: [
        { id: "tl-1", toStatus: "new", timestamp: subHours(0.3), authorName: "Sarah (Online POS)" },
        {
          id: "tl-2",
          fromStatus: "new",
          toStatus: "confirmed",
          timestamp: subHours(0.2),
          authorName: "Shift Manager",
        },
        {
          id: "tl-3",
          fromStatus: "confirmed",
          toStatus: "in_prep",
          timestamp: subHours(0.1),
          authorName: "Kitchen Lead",
        },
      ],
      isSimulated: true,
    },
    {
      id: `ord-${orgId}-102`,
      orgId,
      locationId,
      orderNumber: "#1043",
      type: "delivery",
      status: "new",
      customer: {
        name: "David Miller",
        phone: "+1 (347) 555-8910",
        deliveryAddress: "742 Evergreen Terrace, Apt 3B",
      },
      items: [
        {
          id: "oi-3",
          productId: "item-3",
          productName: "Salted Caramel Bourbon Shake",
          quantity: 2,
          basePriceCents: 850,
          modifiers: [
            {
              groupId: "mg-dairy",
              groupName: "Dairy Options",
              optionId: "opt-std",
              optionName: "Whole Milk Custard",
              priceCents: 0,
            },
          ],
          subtotalCents: 1700,
        },
      ],
      subtotalCents: 1700,
      discountCents: 200,
      taxRatePercent: 8.875,
      taxCents: 133,
      totalCents: 1633,
      specialInstructions: "Ring doorbell twice and leave on doorstep",
      createdAt: subHours(0.05),
      updatedAt: subHours(0.05),
      timeline: [
        {
          id: "tl-4",
          toStatus: "new",
          timestamp: subHours(0.05),
          authorName: "Direct Web Ordering",
        },
      ],
      isSimulated: true,
    },
    {
      id: `ord-${orgId}-103`,
      orgId,
      locationId,
      orderNumber: "#1040",
      type: "takeout",
      status: "ready",
      customer: {
        name: "Emma Watson",
        phone: "+1 (646) 555-2233",
      },
      items: [
        {
          id: "oi-4",
          productId: "item-1",
          productName: "The Classic Double Smash",
          quantity: 1,
          basePriceCents: 1450,
          modifiers: [],
          subtotalCents: 1450,
        },
      ],
      subtotalCents: 1450,
      discountCents: 0,
      taxRatePercent: 8.875,
      taxCents: 129,
      totalCents: 1579,
      createdAt: subHours(1.1),
      updatedAt: subHours(0.4),
      timeline: [
        { id: "tl-5", toStatus: "new", timestamp: subHours(1.1), authorName: "Counter Staff" },
        {
          id: "tl-6",
          fromStatus: "new",
          toStatus: "confirmed",
          timestamp: subHours(0.9),
          authorName: "Counter Staff",
        },
        {
          id: "tl-7",
          fromStatus: "confirmed",
          toStatus: "in_prep",
          timestamp: subHours(0.7),
          authorName: "Kitchen Lead",
        },
        {
          id: "tl-8",
          fromStatus: "in_prep",
          toStatus: "ready",
          timestamp: subHours(0.4),
          authorName: "Kitchen Lead",
        },
      ],
      isSimulated: true,
    },
  ];
}

export function listOrders(
  orgId: string,
  locationId?: string,
  allowedLocationIds?: readonly string[],
): Order[] {
  assertTenantContext(orgId);
  if (locationId && locationId !== "all" && !isLocationAllowed(locationId, allowedLocationIds))
    return [];
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(getStorageKey(orgId));
  let orders: Order[] = [];
  if (raw) {
    try {
      orders = JSON.parse(raw) as Order[];
    } catch {
      orders = [];
    }
  }
  // Example orders are generated only for the demo organization, never for real ones.
  if (raw === null && orgId === "demo") {
    orders = getInitialDemoOrders(orgId, locationId && locationId !== "all" ? locationId : "loc-1");
    localStorage.setItem(getStorageKey(orgId), JSON.stringify(orders));
  }
  orders = orders.filter((o) => o.orgId === undefined || o.orgId === orgId);
  orders = orders.filter((o) => isLocationAllowed(o.locationId, allowedLocationIds));

  if (locationId && locationId !== "all") {
    return orders.filter((o) => o.locationId === locationId);
  }
  return orders;
}

export function saveOrder(
  orgId: string,
  order: Order,
  allowedLocationIds?: readonly string[],
): Order[] {
  assertTenantContext(orgId);
  assertLocationAllowed(order.locationId, allowedLocationIds);
  const existing = listOrders(orgId);
  const previous = existing.find((o) => o.id === order.id);
  if (previous) assertLocationAllowed(previous.locationId, allowedLocationIds);
  const index = existing.findIndex((o) => o.id === order.id);
  const updated =
    index >= 0 ? existing.map((cur, i) => (i === index ? order : cur)) : [order, ...existing];
  if (typeof window !== "undefined") {
    localStorage.setItem(getStorageKey(orgId), JSON.stringify(updated));
  }
  return updated;
}

export function updateOrderStatus(
  orgId: string,
  orderId: string,
  newStatus: OrderStatus,
  authorName: string,
  note?: string,
  allowedLocationIds?: readonly string[],
): Order | null {
  const orders = listOrders(orgId, undefined, allowedLocationIds);
  const target = orders.find((o) => o.id === orderId);
  if (!target) return null;

  const timelineEntry: OrderTimelineEntry = {
    id: `tl-${Date.now()}`,
    fromStatus: target.status,
    toStatus: newStatus,
    timestamp: new Date().toISOString(),
    authorName,
    note,
  };

  const updated: Order = {
    ...target,
    status: newStatus,
    updatedAt: new Date().toISOString(),
    timeline: [timelineEntry, ...target.timeline],
  };

  saveOrder(orgId, updated, allowedLocationIds);
  if (!target.isSimulated && typeof window !== "undefined") {
    import("./orders-persistence-service")
      .then(({ persistOrderStatusTransition }) => {
        void persistOrderStatusTransition(orderId, newStatus);
      })
      .catch(() => {});
  }
  return updated;
}

export function toggleOrderItemReady(
  orgId: string,
  orderId: string,
  itemId: string,
  allowedLocationIds?: readonly string[],
): Order | null {
  const orders = listOrders(orgId, undefined, allowedLocationIds);
  const target = orders.find((o) => o.id === orderId);
  if (!target) return null;

  const updatedItems = target.items.map((it) =>
    it.id === itemId ? { ...it, isItemReady: !it.isItemReady } : it,
  );

  const updated: Order = {
    ...target,
    items: updatedItems,
    updatedAt: new Date().toISOString(),
  };

  saveOrder(orgId, updated, allowedLocationIds);
  return updated;
}

export function validateModifierSelection(
  group: ModifierGroup,
  selected: ModifierOption[],
): { valid: boolean; error?: string } {
  if (group.required && selected.length < (group.minSelections || 1)) {
    return {
      valid: false,
      error: `Select at least ${group.minSelections || 1} option for ${group.name}`,
    };
  }
  if (group.maxSelections && selected.length > group.maxSelections) {
    return {
      valid: false,
      error: `Select at most ${group.maxSelections} option(s) for ${group.name}`,
    };
  }
  return { valid: true };
}
