import { assertLocationAllowed, assertTenantContext, isLocationAllowed } from "./tenant-storage";
import { MenuItem } from "./menu-service";
import { persistFinalizedPOSSaleAtomic } from "./orders-persistence-service";
import {
  Order,
  OrderItem,
  OrderType,
  SelectedModifier,
  calculateOrderSummary,
  saveOrder,
} from "./orders-service";

export type POSPaymentMethod = "cash" | "card" | "digital";
export type PaymentMethod = POSPaymentMethod;

export type POSCartItem = OrderItem;
export type PosCartItem = POSCartItem;

export interface POSSession {
  id: string;
  orgId: string;
  locationId: string;
  cashierName: string;
  customerName?: string | undefined;
  orderType: OrderType;
  cart: POSCartItem[];
  discountCents: number;
  taxRatePercent: number;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  paymentMethod?: POSPaymentMethod;
  tenderedCents?: number;
  changeDueCents?: number;
  suspendedSessions: SuspendedSale[];
  completedAt?: string;
}

export interface SuspendedSale {
  id: string;
  orgId: string;
  locationId: string;
  note?: string | undefined;
  suspendedAt: string;
  orderType: OrderType;
  attendantName: string;
  customerName?: string | undefined;
  items: POSCartItem[];
  discountCents: number;
  taxRatePercent: number;
}

export interface CompletedPosSale {
  id: string;
  orderNumber: string;
  orgId: string;
  locationId: string;
  attendantName: string;
  orderType: OrderType;
  customerName?: string | undefined;
  items: POSCartItem[];
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  paymentMethod: POSPaymentMethod;
  tenderedCents: number;
  changeCents: number;
  createdAt: string;
  isSimulated: boolean;
  backendOrderId?: string;
}

const SUSPENDED_STORAGE_PREFIX = "servora.pos.suspended.";
const HISTORY_STORAGE_PREFIX = "servora.pos.history.";

export function calculateChange(tenderedCents: number, totalCents: number): number {
  return Math.max(0, tenderedCents - totalCents);
}

export function listSuspendedSales(
  orgId: string,
  locationId?: string,
  allowedLocationIds?: readonly string[],
): SuspendedSale[] {
  assertTenantContext(orgId);
  if (locationId && locationId !== "all" && !isLocationAllowed(locationId, allowedLocationIds))
    return [];
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(`${SUSPENDED_STORAGE_PREFIX}${assertTenantContext(orgId)}`);
  let sales: SuspendedSale[] = [];
  if (raw) {
    try {
      sales = (JSON.parse(raw) as SuspendedSale[]).filter(
        (s) => s.orgId === undefined || s.orgId === orgId,
      );
    } catch {
      sales = [];
    }
  }
  sales = sales.filter((s) => isLocationAllowed(s.locationId, allowedLocationIds));
  if (locationId && locationId !== "all") {
    return sales.filter((s) => s.locationId === locationId);
  }
  return sales;
}

export function suspendSale(
  orgId: string,
  sale: SuspendedSale,
  allowedLocationIds?: readonly string[],
): SuspendedSale[] {
  assertTenantContext(orgId);
  assertLocationAllowed(sale.locationId, allowedLocationIds);
  const existing = listSuspendedSales(orgId);
  const updated = [{ ...sale, orgId }, ...existing.filter((s) => s.id !== sale.id)];
  if (typeof window !== "undefined") {
    localStorage.setItem(
      `${SUSPENDED_STORAGE_PREFIX}${assertTenantContext(orgId)}`,
      JSON.stringify(updated),
    );
  }
  return updated;
}

export function removeSuspendedSale(
  orgId: string,
  saleId: string,
  allowedLocationIds?: readonly string[],
): SuspendedSale[] {
  const existing = listSuspendedSales(orgId);
  const target = existing.find((s) => s.id === saleId);
  if (target) assertLocationAllowed(target.locationId, allowedLocationIds);
  const updated = existing.filter((s) => s.id !== saleId);
  if (typeof window !== "undefined") {
    localStorage.setItem(
      `${SUSPENDED_STORAGE_PREFIX}${assertTenantContext(orgId)}`,
      JSON.stringify(updated),
    );
  }
  return updated;
}

