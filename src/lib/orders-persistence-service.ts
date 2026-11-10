import type { Order, OrderStatus, OrderType } from "./orders-service";
import type { POSSession } from "./pos-service";
import {
  changeOperationalOrder,
  fetchOperationalOrders,
  submitOperationalSale,
} from "./operational.functions";
import type { SaleInput } from "./operational-contracts";
import { basisPointsFromPercent } from "./money";

// Server functions validate the session; RPCs enforce authorization and atomicity.
// No direct-table write or local-success fallback is permitted.

export interface OrderFilterOptions {
  orgId: string;
  locationId?: string | undefined;
  status?: OrderStatus;
  startDate?: string;
  endDate?: string;
  channel?: OrderType;
  limit?: number;
  offset?: number;
}

export interface PersistedOrderResult {
  orders: Order[];
  totalCount: number;
  unavailable?: boolean;
}

export async function fetchPersistedOrders(
  options: OrderFilterOptions,
): Promise<PersistedOrderResult> {
  try {
    return await fetchOperationalOrders({ data: options });
  } catch {
    return { orders: [], totalCount: 0, unavailable: true };
  }
}

export async function persistOrderToSupabase(
  orgId: string,
  order: Order,
): Promise<{ success: boolean; orderId?: string; error?: string }> {
  if (orgId !== order.orgId) return { success: false, error: "organization_mismatch" };
  try {
    return await submitOperationalSale({
      data: {
        orgId,
        locationId: order.locationId,
        clientOrderId: `persist-${order.id}`,
        orderType: order.type,
        customerName: order.customer.name,
        customerPhone: order.customer.phone,
        ...(order.customer.email ? { customerEmail: order.customer.email } : {}),
        ...(order.customer.deliveryAddress
          ? { deliveryAddress: order.customer.deliveryAddress }
          : {}),
        ...(order.customer.tableNumber ? { tableNumber: order.customer.tableNumber } : {}),
        ...(order.specialInstructions ? { notes: order.specialInstructions } : {}),
        discountCents: order.discountCents,
        taxRateBasisPoints: basisPointsFromPercent(order.taxRatePercent),
        items: saleItems(order.items),
        isSimulation: order.isSimulated,
      },
    });
  } catch (e) {
    return { success: false, error: message(e) };
  }
}

export async function cancelOrderWithReversal(
  orderId: string,
  reason?: string,
): Promise<{ success: boolean; alreadyCancelled?: boolean; error?: string }> {
  try {
    return await changeOperationalOrder({
      data: { id: orderId, status: "cancelled", ...(reason ? { reason } : {}) },
    });
  } catch (e) {
    return { success: false, error: message(e) };
  }
}

/** Server confirmation of a recorded sale: the values the receipt must show. */
export interface ConfirmedSale {
  success: boolean;
  orderId?: string;
  orderNumber?: string;
  subtotalCents?: number;
  taxCents?: number;
  totalCents?: number;
  isSimulation?: boolean;
  error?: string;
}

export async function persistFinalizedPOSSaleAtomic(
  session: POSSession,
  clientOrderId?: string,
): Promise<ConfirmedSale> {
  if (session.cart.length === 0) {
    return { success: false, error: "O carrinho está vazio." };
  }
  try {
    return await submitOperationalSale({
      data: {
        orgId: session.orgId,
        locationId: session.locationId,
        clientOrderId: clientOrderId ?? `pos-tx-${session.id}`,
        orderType: session.orderType,
        customerName: session.customerName ?? "Walk-in",
        discountCents: session.discountCents,
        taxRateBasisPoints: basisPointsFromPercent(session.taxRatePercent),
        items: saleItems(session.cart),
        paymentMethod: session.paymentMethod ?? "cash",
        isSimulation: false,
      },
    });
  } catch (e) {
    return { success: false, error: message(e) };
  }
}

export async function persistOrderStatusTransition(
  orderId: string,
  status: OrderStatus,
): Promise<{ success: boolean; error?: string }> {
  try {
    return await changeOperationalOrder({ data: { id: orderId, status } });
  } catch (e) {
    return { success: false, error: message(e) };
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : "operation_failed";
}
function saleItems(items: Order["items"]): SaleInput["items"] {
  return items.map((i) => ({
    productId: i.productId,
    quantity: i.quantity,
    ...(i.notes ? { notes: i.notes } : {}),
    modifiers: i.modifiers.map((m) => ({ groupId: m.groupId, optionId: m.optionId })),
  }));
}
