/**
 * Historical capability marker, retained for import compatibility.
 *
 * Operational schema and RPCs were reconstructed in migrations 0012/0013.
 * Real operations now use operational.functions.ts with authenticated middleware.
 * The marker remains false until authenticated end-to-end homologation is complete;
 * it must not be used as proof of production readiness or a runtime authorization check.
 *
 * The original partial adapters remain preserved in docs/pending-migrations.
 */

export const ORDERS_BACKEND_AVAILABLE = false;

export const ORDERS_BACKEND_UNAVAILABLE = "orders_backend_unavailable" as const;

export const ORDERS_BACKEND_UNAVAILABLE_MESSAGE =
  "Order storage is not set up on the backend yet. The sale was NOT recorded.";

export interface OrdersBackendFailure {
  success: false;
  code: typeof ORDERS_BACKEND_UNAVAILABLE;
  error: string;
}

export function ordersBackendUnavailable(): OrdersBackendFailure {
  return {
    success: false,
    code: ORDERS_BACKEND_UNAVAILABLE,
    error: ORDERS_BACKEND_UNAVAILABLE_MESSAGE,
  };
}