export function listPosHistory(
  orgId: string,
  locationId?: string,
  allowedLocationIds?: readonly string[],
): CompletedPosSale[] {
  assertTenantContext(orgId);
  if (locationId && locationId !== "all" && !isLocationAllowed(locationId, allowedLocationIds))
    return [];
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(`${HISTORY_STORAGE_PREFIX}${assertTenantContext(orgId)}`);
  let list: CompletedPosSale[] = [];
  if (raw) {
    try {
      list = JSON.parse(raw) as CompletedPosSale[];
    } catch {
      list = [];
    }
  }
  list = list.filter((s) => isLocationAllowed(s.locationId, allowedLocationIds));
  if (locationId && locationId !== "all") {
    return list.filter((s) => s.locationId === locationId);
  }
  return list;
}

export function recordCompletedSale(
  orgId: string,
  sale: CompletedPosSale,
  allowedLocationIds?: readonly string[],
): { posHistory: CompletedPosSale[]; createdOrder: Order } {
  assertTenantContext(orgId);
  assertLocationAllowed(sale.locationId, allowedLocationIds);
  const existingHistory = listPosHistory(orgId);
  const posHistory = [sale, ...existingHistory];
  if (typeof window !== "undefined") {
    localStorage.setItem(
      `${HISTORY_STORAGE_PREFIX}${assertTenantContext(orgId)}`,
      JSON.stringify(posHistory),
    );
  }

  const createdOrder: Order = {
    id: sale.id,
    orgId,
    locationId: sale.locationId,
    orderNumber: sale.orderNumber,
    type: sale.orderType,
    status: "confirmed",
    customer: {
      name: sale.customerName || "POS Walk-in Guest",
      phone: "+1 (POS) 000-0000",
    },
    items: sale.items,
    subtotalCents: sale.subtotalCents,
    discountCents: sale.discountCents,
    taxRatePercent: 8.875,
    taxCents: sale.taxCents,
    totalCents: sale.totalCents,
    specialInstructions: `POS Sale by ${sale.attendantName} [Simulated ${sale.paymentMethod}]`,
    createdAt: sale.createdAt,
    updatedAt: sale.createdAt,
    timeline: [
      {
        id: `tl-${Date.now()}`,
        toStatus: "confirmed",
        timestamp: sale.createdAt,
        authorName: sale.attendantName,
        note: `POS completed sale via ${sale.paymentMethod} (Simulated)`,
      },
    ],
    isSimulated: true,
  };

  saveOrder(orgId, createdOrder);
  if (typeof window !== "undefined") {
    import("./orders-persistence-service")
      .then(({ persistOrderToSupabase }) => {
        void persistOrderToSupabase(orgId, createdOrder);
      })
      .catch(() => {});
  }
  return { posHistory, createdOrder };
}

