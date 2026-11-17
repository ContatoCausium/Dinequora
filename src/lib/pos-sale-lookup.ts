import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

/**
 * The POS sale recorded under an idempotency key (client_order_id), read with the caller's own
 * access (RLS) — wave 0 reconciliation of lost responses. A lookup error THROWS (never "not found"):
 * a failed query proves nothing about the sale.
 */
export async function lookupSaleByKey(
  client: SupabaseClient<Database>,
  input: { orgId: string; locationId: string; clientOrderId: string },
) {
  const { data: order, error } = await client
    .from("orders")
    .select("id,order_number,total_cents,tax_cents,subtotal_cents,is_simulation,status,location_id")
    .eq("org_id", input.orgId)
    .eq("client_order_id", input.clientOrderId.trim())
    .maybeSingle();
  if (error) throw new Error("sale_lookup_failed");
  if (!order) {
    // A key closed by an authorized person (resolve_pending_pos_sale, 0032) can never record a sale.
    const { data: voided, error: ve } = await client
      .from("pos_sale_key_voids")
      .select("created_at")
      .eq("org_id", input.orgId)
      .eq("client_order_id", input.clientOrderId.trim())
      .maybeSingle();
    if (ve) throw new Error("sale_lookup_failed");
    if (voided) return { status: "resolved" as const, resolvedAt: voided.created_at };
    return { status: "not_found" as const };
  }
  const { data: payments, error: pe } = await client
    .from("payments")
    .select("id,method")
    .eq("org_id", input.orgId)
    .eq("order_id", order.id);
  if (pe) throw new Error("sale_lookup_failed");
  return {
    status: "found" as const,
    orderId: order.id,
    orderNumber: order.order_number,
    totalCents: order.total_cents,
    taxCents: order.tax_cents,
    subtotalCents: order.subtotal_cents,
    isSimulation: order.is_simulation,
    orderStatus: order.status,
    sameStore: order.location_id === input.locationId,
    paid: (payments ?? []).length > 0,
    paymentMethod: payments?.[0]?.method ?? null,
  };
}
