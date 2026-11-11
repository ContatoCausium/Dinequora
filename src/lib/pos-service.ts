import { assertLocationAllowed, assertTenantContext, isLocationAllowed } from "./tenant-storage";
import { MenuItem } from "./menu-service";
import { OrderItem, OrderType, SelectedModifier, calculateOrderSummary } from "./orders-service";
import { isCents, isRatePpm } from "./money";

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
  /**
   * The store's configured sales-tax rate in parts per million (migration 0025); null when the
   * store has no rate yet, which blocks the checkout (the server refuses such a sale too).
   */
  taxRatePpm: number | null;
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
  /** Informational: the rate shown when the ticket was held. Resuming always re-applies the store's current rate. */
  taxRatePpm?: number | null | undefined;
}

/**
 * A sale can be recorded only when the store has a configured rate. The rate itself is never
 * chosen here: it comes from the store (workspace locations) and the server charges its own copy,
 * refusing a ticket whose displayed rate differs (tax_rate_changed).
 */
export function posTaxConfigured(session: Pick<POSSession, "taxRatePpm">): boolean {
  return session.taxRatePpm !== null;
}

const SUSPENDED_STORAGE_PREFIX = "servora.pos.suspended.";

/**
 * Held tickets belong to a shift. After this window they are no longer offered for resumption,
 * so customer names do not linger on a shared terminal and stale carts are not rung up later.
 */
export const SUSPENDED_SALE_TTL_MS = 24 * 60 * 60 * 1000;
export const QUARANTINE_SUSPENDED_PREFIX = "servora.quarantine.pos.suspended.";

const isValidSuspended = (s: unknown, orgId: string): s is SuspendedSale => {
  if (typeof s !== "object" || s === null) return false;
  const r = s as Partial<SuspendedSale>;
  return (
    typeof r.id === "string" &&
    r.id !== "" &&
    (r.orgId === undefined || r.orgId === orgId) &&
    typeof r.locationId === "string" &&
    r.locationId !== "" &&
    Array.isArray(r.items) &&
    r.items.length > 0 &&
    // Amounts must be whole cents: a corrupted ticket goes to quarantine instead of breaking the
    // POS when its totals are recalculated (P2).
    r.items.every(
      (i) =>
        typeof i === "object" &&
        i !== null &&
        isCents(i.basePriceCents) &&
        isCents(i.subtotalCents) &&
        Number.isSafeInteger(i.quantity) &&
        i.quantity > 0 &&
        (i.modifiers === undefined ||
          (Array.isArray(i.modifiers) && i.modifiers.every((m) => isCents(m?.priceCents)))),
    ) &&
    (r.discountCents === undefined || isCents(r.discountCents)) &&
    // Tickets held before 0025 carry taxRatePercent instead; both are informational only.
    (r.taxRatePpm === undefined || r.taxRatePpm === null || isRatePpm(r.taxRatePpm)) &&
    typeof r.suspendedAt === "string" &&
    !Number.isNaN(Date.parse(r.suspendedAt))
  );
};

/**
 * Reads the org's held tickets (key `servora.pos.suspended.<org>`, unchanged for compatibility).
 * Expired, malformed or unreadable entries are never offered; they are moved (not deleted) to
 * `servora.quarantine.pos.suspended.<org>` so nothing the user typed is silently destroyed.
 */
function readSuspendedStore(orgId: string, now = Date.now()): SuspendedSale[] {
  const key = `${SUSPENDED_STORAGE_PREFIX}${assertTenantContext(orgId)}`;
  const raw = localStorage.getItem(key);
  if (!raw) return [];
  let entries: unknown[];
  try {
    const parsed: unknown = JSON.parse(raw);
    entries = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    entries = [{ unreadable: raw }];
  }
  const keep: SuspendedSale[] = [];
  const quarantine: unknown[] = [];
  for (const s of entries) {
    if (isValidSuspended(s, orgId) && now - Date.parse(s.suspendedAt) <= SUSPENDED_SALE_TTL_MS)
      keep.push(s);
    else quarantine.push(s);
  }
  if (quarantine.length > 0) {
    try {
      const qKey = `${QUARANTINE_SUSPENDED_PREFIX}${orgId}`;
      let prev: unknown = [];
      try {
        prev = JSON.parse(localStorage.getItem(qKey) ?? "[]");
      } catch {
        prev = [];
      }
      const at = new Date(now).toISOString();
      const stamped = quarantine.map((entry) => ({ quarantinedAt: at, entry }));
      localStorage.setItem(
        qKey,
        JSON.stringify([...(Array.isArray(prev) ? prev : []), ...stamped]),
      );
      localStorage.setItem(key, JSON.stringify(keep));
    } catch {
      // Storage full/unavailable: leave the original key untouched; just don't offer the entries.
    }
  }
  return keep;
}

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
  let sales = readSuspendedStore(orgId);
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
  const summary = calculateOrderSummary(session.cart, session.taxRatePpm, session.discountCents);
  return {
    ...session,
    subtotalCents: summary.subtotalCents,
    taxCents: summary.taxCents,
    totalCents: summary.totalCents,
  };
}

/**
 * A new ticket for one store. `taxRatePpm` is the store's configured rate (null = not configured
 * yet); it is the only source of the rate the ticket previews and confirms to the server.
 */
export function getPOSSession(
  orgId: string,
  locationId: string,
  cashierName: string,
  allowedLocationIds?: readonly string[],
  taxRatePpm: number | null = null,
): POSSession {
  assertTenantContext(orgId);
  assertLocationAllowed(locationId, allowedLocationIds);
  if (taxRatePpm !== null && !isRatePpm(taxRatePpm))
    throw new RangeError("tax rate must be an integer between 0 and 1,000,000 ppm");
  const suspended = listSuspendedSales(orgId, locationId, allowedLocationIds);
  return recalculateSession({
    id: `pos-${Date.now()}`,
    orgId,
    locationId,
    cashierName,
    orderType: "dine_in",
    cart: [],
    discountCents: 0,
    taxRatePpm,
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
    taxRatePpm: session.taxRatePpm,
    suspendedAt: new Date().toISOString(),
  };
  suspendSale(session.orgId, sale, allowedLocationIds);
}

/**
 * Resumes a held ticket with the store's CURRENT rate (`taxRatePpm`), never the rate it was held
 * with: a rate changed while the ticket waited is applied before the customer is charged.
 */
export function resumeSession(
  orgId: string,
  saleId: string,
  allowedLocationIds?: readonly string[],
  taxRatePpm: number | null = null,
): POSSession | null {
  if (taxRatePpm !== null && !isRatePpm(taxRatePpm))
    throw new RangeError("tax rate must be an integer between 0 and 1,000,000 ppm");
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
    taxRatePpm,
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
