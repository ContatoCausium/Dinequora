import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const ORDER_LIST_SELECT =
  "*,order_items(*,order_item_modifiers(*)),order_status_history(*),payments(status)";

export interface OrderListParams {
  orgId: string;
  locationId?: string | undefined;
  status?: Database["public"]["Enums"]["order_status"] | undefined;
  /** Any of these statuses (the kitchen board reads only open tickets). */
  statuses?: readonly Database["public"]["Enums"]["order_status"][] | undefined;
  channel?: Database["public"]["Enums"]["order_type"] | undefined;
  startDate?: string | undefined;
  endDate?: string | undefined;
  offset: number;
  limit: number;
}

/**
 * One page of an organization's orders, newest first. Shared by the fetchOperationalOrders server
 * function and the database integration test so both run exactly the same query.
 *
 * The order is TOTAL: `created_at` alone is not unique (orders imported or created in the same
 * instant share it), and PostgreSQL may return tied rows in a different order on each page, which
 * repeats some orders and skips others across pages. `id` breaks every tie deterministically.
 */
export function orderListQuery(client: SupabaseClient<Database>, p: OrderListParams) {
  let q = client
    .from("orders")
    .select(ORDER_LIST_SELECT, { count: "exact" })
    .eq("org_id", p.orgId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(p.offset, p.offset + p.limit - 1);
  if (p.locationId) q = q.eq("location_id", p.locationId);
  if (p.status) q = q.eq("status", p.status);
  if (p.statuses?.length) q = q.in("status", [...p.statuses]);
  if (p.channel) q = q.eq("type", p.channel);
  if (p.startDate) q = q.gte("created_at", p.startDate);
  if (p.endDate) q = q.lte("created_at", p.endDate);
  return q;
}