export function buildCartItem(
  product: MenuItem,
  quantity: number,
  modifiers: SelectedModifier[],
  notes?: string,
): POSCartItem {
  const modSum = modifiers.reduce((acc, m) => acc + m.priceCents, 0);
  const itemTotal = (product.priceCents + modSum) * Math.max(1, quantity);
  return {
    id: `pos-item-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    productId: product.id,
    productName: product.name,
    quantity,
    basePriceCents: product.priceCents,
    modifiers,
    subtotalCents: itemTotal,
    notes,
  };
}

function recalculateSession(session: POSSession): POSSession {
  const summary = calculateOrderSummary(
    session.cart,
    session.taxRatePercent,
    session.discountCents,
  );
  return {
    ...session,
    subtotalCents: summary.subtotalCents,
    taxCents: summary.taxCents,
    totalCents: summary.totalCents,
  };
}

export function getPOSSession(
  orgId: string,
  locationId: string,
  cashierName: string,
  allowedLocationIds?: readonly string[],
): POSSession {
  assertTenantContext(orgId);
  assertLocationAllowed(locationId, allowedLocationIds);
  const suspended = listSuspendedSales(orgId, locationId, allowedLocationIds);
  return recalculateSession({
    id: `pos-${Date.now()}`,
    orgId,
    locationId,
    cashierName,
    orderType: "dine_in",
    cart: [],
    discountCents: 0,
    taxRatePercent: 8.875,
    subtotalCents: 0,
    taxCents: 0,
    totalCents: 0,
    suspendedSessions: suspended,
  });
}

export function savePOSSession(session: POSSession): POSSession {
  return recalculateSession(session);
}

export function addItemToCart(
  session: POSSession,
  product: MenuItem,
  modifiers: SelectedModifier[] = [],
  quantity: number = 1,
  notes?: string,
): POSSession {
  const item = buildCartItem(product, quantity, modifiers, notes);
  return recalculateSession({
    ...session,
    cart: [...session.cart, item],
  });
}

export function updateCartItemQuantity(
  session: POSSession,
  cartItemId: string,
  quantity: number,
): POSSession {
  const nextCart = session.cart.map((item) => {
    if (item.id !== cartItemId) return item;
    const modSum = item.modifiers.reduce((acc, m) => acc + m.priceCents, 0);
    return {
      ...item,
      quantity,
      subtotalCents: (item.basePriceCents + modSum) * Math.max(1, quantity),
    };
  });
  return recalculateSession({
    ...session,
    cart: nextCart,
  });
}

export function removeItemFromCart(session: POSSession, cartItemId: string): POSSession {
  return recalculateSession({
    ...session,
    cart: session.cart.filter((item) => item.id !== cartItemId),
  });
}

export function applyDiscount(session: POSSession, discountCents: number): POSSession {
  return recalculateSession({
    ...session,
    discountCents: Math.max(0, discountCents),
  });
}

export function setOrderType(session: POSSession, orderType: OrderType): POSSession {
  return { ...session, orderType };
}

export function setCustomerInfo(session: POSSession, customerName: string): POSSession {
  return { ...session, customerName };
}

export function suspendSession(session: POSSession, allowedLocationIds?: readonly string[]): void {
  if (session.cart.length === 0) return;
  const sale: SuspendedSale = {
    id: session.id,
    orgId: session.orgId,
    locationId: session.locationId,
    attendantName: session.cashierName,
    customerName: session.customerName,
    orderType: session.orderType,
    items: session.cart,
    discountCents: session.discountCents,
    taxRatePercent: session.taxRatePercent,
    suspendedAt: new Date().toISOString(),
  };
  suspendSale(session.orgId, sale, allowedLocationIds);
}

export function resumeSession(
  orgId: string,
  saleId: string,
  allowedLocationIds?: readonly string[],
): POSSession | null {
  const sales = listSuspendedSales(orgId, undefined, allowedLocationIds);
  const found = sales.find((s) => s.id === saleId);
  if (!found) return null;
  removeSuspendedSale(orgId, saleId, allowedLocationIds);
  const activeSuspended = listSuspendedSales(orgId, found.locationId, allowedLocationIds);
  return recalculateSession({
    id: found.id,
    orgId,
    locationId: found.locationId,
    cashierName: found.attendantName,
    customerName: found.customerName,
    orderType: found.orderType,
    cart: found.items,
    discountCents: found.discountCents,
    taxRatePercent: found.taxRatePercent,
    subtotalCents: 0,
    taxCents: 0,
    totalCents: 0,
    suspendedSessions: activeSuspended,
  });
}

export function simulatePayment(
  session: POSSession,
  method: POSPaymentMethod,
  tenderedCents: number,
): POSSession {
  const changeDueCents = method === "cash" ? calculateChange(tenderedCents, session.totalCents) : 0;
  return {
    ...session,
    paymentMethod: method,
    tenderedCents,
    changeDueCents,
  };
}

export function finalizeSale(session: POSSession): POSSession {
  const completed: CompletedPosSale = {
    id: session.id,
    orderNumber: `#POS-${session.id.slice(-4).toUpperCase()}`,
    orgId: session.orgId,
    locationId: session.locationId,
    attendantName: session.cashierName,
    orderType: session.orderType,
    customerName: session.customerName,
    items: session.cart,
    subtotalCents: session.subtotalCents,
    discountCents: session.discountCents,
    taxCents: session.taxCents,
    totalCents: session.totalCents,
    paymentMethod: session.paymentMethod || "cash",
    tenderedCents: session.tenderedCents || session.totalCents,
    changeCents: session.changeDueCents || 0,
    createdAt: new Date().toISOString(),
    isSimulated: true,
  };

  recordCompletedSale(session.orgId, completed);
  return {
    ...session,
    completedAt: completed.createdAt,
  };
}

export async function finalizeAndPersistSale(
  session: POSSession,
): Promise<{ session: POSSession; orderId?: string | undefined; error?: string | undefined }> {
  const res = await submitPosSaleToBackend(session);
  if (!res.success || !res.orderId) return { session, error: res.error ?? "sale_not_confirmed" };
  return {
    session: { ...session, completedAt: new Date().toISOString() },
    orderId: res.orderId,
    error: res.error,
  };
}

export async function submitPosSaleToBackend(
  session: POSSession,
): Promise<{ success: boolean; orderId?: string | undefined; error?: string | undefined }> {
  return persistFinalizedPOSSaleAtomic(session);
}
