import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { menuItemSchema, recipePayloadSchema, saleInputSchema } from "./operational-contracts";
import { orderListQuery } from "./orders-query";
import { toMenuReadModel } from "./menu-read-model";
import { readNavCounts } from "./nav-counts";
import { lookupSaleByKey } from "./pos-sale-lookup";
import { readLedgerSummaryAggregated } from "./ledger-aggregate";
import {
  TABLE_STATUSES,
  isTableStatus,
  summarizeDay,
  toDiningRoom,
  toOpenSessions,
} from "./dining-room";
import { localDay, shiftDay, startOfLocalDay } from "./store-time";
import { toCheckHistory, toClosedChecks } from "./check-history";
import { mapResources, type Resources } from "./operational-mappers";
import type { RecipeCost } from "./menu-engineering";
import {
  LedgerReadError,
  readLedgerRows,
  readLedgerSummary,
  type LedgerClient,
} from "./ledger-reader";

/** UI slugs are not UUIDs. Resolve them through user-scoped reads, never admin access. */
async function scope(client: SupabaseClient<Database>, orgId: string, locationId?: string) {
  const { data: organizations, error } = await client
    .from("organizations")
    .select("id,slug")
    .or(`id.eq.${uuidOrNil(orgId)},slug.eq.${safeSlug(orgId)}`);
  const org = organizations?.[0];
  if (error || !org) throw new Error("forbidden");
  const { data: locations, error: le } = await client
    .from("locations")
    .select("id,slug,timezone")
    .eq("org_id", org.id);
  if (le) throw new Error("forbidden");
  const location =
    locationId && locationId !== "all"
      ? locations?.find((l) => l.id === locationId || l.slug === locationId)
      : undefined;
  if (locationId && locationId !== "all" && !location) throw new Error("location_forbidden");
  return { org, locations: locations ?? [], location };
}
function uuidOrNil(value: string) {
  return z.string().uuid().safeParse(value).success
    ? value
    : "00000000-0000-0000-0000-000000000000";
}
function safeSlug(value: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error("invalid_context");
  return value;
}

export const fetchOperationalMenu = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  // includeArchived: only the Menu screen asks for archived categories (the POS and the inventory
  // screens keep the original two reads).
  .inputValidator(z.object({ orgId: z.string().min(1), includeArchived: z.boolean().optional() }))
  .handler(async ({ data, context }) => {
    const s = await scope(context.supabase, data.orgId);
    const [cats, archived, products] = await Promise.all([
      context.supabase
        .from("menu_categories")
        .select("*")
        .eq("org_id", s.org.id)
        .eq("active", true)
        .order("name"),
      data.includeArchived
        ? context.supabase
            .from("menu_categories")
            .select("id, client_id, name, description")
            .eq("org_id", s.org.id)
            .eq("active", false)
            .order("name")
        : Promise.resolve({ data: [], error: null }),
      context.supabase.from("menu_products").select("*").eq("org_id", s.org.id).order("name"),
    ]);
    if (cats.error || archived.error || products.error) throw new Error("menu_read_failed");
    return toMenuReadModel({
      orgSlug: s.org.slug,
      locations: s.locations,
      categories: cats.data ?? [],
      archivedCategories: archived.data ?? [],
      products: products.data ?? [],
    });
  });

export const saveOperationalMenu = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("category"),
        orgId: z.string().min(1),
        category: z.object({
          // Explicit intent, required by save_operational_menu since 0029 (strict contract): a
          // creation never overwrites, an edit never changes the active flag, a re-activation is
          // explicit. Deactivation is archiveOperationalMenu only.
          op: z.enum(["create", "update", "reactivate"]),
          id: z.string().min(1),
          name: z.string().min(1),
          description: z.string().optional(),
        }),
      }),
      z.object({ kind: z.literal("product"), orgId: z.string().min(1), item: menuItemSchema }),
    ]),
  )
  .handler(async ({ data, context }) => {
    const s = await scope(context.supabase, data.orgId);
    const payload =
      data.kind === "category"
        ? { ...data.category, description: data.category.description ?? "" }
        : {
            ...data.item,
            imageUrl: data.item.imageUrl ?? "",
            notes: data.item.notes ?? "",
            locationIds: data.item.locationIds.map((slug) => {
              const l = s.locations.find((l) => l.slug === slug || l.id === slug);
              if (!l) throw new Error("location_forbidden");
              return l.id;
            }),
          };
    const { data: id, error } = await context.supabase.rpc("save_operational_menu", {
      _org_id: s.org.id,
      _kind: data.kind,
      _payload: payload,
    });
    if (error || !id)
      throw await refused(
        context.supabase,
        error,
        s.org.id,
        `menu.${data.kind}`,
        undefined,
        "menu_save_failed",
      );
    return { id };
  });

export const archiveOperationalMenu = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      orgId: z.string().min(1),
      kind: z.enum(["category", "product"]),
      id: z.string().min(1),
    }),
  )
  .handler(async ({ data, context }) => {
    const s = await scope(context.supabase, data.orgId);
    const { error } = await context.supabase.rpc("archive_operational_menu", {
      _org_id: s.org.id,
      _kind: data.kind,
      _client_id: data.id,
    });
    if (error) throw await refused(context.supabase, error, s.org.id, `menu.archive_${data.kind}`);
    return { success: true };
  });

export const submitOperationalSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(saleInputSchema)
  .handler(async ({ data, context }) => {
    const s = await scope(context.supabase, data.orgId, data.locationId);
    if (!s.location) throw new Error("location_required");
    const args = {
      _org_id: s.org.id,
      _location_id: s.location.id,
      _type: data.orderType,
      _customer_name: data.customerName,
      _customer_phone: data.customerPhone ?? "",
      _customer_email: data.customerEmail ?? "",
      _delivery_address: data.deliveryAddress ?? "",
      _table_number: data.tableNumber ?? "",
      _notes: data.notes ?? "",
      _discount_cents: data.discountCents,
      _tax_rate_ppm: data.taxRatePpm,
      _is_simulation: data.isSimulation,
      _client_order_id: data.clientOrderId,
      _items: data.items.map((i) => ({
        product_id: i.productId,
        quantity: i.quantity,
        notes: i.notes ?? "",
        modifiers: i.modifiers.map((m) => ({ group_id: m.groupId, option_id: m.optionId })),
      })),
    };
    // v2 (migration 0025): the tax is computed from the store's configured rate; _tax_rate_ppm is
    // the rate the client displayed and must match it exactly.
    const result = data.paymentMethod
      ? await context.supabase.rpc("persist_finalized_pos_sale_atomic_v2", {
          ...args,
          _payment_method: data.paymentMethod,
        })
      : await context.supabase.rpc("create_pos_sale_v2", args);
    if (result.error || !result.data)
      throw await refused(
        context.supabase,
        result.error,
        s.org.id,
        "pos.sale",
        s.location.id,
        "sale_not_confirmed",
      );
    const { data: order, error } = await context.supabase
      .from("orders")
      .select("order_number,total_cents,tax_cents,subtotal_cents,is_simulation,status")
      .eq("id", result.data)
      .eq("org_id", s.org.id)
      .eq("location_id", s.location.id)
      .single();
    // The sale IS recorded (the RPC committed and returned its id): a failed read-back must never
    // be reported as a failed sale, or the operator would charge again (wave 0). The receipt
    // details are then fetched by the client through findSaleByClientOrderId.
    if (error || !order)
      return {
        success: true,
        orderId: result.data,
        readback: false as const,
      };
    // A resend of a ticket whose sale was recorded and later cancelled returns that order's id:
    // it must not be shown as a new recorded sale.
    if (order.status === "cancelled") throw new Error("order_cancelled");
    return {
      readback: true as const,
      success: true,
      orderId: result.data,
      orderNumber: order.order_number,
      totalCents: order.total_cents,
      taxCents: order.tax_cents,
      subtotalCents: order.subtotal_cents,
      // What was actually recorded: the receipt must describe the stored order, not the org type.
      isSimulation: order.is_simulation,
    };
  });

/**
 * Looks up a POS sale by the idempotency key the register sent (wave 0). Used to reconcile a sale
 * whose response was lost (timeout, network failure, reload): "found" is definitive; "not_found"
 * only means no sale with this key is visible NOW (the original request may still be on its way),
 * so the client keeps the sale pending and may resend it with the SAME key — the database returns
 * the existing order instead of creating a second one. RLS applies (the caller's own access).
 */
export const findSaleByClientOrderId = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      orgId: z.string().min(1),
      locationId: z.string().min(1),
      clientOrderId: z.string().min(1).max(160),
    }),
  )
  .handler(async ({ data, context }) => {
    const s = await scope(context.supabase, data.orgId, data.locationId);
    if (!s.location) throw new Error("location_required");
    return lookupSaleByKey(context.supabase, {
      orgId: s.org.id,
      locationId: s.location.id,
      clientOrderId: data.clientOrderId,
    });
  });

/**
 * Manual resolution of a pending POS sale (migration 0032, permission orders.resolve_pending).
 * The database takes the SAME advisory lock as the sale, looks the order up by its key and:
 *   - "recorded": the sale exists — nothing is closed; its details are returned for the receipt;
 *   - "resolved" / "already_resolved": no sale exists under the lock — the key is closed for good
 *     (create_pos_sale_v2 refuses it) and the operation is audited.
 * Any error (timeout, network, permission) is thrown: the register keeps the sale pending.
 */
export const resolvePendingSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      orgId: z.string().min(1),
      locationId: z.string().min(1),
      clientOrderId: z.string().min(1).max(160),
      reason: z.string().trim().min(10).max(500),
      amountCents: z.number().int().min(0).optional(),
      attempts: z.number().int().min(0).optional(),
      lastAttemptAt: z.string().datetime({ offset: true }).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const s = await scope(context.supabase, data.orgId, data.locationId);
    if (!s.location) throw new Error("location_required");
    const { data: res, error } = await context.supabase.rpc("resolve_pending_pos_sale", {
      _org_id: s.org.id,
      _location_id: s.location.id,
      _client_order_id: data.clientOrderId,
      _reason: data.reason,
      ...(data.amountCents === undefined ? {} : { _amount_cents: data.amountCents }),
      ...(data.attempts === undefined ? {} : { _attempts: data.attempts }),
      ...(data.lastAttemptAt === undefined ? {} : { _last_attempt_at: data.lastAttemptAt }),
    });
    if (error || !res)
      throw await refused(
        context.supabase,
        error,
        s.org.id,
        "pos.resolve_pending",
        s.location.id,
        "resolve_failed",
      );
    const status = (res as { status?: string }).status;
    if (status === "recorded") {
      const found = await lookupSaleByKey(context.supabase, {
        orgId: s.org.id,
        locationId: s.location.id,
        clientOrderId: data.clientOrderId,
      });
      return { status: "recorded" as const, order: found };
    }
    if (status === "resolved" || status === "already_resolved")
      return {
        status,
        resolvedAt: String((res as { resolved_at?: string }).resolved_at ?? ""),
      };
    throw new Error("resolve_failed");
  });

export const fetchOperationalOrders = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      orgId: z.string().min(1),
      locationId: z.string().optional(),
      status: z.enum(["new", "confirmed", "in_prep", "ready", "delivered", "cancelled"]).optional(),
      statuses: z
        .array(z.enum(["new", "confirmed", "in_prep", "ready", "delivered", "cancelled"]))
        .min(1)
        .max(6)
        .optional(),
      oldestFirst: z.boolean().optional(),
      channel: z.enum(["dine_in", "takeout", "delivery"]).optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      limit: z.number().int().min(1).max(200).default(50),
      offset: z.number().int().nonnegative().default(0),
    }),
  )
  .handler(async ({ data, context }) => {
    const s = await scope(context.supabase, data.orgId, data.locationId);
    // Total order (created_at, id): see orders-query.ts. Shared with the database integration test.
    const {
      data: rows,
      error,
      count,
    } = await orderListQuery(context.supabase, {
      orgId: s.org.id,
      locationId: s.location?.id,
      status: data.status,
      statuses: data.statuses,
      oldestFirst: data.oldestFirst,
      channel: data.channel,
      startDate: data.startDate,
      endDate: data.endDate,
      offset: data.offset,
      limit: data.limit,
    });
    if (error) throw new Error("orders_read_failed");
    return {
      totalCount: count ?? 0,
      orders: (rows ?? []).map((r) => ({
        id: r.id,
        orgId: s.org.slug,
        locationId: s.locations.find((l) => l.id === r.location_id)?.slug ?? r.location_id,
        orderNumber: r.order_number,
        type: r.type,
        status: r.status,
        customer: {
          name: r.customer_name,
          phone: r.customer_phone ?? "",
          ...(r.customer_email ? { email: r.customer_email } : {}),
          ...(r.table_number ? { tableNumber: r.table_number } : {}),
          ...(r.delivery_address ? { deliveryAddress: r.delivery_address } : {}),
        },
        items: r.order_items.map((i) => ({
          id: i.id,
          productId: i.product_id,
          productName: i.product_name,
          quantity: i.quantity,
          basePriceCents: i.unit_price_cents,
          subtotalCents: i.subtotal_cents,
          ...(i.notes ? { notes: i.notes } : {}),
          isItemReady: i.is_item_ready,
          modifiers: i.order_item_modifiers.map((m) => ({
            groupId: m.group_id,
            groupName: m.group_name,
            optionId: m.option_id,
            optionName: m.option_name,
            priceCents: m.price_cents,
          })),
        })),
        subtotalCents: r.subtotal_cents,
        discountCents: r.discount_cents,
        // Orders recorded before 0025 carry only basis points; 0025 back-filled ppm = bp × 100.
        taxRatePpm: r.tax_rate_ppm ?? r.tax_rate_basis_points * 100,
        taxCents: r.tax_cents,
        totalCents: r.total_cents,
        ...(r.notes ? { specialInstructions: r.notes } : {}),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        isSimulated: r.is_simulation,
        createdBy: r.created_by,
        /** Paid = a payment that was not reversed (what the ledger counts as revenue). */
        paid: r.payments.some((p) => p.status !== "reversed"),
        timeline: r.order_status_history.map((h) => ({
          id: h.id,
          ...(h.from_status ? { fromStatus: h.from_status } : {}),
          toStatus: h.to_status,
          timestamp: h.created_at,
          authorName: h.actor_id,
          ...(h.reason ? { note: h.reason } : {}),
        })),
      })),
    };
  });

export const changeOperationalOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      status: z.enum(["new", "confirmed", "in_prep", "ready", "delivered", "cancelled"]),
      reason: z.string().default("Operational status transition"),
    }),
  )
  .handler(async ({ data, context }) => {
    const result =
      data.status === "cancelled"
        ? await context.supabase.rpc("cancel_order_with_reversal", {
            _order_id: data.id,
            _reason: data.reason,
          })
        : await context.supabase.rpc("update_order_status", {
            _order_id: data.id,
            _new_status: data.status,
            _reason: data.reason,
          });
    if (result.error)
      throw await refused(
        context.supabase,
        result.error,
        await orderOrg(context.supabase, data.id),
        `orders.${data.status}`,
      );
    return { success: true };
  });
export const setOperationalItemReady = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid(), ready: z.boolean() }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("set_order_item_ready", {
      _item_id: data.id,
      _ready: data.ready,
    });
    if (error) throw await refused(context.supabase, error, undefined, "kds.item_ready");
    return { success: true };
  });

/** Readable columns of inventory_items / inventory_movements (costs excluded — migration 0020). */
const INVENTORY_COLUMNS =
  "id,org_id,location_id,client_id,name,category,sku,unit,quantity,min_quantity,supplier,expiration_date,active,updated_at";
const MOVEMENT_COLUMNS =
  "id,org_id,location_id,inventory_item_id,order_id,delta,kind,client_event_id,reverses_id,reason,actor_id,created_at";

/**
 * Sidebar counters (open orders, late kitchen tickets, low stock) in one small request, so the
 * 30 s refresh never pulls the full operational resources. Permission checks, RLS and the counting
 * rules live in nav-counts.ts. An unknown store is rejected by scope(), like every other read.
 */
export const fetchNavCounts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ orgId: z.string().min(1), locationId: z.string().optional() }))
  .handler(async ({ data, context }) => {
    const s = await scope(context.supabase, data.orgId, data.locationId);
    return readNavCounts(context.supabase, { orgId: s.org.id, locationId: s.location?.id });
  });

/** Stores of the request scope with their zones (database ids), for the ledger reader. */
function ledgerStores(s: Awaited<ReturnType<typeof scope>>) {
  return (s.location ? [s.location] : s.locations).map((l) => ({
    id: l.id,
    timeZone: l.timezone || "America/New_York",
  }));
}

/**
 * Financial ledger summary: day totals per store and kind for the last `days` local days of each
 * store (null = whole history). M2: aggregated by the database in one snapshot
 * (ledger_day_totals, migration 0031, SECURITY INVOKER). Where that function does not exist yet,
 * the wave-0 paged reader (ledger-reader.ts) reads every row or marks the result incomplete. RLS
 * still decides what the caller may read (finance_read: finance/dashboard/reports).
 */
export const fetchLedgerSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      orgId: z.string().min(1),
      locationId: z.string().optional(),
      days: z.number().int().min(1).max(3700).nullable(),
      sameTimeYesterday: z.boolean().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const s = await scope(context.supabase, data.orgId, data.locationId);
    const input = {
      orgId: s.org.id,
      stores: ledgerStores(s),
      days: data.days,
      sameTimeYesterday: data.sameTimeYesterday,
    };
    const aggregated = await readLedgerSummaryAggregated(context.supabase, input);
    if (aggregated) return aggregated;
    try {
      return await readLedgerSummary(context.supabase as unknown as LedgerClient, input);
    } catch (e) {
      if (e instanceof LedgerReadError) throw new Error("ledger_read_failed");
      throw e;
    }
  });

/**
 * Every ledger row (whole history) for the Finance export, read completely with keyset pagination
 * or marked incomplete when the export ceiling (50,000 rows) is reached.
 */
export const fetchLedgerRows = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ orgId: z.string().min(1), locationId: z.string().optional() }))
  .handler(async ({ data, context }) => {
    const s = await scope(context.supabase, data.orgId, data.locationId);
    try {
      return await readLedgerRows(context.supabase as unknown as LedgerClient, {
        orgId: s.org.id,
        stores: ledgerStores(s),
      });
    } catch (e) {
      if (e instanceof LedgerReadError) throw new Error("ledger_read_failed");
      throw e;
    }
  });

export const fetchOperationalResources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ orgId: z.string().min(1), locationId: z.string().optional() }))
  .handler(async ({ data, context }) => {
    const s = await scope(context.supabase, data.orgId, data.locationId);
    const c = context.supabase;
    // RLS scopes each query, including organization-wide reads by managers. The financial ledger
    // is NOT read here any more (wave 0): fetchLedgerSummary/fetchLedgerRows read it completely.
    const [inventory, recipes, suppliers, purchases, movements, expenses] = await Promise.all([
      c.from("inventory_items").select(INVENTORY_COLUMNS).eq("org_id", s.org.id),
      // The linked menu product (FK org_id, product_id) is the single source of the selling price
      // and the product name; recipe metadata only keeps a legacy copy.
      c
        .from("product_recipes")
        .select("*,recipe_ingredients(*),menu_products(name,price_cents)")
        .eq("org_id", s.org.id),
      c.from("suppliers").select("*").eq("org_id", s.org.id),
      c.from("purchase_orders").select("*,purchase_order_items(*)").eq("org_id", s.org.id),
      c
        .from("inventory_movements")
        .select(MOVEMENT_COLUMNS)
        .eq("org_id", s.org.id)
        .order("created_at", { ascending: false })
        .limit(200),
      c.from("finance_expenses").select("*").eq("org_id", s.org.id).eq("active", true),
    ]);
    if ([inventory, recipes, suppliers, purchases, movements, expenses].some((r) => r.error))
      throw new Error("resources_read_failed");
    // Costs are not readable through the table (migration 0020); they come only from the gated
    // function. Without inventory.costs the answer is "not visible" (null), never a fake zero.
    const costRead = await c.rpc("inventory_item_costs", { _org_id: s.org.id });
    if (costRead.error && costRead.error.message !== "permission_denied")
      throw new Error("resources_read_failed");
    const costs = costRead.error
      ? null
      : new Map((costRead.data ?? []).map((r) => [r.item_id, r.cost_cents]));
    const filter = <T extends { location_id: string }>(rows: T[]) =>
      s.location ? rows.filter((r) => r.location_id === s.location?.id) : rows;
    return {
      orgId: s.org.slug,
      locations: s.locations,
      costsVisible: costs !== null,
      inventory: filter(inventory.data ?? []).map((i) => ({
        ...i,
        cost_cents: costs?.get(i.id) ?? null,
      })),
      recipes: filter(recipes.data ?? []),
      suppliers: suppliers.data ?? [],
      purchases: filter(purchases.data ?? []),
      movements: filter(movements.data ?? []),
      expenses: filter(expenses.data ?? []),
    };
  });

export const saveOperationalRecord = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      orgId: z.string().min(1),
      locationId: z.string().optional(),
      kind: z.enum(["inventory", "recipe", "supplier", "purchase", "expense", "whatsapp"]),
      payload: z.record(z.unknown()),
    }),
  )
  .handler(async ({ data, context }) => {
    const s = await scope(context.supabase, data.orgId, data.locationId);
    if (!s.location && data.kind !== "supplier" && data.kind !== "whatsapp")
      throw new Error("location_required");
    // A recipe payload is exactly its definition: no cost snapshot can travel to the database
    // (migration 0024; the RPC never stores the ingredient list in metadata either).
    if (data.kind === "recipe" && !recipePayloadSchema.safeParse(data.payload).success)
      throw new Error("invalid_recipe");
    const payload = z
      .record(
        z.lazy((): z.ZodType<import("@/integrations/supabase/types").Json> =>
          z.union([
            z.string(),
            z.number(),
            z.boolean(),
            z.null(),
            z.array(z.lazy(() => jsonSchema)),
            z.record(z.lazy(() => jsonSchema)),
          ]),
        ),
      )
      .parse(data.payload);
    const { data: id, error } = await context.supabase.rpc("save_operational_record", {
      _org_id: s.org.id,
      _location_id: s.location?.id ?? "00000000-0000-0000-0000-000000000000",
      _kind: data.kind,
      _payload: payload,
    });
    if (error || !id)
      throw await refused(
        context.supabase,
        error,
        s.org.id,
        `${data.kind}.save`,
        s.location?.id,
        "record_save_failed",
      );
    return { id };
  });
/**
 * Turns an RPC error into the Error the UI sees. Permission refusals roll back their own transaction
 * (including its audit row), so they are reported separately via log_access_denied — which records
 * only the caller's own identity and ignores non-members (migration 0018).
 */
async function refused(
  client: SupabaseClient<Database>,
  error: { message: string; details?: string | null } | null,
  orgId: string | undefined,
  action: string,
  locationId?: string,
  fallback = "operation_failed",
): Promise<Error> {
  if (error?.message === "permission_denied" && orgId) {
    await client
      .rpc("log_access_denied", {
        _org_id: orgId,
        _action: action,
        ...(locationId ? { _location_id: locationId } : {}),
        ...(error.details ? { _detail: error.details } : {}),
      })
      .then(
        () => undefined,
        () => undefined,
      );
  }
  return new Error(error?.message ?? fallback);
}
const orderOrg = async (client: SupabaseClient<Database>, id: string) =>
  (await client.from("orders").select("org_id").eq("id", id).maybeSingle()).data?.org_id ??
  undefined;
const purchaseOrg = async (client: SupabaseClient<Database>, id: string) =>
  (await client.from("purchase_orders").select("org_id").eq("id", id).maybeSingle()).data?.org_id ??
  undefined;

const jsonSchema: z.ZodType<import("@/integrations/supabase/types").Json> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonSchema),
    z.record(jsonSchema),
  ]),
);

export const moveOperationalInventory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      orgId: z.string().min(1),
      locationId: z.string().min(1),
      itemId: z.string().uuid(),
      type: z.enum(["in", "out", "loss", "adjustment", "transfer"]),
      quantity: z.number().nonnegative(),
      reason: z.string().min(1),
      clientEventId: z.string().min(1),
      targetLocationId: z.string().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const s = await scope(context.supabase, data.orgId, data.locationId);
    if (!s.location) throw new Error("location_required");
    const target = data.targetLocationId
      ? s.locations.find((l) => l.id === data.targetLocationId || l.slug === data.targetLocationId)
      : undefined;
    if (data.type === "transfer" && !target) throw new Error("location_forbidden");
    const { data: id, error } = await context.supabase.rpc("record_operational_movement", {
      _org_id: s.org.id,
      _location_id: s.location.id,
      _item_id: data.itemId,
      _type: data.type,
      _quantity: data.quantity,
      _reason: data.reason,
      _client_event_id: data.clientEventId,
      ...(target ? { _target_location_id: target.id } : {}),
    });
    if (error || !id)
      throw await refused(
        context.supabase,
        error,
        s.org.id,
        `inventory.${data.type}`,
        s.location.id,
        "movement_failed",
      );
    return { id };
  });

export const receiveOperationalPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      id: z.string().uuid(),
      items: z.array(
        z.object({
          itemId: z.string().uuid(),
          receivedNow: z.number().nonnegative(),
          priceVerifiedCents: z.number().int().nonnegative(),
          divergenceReason: z.string(),
        }),
      ),
      clientEventId: z.string().min(1),
      notes: z.string(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { data: id, error } = await context.supabase.rpc("receive_operational_purchase", {
      _purchase_id: data.id,
      _items: data.items,
      _client_event_id: data.clientEventId,
      _notes: data.notes,
    });
    if (error || !id)
      throw await refused(
        context.supabase,
        error,
        await purchaseOrg(context.supabase, data.id),
        "purchases.receive",
        undefined,
        "receiving_failed",
      );
    return { id };
  });
export const cancelOperationalPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ id: z.string().uuid(), reason: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.rpc("cancel_operational_purchase", {
      _id: data.id,
      _reason: data.reason,
    });
    if (error)
      throw await refused(
        context.supabase,
        error,
        await purchaseOrg(context.supabase, data.id),
        "purchases.cancel",
      );
    return { success: true };
  });

export const fetchOperationalWhatsApp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ orgId: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    const s = await scope(context.supabase, data.orgId);
    const { data: records, error } = await context.supabase
      .from("whatsapp_records")
      .select("*")
      .eq("org_id", s.org.id)
      .order("created_at", { ascending: false });
    if (error) throw new Error("whatsapp_read_failed");
    return records ?? [];
  });

// ---------------------------------------------------------------- dining room (migration 0037)
// Reads go through RLS (tables.* permission at the store, feature table_service on); every write is
// one audited RPC that checks store, organization, permission and feature. A status change sends the
// status the screen showed: if someone changed the table meanwhile, nothing is written and the
// current status comes back (conflict) so the screen can refresh instead of overwriting it.
const DINING_SECTION_COLUMNS = "id,name,sort_order,archived_at";
const DINING_TABLE_COLUMNS =
  "id,label,seats,status,section_id,sort_order,status_changed_at,archived_at";
const diningStore = z.object({ orgId: z.string().min(1), locationId: z.string().min(1) });
async function diningScope(
  client: SupabaseClient<Database>,
  data: { orgId: string; locationId: string },
) {
  if (data.locationId === "all") throw new Error("location_required");
  const s = await scope(client, data.orgId, data.locationId);
  if (!s.location) throw new Error("location_required");
  return { orgId: s.org.id, locationId: s.location.id };
}

export const fetchDiningRoom = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(diningStore)
  .handler(async ({ data, context }) => {
    const s = await diningScope(context.supabase, data);
    const [sections, tables] = await Promise.all([
      context.supabase
        .from("dining_sections")
        .select(DINING_SECTION_COLUMNS)
        .eq("org_id", s.orgId)
        .eq("location_id", s.locationId)
        .is("archived_at", null),
      context.supabase
        .from("dining_tables")
        .select(DINING_TABLE_COLUMNS)
        .eq("org_id", s.orgId)
        .eq("location_id", s.locationId)
        .is("archived_at", null),
    ]);
    if (sections.error || tables.error) throw new Error("dining_read_failed");
    // Open sessions (0038): their checks, the rounds sent to the kitchen and the items of those orders.
    const c = context.supabase;
    const [sessions, store] = await Promise.all([
      c
        .from("dining_sessions")
        .select("id,table_id,guests,server_id,opened_at")
        .eq("org_id", s.orgId)
        .eq("location_id", s.locationId)
        .eq("status", "open"),
      c.from("locations").select("tax_rate_ppm").eq("id", s.locationId).maybeSingle(),
    ]);
    if (sessions.error || store.error) throw new Error("dining_read_failed");
    const sessionIds = (sessions.data ?? []).map((x) => x.id);
    const checks = sessionIds.length
      ? await c
          .from("dining_checks")
          .select("id,session_id,status,number,label")
          .in("session_id", sessionIds)
      : { data: [], error: null };
    if (checks.error) throw new Error("dining_read_failed");
    const checkIds = (checks.data ?? []).map((x) => x.id);
    const rounds = checkIds.length
      ? await c
          .from("dining_check_rounds")
          .select("check_id,order_id,round_no,fired_at")
          .in("check_id", checkIds)
      : { data: [], error: null };
    if (rounds.error) throw new Error("dining_read_failed");
    const orderIds = (rounds.data ?? []).map((x) => x.order_id);
    const tenders = checkIds.length
      ? await c
          .from("dining_check_payments")
          .select("id,check_id,method,amount_cents,tip_cents,change_cents,status,created_at")
          .in("check_id", checkIds)
      : { data: [], error: null };
    if (tenders.error) throw new Error("dining_read_failed");
    const serverIds = [...new Set((sessions.data ?? []).map((x) => x.server_id))];
    const [orders, items, profiles] = await Promise.all([
      orderIds.length
        ? c.from("orders").select("id,status,total_cents").in("id", orderIds)
        : Promise.resolve({ data: [], error: null }),
      orderIds.length
        ? c
            .from("order_items")
            .select(
              "order_id,product_name,quantity,subtotal_cents,notes,order_item_modifiers(option_name)",
            )
            .in("order_id", orderIds)
        : Promise.resolve({ data: [], error: null }),
      serverIds.length
        ? c.from("profiles").select("id,full_name").in("id", serverIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (orders.error || items.error || profiles.error) throw new Error("dining_read_failed");
    return toDiningRoom(s.locationId, sections.data ?? [], tables.data ?? [], {
      taxRatePpm: store.data?.tax_rate_ppm ?? null,
      sessions: toOpenSessions({
        sessions: sessions.data ?? [],
        checks: checks.data ?? [],
        rounds: rounds.data ?? [],
        orders: orders.data ?? [],
        items: items.data ?? [],
        profiles: profiles.data ?? [],
        tenders: tenders.data ?? [],
      }),
    });
  });

export const saveDiningSection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    diningStore.extend({
      id: z.string().uuid().nullable(),
      name: z.string().trim().min(1).max(60),
      sortOrder: z.number().int().min(0).max(9999).default(0),
    }),
  )
  .handler(async ({ data, context }) => {
    const s = await diningScope(context.supabase, data);
    const { data: id, error } = await context.supabase.rpc("save_dining_section", {
      _org_id: s.orgId,
      _location_id: s.locationId,
      ...(data.id ? { _section_id: data.id } : {}),
      _name: data.name,
      _sort_order: data.sortOrder,
    });
    if (error || !id)
      throw await refused(context.supabase, error, s.orgId, "tables.section_save", s.locationId);
    return { id };
  });

export const archiveDiningSection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(diningStore.extend({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const s = await diningScope(context.supabase, data);
    const { error } = await context.supabase.rpc("archive_dining_section", {
      _org_id: s.orgId,
      _location_id: s.locationId,
      _section_id: data.id,
    });
    if (error)
      throw await refused(context.supabase, error, s.orgId, "tables.section_archive", s.locationId);
    return { success: true };
  });

export const saveDiningTable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    diningStore.extend({
      id: z.string().uuid().nullable(),
      label: z.string().trim().min(1).max(20),
      seats: z.number().int().min(1).max(99),
      sectionId: z.string().uuid().nullable(),
      sortOrder: z.number().int().min(0).max(9999).default(0),
    }),
  )
  .handler(async ({ data, context }) => {
    const s = await diningScope(context.supabase, data);
    const { data: id, error } = await context.supabase.rpc("save_dining_table", {
      _org_id: s.orgId,
      _location_id: s.locationId,
      ...(data.id ? { _table_id: data.id } : {}),
      _label: data.label,
      _seats: data.seats,
      ...(data.sectionId ? { _section_id: data.sectionId } : {}),
      _sort_order: data.sortOrder,
    });
    if (error || !id)
      throw await refused(context.supabase, error, s.orgId, "tables.table_save", s.locationId);
    return { id };
  });

export const archiveDiningTable = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(diningStore.extend({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const s = await diningScope(context.supabase, data);
    const { error } = await context.supabase.rpc("archive_dining_table", {
      _org_id: s.orgId,
      _location_id: s.locationId,
      _table_id: data.id,
    });
    if (error)
      throw await refused(context.supabase, error, s.orgId, "tables.table_archive", s.locationId);
    return { success: true };
  });

export const setDiningTableStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    diningStore.extend({
      id: z.string().uuid(),
      status: z.enum(TABLE_STATUSES),
      expected: z.enum(TABLE_STATUSES),
    }),
  )
  .handler(async ({ data, context }) => {
    const s = await diningScope(context.supabase, data);
    const { data: status, error } = await context.supabase.rpc("set_dining_table_status", {
      _org_id: s.orgId,
      _location_id: s.locationId,
      _table_id: data.id,
      _status: data.status,
      _expected_status: data.expected,
    });
    if (error?.message === "status_conflict")
      return {
        conflict: true as const,
        status: isTableStatus(error.details) ? error.details : null,
      };
    if (error || !isTableStatus(status))
      throw await refused(context.supabase, error, s.orgId, "tables.status", s.locationId);
    return { conflict: false as const, status };
  });

// ---------------------------------------------------------------- dining sessions and rounds (0038)
// A replayed request (same clientKey) returns the same session or order: the screen creates the key
// once per action and sends it again on retry, so a lost reply never seats a party or sends a round
// twice. Voiding a round uses changeOperationalOrder (cancel_order_with_reversal, orders.refund).
export const openDiningSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    diningStore.extend({
      tableId: z.string().uuid(),
      guests: z.number().int().min(1).max(99),
      clientKey: z.string().min(1).max(160),
    }),
  )
  .handler(async ({ data, context }) => {
    const s = await diningScope(context.supabase, data);
    const { data: id, error } = await context.supabase.rpc("open_dining_session", {
      _org_id: s.orgId,
      _location_id: s.locationId,
      _table_id: data.tableId,
      _guests: data.guests,
      _client_key: data.clientKey,
    });
    if (error || !id)
      throw await refused(context.supabase, error, s.orgId, "tables.session_open", s.locationId);
    return { id };
  });

export const updateDiningSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    diningStore.extend({
      id: z.string().uuid(),
      guests: z.number().int().min(1).max(99),
      serverId: z.string().uuid(),
    }),
  )
  .handler(async ({ data, context }) => {
    const s = await diningScope(context.supabase, data);
    const { error } = await context.supabase.rpc("update_dining_session", {
      _org_id: s.orgId,
      _location_id: s.locationId,
      _session_id: data.id,
      _guests: data.guests,
      _server_id: data.serverId,
    });
    if (error)
      throw await refused(context.supabase, error, s.orgId, "tables.session_update", s.locationId);
    return { success: true };
  });

export const fireCheckRound = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    diningStore.extend({
      checkId: z.string().uuid(),
      clientKey: z.string().min(1).max(150),
      taxRatePpm: z.number().int().min(0).max(1_000_000),
      notes: z.string().max(500).optional(),
      items: saleInputSchema.shape.items,
    }),
  )
  .handler(async ({ data, context }) => {
    const s = await diningScope(context.supabase, data);
    const { data: id, error } = await context.supabase.rpc("fire_check_round", {
      _org_id: s.orgId,
      _location_id: s.locationId,
      _check_id: data.checkId,
      _client_key: data.clientKey,
      _tax_rate_ppm: data.taxRatePpm,
      _items: data.items.map((i) => ({
        product_id: i.productId,
        quantity: i.quantity,
        notes: i.notes ?? null,
        modifiers: i.modifiers.map((m) => ({ group_id: m.groupId, option_id: m.optionId })),
      })),
      ...(data.notes ? { _notes: data.notes } : {}),
    });
    if (error || !id)
      throw await refused(context.supabase, error, s.orgId, "tables.round_fire", s.locationId);
    return { id };
  });

export const moveDiningSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(diningStore.extend({ id: z.string().uuid(), toTableId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const s = await diningScope(context.supabase, data);
    const { error } = await context.supabase.rpc("move_dining_session", {
      _org_id: s.orgId,
      _location_id: s.locationId,
      _session_id: data.id,
      _to_table_id: data.toTableId,
    });
    if (error)
      throw await refused(context.supabase, error, s.orgId, "tables.session_move", s.locationId);
    return { success: true };
  });

export const closeEmptyDiningSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(diningStore.extend({ id: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const s = await diningScope(context.supabase, data);
    const { error } = await context.supabase.rpc("close_empty_dining_session", {
      _org_id: s.orgId,
      _location_id: s.locationId,
      _session_id: data.id,
    });
    if (error)
      throw await refused(context.supabase, error, s.orgId, "tables.session_close", s.locationId);
    return { success: true };
  });

/** Another check at the same table (each person or group pays their own; payment is step 3). */
export const openDiningCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    diningStore.extend({
      sessionId: z.string().uuid(),
      clientKey: z.string().min(1).max(160),
      label: z.string().trim().max(40).optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const s = await diningScope(context.supabase, data);
    const { data: id, error } = await context.supabase.rpc("open_dining_check", {
      _org_id: s.orgId,
      _location_id: s.locationId,
      _session_id: data.sessionId,
      _client_key: data.clientKey,
      ...(data.label ? { _label: data.label } : {}),
    });
    if (error || !id)
      throw await refused(context.supabase, error, s.orgId, "tables.check_open", s.locationId);
    return { id };
  });

// ---------------------------------------------------------------- check payments (0039)
// A tender records what it settles of the check; the check closes (allocation, revenue, COGS) when its
// balance reaches zero, and the table when its last check closes. The key is kept by the screen across
// retries so a lost reply never records a second tender.
export const payDiningCheck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    diningStore.extend({
      checkId: z.string().uuid(),
      clientKey: z.string().min(1).max(160),
      method: z.enum(["cash", "card", "digital"]),
      amountCents: z.number().int().positive(),
      tipCents: z.number().int().min(0).max(10_000_000),
      tenderedCents: z.number().int().min(0).nullable(),
    }),
  )
  .handler(async ({ data, context }) => {
    const s = await diningScope(context.supabase, data);
    const { data: result, error } = await context.supabase.rpc("pay_dining_check", {
      _org_id: s.orgId,
      _location_id: s.locationId,
      _check_id: data.checkId,
      _client_key: data.clientKey,
      _method: data.method,
      _amount_cents: data.amountCents,
      _tip_cents: data.tipCents,
      ...(data.tenderedCents !== null ? { _tendered_cents: data.tenderedCents } : {}),
    });
    if (error || !result)
      throw await refused(context.supabase, error, s.orgId, "tables.check_pay", s.locationId);
    const r = result as { payment?: string; check_status?: string; balance_cents?: number };
    return {
      paymentId: String(r.payment ?? ""),
      checkStatus: r.check_status === "closed" ? ("closed" as const) : ("open" as const),
      balanceCents: Number(r.balance_cents ?? 0),
    };
  });

export const voidCheckPayment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    diningStore.extend({ id: z.string().uuid(), reason: z.string().trim().min(3).max(300) }),
  )
  .handler(async ({ data, context }) => {
    const s = await diningScope(context.supabase, data);
    const { error } = await context.supabase.rpc("void_check_payment", {
      _org_id: s.orgId,
      _location_id: s.locationId,
      _payment_id: data.id,
      _reason: data.reason,
    });
    if (error)
      throw await refused(context.supabase, error, s.orgId, "tables.payment_reverse", s.locationId);
    return { success: true };
  });

export const moveCheckRound = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(diningStore.extend({ orderId: z.string().uuid(), toCheckId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const s = await diningScope(context.supabase, data);
    const { error } = await context.supabase.rpc("move_check_round", {
      _org_id: s.orgId,
      _location_id: s.locationId,
      _order_id: data.orderId,
      _to_check_id: data.toCheckId,
    });
    if (error)
      throw await refused(context.supabase, error, s.orgId, "tables.round_move", s.locationId);
    return { success: true };
  });

/**
 * The store's day so far (its local calendar day, its IANA zone): checks closed, what tenders applied,
 * tips by the table's server. Reads through RLS (tables.* at the store); tips are owed to the staff
 * and never reach the ledger, so this is where they are seen.
 */
export const fetchDiningDaySummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(diningStore)
  .handler(async ({ data, context }) => {
    const sc = await scope(context.supabase, data.orgId, data.locationId);
    if (!sc.location) throw new Error("location_required");
    const tz = sc.location.timezone || "America/New_York";
    const day = localDay(new Date(), tz);
    const since = startOfLocalDay(day, tz).toISOString();
    const c = context.supabase;
    const [tenders, closed, open] = await Promise.all([
      c
        .from("dining_check_payments")
        .select("amount_cents,tip_cents,status,check_id,method")
        .eq("org_id", sc.org.id)
        .eq("location_id", sc.location.id)
        .gte("created_at", since),
      c
        .from("dining_checks")
        .select("id", { count: "exact", head: true })
        .eq("org_id", sc.org.id)
        .eq("location_id", sc.location.id)
        .eq("status", "closed")
        .gte("closed_at", since),
      // Checks still open right now (any day): the drawer should not be closed over them.
      c
        .from("dining_checks")
        .select("id", { count: "exact", head: true })
        .eq("org_id", sc.org.id)
        .eq("location_id", sc.location.id)
        .eq("status", "open"),
    ]);
    if (tenders.error || closed.error || open.error) throw new Error("dining_read_failed");
    const checkIds = [...new Set((tenders.data ?? []).map((t) => t.check_id))];
    const checks = checkIds.length
      ? await c.from("dining_checks").select("id,session_id,status").in("id", checkIds)
      : { data: [], error: null };
    if (checks.error) throw new Error("dining_read_failed");
    const sessionIds = [...new Set((checks.data ?? []).map((x) => x.session_id))];
    const sessions = sessionIds.length
      ? await c.from("dining_sessions").select("id,server_id").in("id", sessionIds)
      : { data: [], error: null };
    if (sessions.error) throw new Error("dining_read_failed");
    const serverIds = [...new Set((sessions.data ?? []).map((x) => x.server_id))];
    const profiles = serverIds.length
      ? await c.from("profiles").select("id,full_name").in("id", serverIds)
      : { data: [], error: null };
    if (profiles.error) throw new Error("dining_read_failed");
    return summarizeDay({
      day,
      tenders: tenders.data ?? [],
      checks: checks.data ?? [],
      sessions: sessions.data ?? [],
      closedToday: closed.count ?? 0,
      openNow: open.count ?? 0,
      profiles: profiles.data ?? [],
    });
  });

/** The history of one check (open or closed) at this store: see check-history.ts. */
export const fetchCheckHistory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(diningStore.extend({ checkId: z.string().uuid() }))
  .handler(async ({ data, context }) => {
    const s = await diningScope(context.supabase, data);
    const c = context.supabase;
    const check = await c
      .from("dining_checks")
      .select("id,session_id,status,opened_at,opened_by,closed_at")
      .eq("org_id", s.orgId)
      .eq("location_id", s.locationId)
      .eq("id", data.checkId)
      .maybeSingle();
    if (check.error) throw new Error("dining_read_failed");
    if (!check.data) throw new Error("check_not_found");
    const id = check.data.id;
    const [rounds, tenders, moves] = await Promise.all([
      c
        .from("dining_check_rounds")
        .select("order_id,round_no,fired_at,fired_by")
        .eq("check_id", id),
      c
        .from("dining_check_payments")
        .select(
          "id,method,amount_cents,tip_cents,status,created_at,created_by,reversed_at,reversed_by",
        )
        .eq("check_id", id),
      // Activity log: RLS returns rows only to members with team.activity at this store.
      c
        .from("audit_logs")
        .select("created_at,actor_id,metadata")
        .eq("org_id", s.orgId)
        .eq("action", "tables.round_moved")
        .or(`metadata->>from.eq.${id},metadata->>to.eq.${id}`),
    ]);
    if (rounds.error || tenders.error) throw new Error("dining_read_failed");
    const moveRows = (moves.error ? [] : (moves.data ?? [])).map((m) => ({
      created_at: m.created_at,
      actor_id: m.actor_id,
      metadata: (m.metadata ?? null) as { from?: string; to?: string } | null,
    }));
    const orderIds = (rounds.data ?? []).map((r) => r.order_id);
    const otherIds = [
      ...new Set(
        moveRows
          .flatMap((m) => [m.metadata?.from, m.metadata?.to])
          .filter((x): x is string => !!x && x !== id),
      ),
    ];
    const [orders, cancels, others] = await Promise.all([
      orderIds.length
        ? c.from("orders").select("id,total_cents").in("id", orderIds)
        : Promise.resolve({ data: [], error: null }),
      orderIds.length
        ? c
            .from("order_status_history")
            .select("order_id,created_at,actor_id")
            .in("order_id", orderIds)
            .eq("to_status", "cancelled")
        : Promise.resolve({ data: [], error: null }),
      otherIds.length
        ? c.from("dining_checks").select("id,number,label").in("id", otherIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (orders.error || cancels.error || others.error) throw new Error("dining_read_failed");
    const people = [
      ...new Set(
        [
          check.data.opened_by,
          ...(rounds.data ?? []).map((r) => r.fired_by),
          ...(cancels.data ?? []).map((x) => x.actor_id),
          ...(tenders.data ?? []).flatMap((t) => [t.created_by, t.reversed_by]),
          ...moveRows.map((m) => m.actor_id),
        ].filter((x): x is string => !!x),
      ),
    ];
    const profiles = people.length
      ? await c.from("profiles").select("id,full_name").in("id", people)
      : { data: [], error: null };
    if (profiles.error) throw new Error("dining_read_failed");
    // Reversal reasons (0041): only who holds orders.refund at the store gets them; for everyone else
    // the database refuses and the history simply shows no reason.
    let reasons: { payment_id: string; reason: string }[] = [];
    if ((tenders.data ?? []).some((t) => t.status === "reversed")) {
      const r = await c.rpc("list_check_reversal_reasons", {
        _org_id: s.orgId,
        _location_id: s.locationId,
        _check_id: id,
      });
      if (!r.error) reasons = r.data ?? [];
    }
    return toCheckHistory({
      check: check.data,
      rounds: rounds.data ?? [],
      orders: orders.data ?? [],
      cancellations: cancels.data ?? [],
      tenders: tenders.data ?? [],
      moves: moveRows,
      otherChecks: others.data ?? [],
      profiles: profiles.data ?? [],
      reversalReasons: reasons,
    });
  });

/** Checks closed today at this store (newest first), so their history stays reachable after the
 * table is freed. */
export const fetchClosedChecksToday = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    diningStore.extend({
      /** A local calendar day of the store (YYYY-MM-DD); today when absent. Up to 90 days back. */
      day: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const sc = await scope(context.supabase, data.orgId, data.locationId);
    if (!sc.location) throw new Error("location_required");
    const tz = sc.location.timezone || "America/New_York";
    const today = localDay(new Date(), tz);
    const day =
      data.day && data.day <= today && data.day >= shiftDay(today, -90) ? data.day : today;
    const since = startOfLocalDay(day, tz).toISOString();
    const until = startOfLocalDay(shiftDay(day, 1), tz).toISOString();
    const c = context.supabase;
    const checks = await c
      .from("dining_checks")
      .select("id,session_id,number,label,closed_at")
      .eq("org_id", sc.org.id)
      .eq("location_id", sc.location.id)
      .eq("status", "closed")
      .gte("closed_at", since)
      .lt("closed_at", until)
      .order("closed_at", { ascending: false })
      .limit(200);
    if (checks.error) throw new Error("dining_read_failed");
    const ids = (checks.data ?? []).map((x) => x.id);
    const sessionIds = [...new Set((checks.data ?? []).map((x) => x.session_id))];
    const [sessions, tenders] = await Promise.all([
      sessionIds.length
        ? c.from("dining_sessions").select("id,table_id").in("id", sessionIds)
        : Promise.resolve({ data: [], error: null }),
      ids.length
        ? c
            .from("dining_check_payments")
            .select("check_id,amount_cents,tip_cents,status")
            .in("check_id", ids)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (sessions.error || tenders.error) throw new Error("dining_read_failed");
    const tableIds = [...new Set((sessions.data ?? []).map((x) => x.table_id))];
    const tables = tableIds.length
      ? await c.from("dining_tables").select("id,label").in("id", tableIds)
      : { data: [], error: null };
    if (tables.error) throw new Error("dining_read_failed");
    return toClosedChecks({
      checks: checks.data ?? [],
      sessions: sessions.data ?? [],
      tables: tables.data ?? [],
      tenders: tenders.data ?? [],
    });
  });

/** Units and sales per menu product and store over the last N local days (0042, read under RLS). */
export const fetchMenuItemSales = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      orgId: z.string().min(1),
      locationId: z.string().min(1),
      days: z.number().int().min(1).max(366),
    }),
  )
  .handler(async ({ data, context }) => {
    const sc = await scope(context.supabase, data.orgId, data.locationId);
    const { data: rows, error } = await context.supabase.rpc("menu_item_sales", {
      _org_id: sc.org.id,
      ...(sc.location ? { _location_ids: [sc.location.id] } : {}),
      _days: data.days,
    });
    if (error) throw new Error("menu_sales_read_failed");
    return (rows ?? []).map((r) => ({
      location_id: r.location_id,
      product_id: r.product_id,
      product_name: r.product_name,
      units: Number(r.units),
      sales_cents: Number(r.sales_cents),
    }));
  });

/** What sales consumed of each stock item over the last N local days (0044, read under RLS). */
export const fetchInventoryConsumption = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      orgId: z.string().min(1),
      locationId: z.string().min(1),
      days: z.number().int().min(1).max(366),
    }),
  )
  .handler(async ({ data, context }) => {
    const sc = await scope(context.supabase, data.orgId, data.locationId);
    const { data: rows, error } = await context.supabase.rpc("inventory_consumption", {
      _org_id: sc.org.id,
      ...(sc.location ? { _location_ids: [sc.location.id] } : {}),
      _days: data.days,
    });
    if (error) throw new Error("consumption_read_failed");
    return (rows ?? []).map((r) => ({
      inventory_item_id: r.inventory_item_id,
      consumed: Number(r.consumed),
    }));
  });

/**
 * Current recipe cost per serving of each product at each store (database store ids), computed the
 * same way the screens compute it (mapResources). Server-side helper for the assistant (0040/0042).
 * Returns null when the member cannot see inventory costs (inventory_item_costs refuses): the caller
 * then has no cost, never a zero.
 */
export async function readRecipeCosts(
  client: SupabaseClient<Database>,
  orgDbId: string,
): Promise<RecipeCost[] | null> {
  const [org, locations, inventory, recipes] = await Promise.all([
    client.from("organizations").select("slug").eq("id", orgDbId).maybeSingle(),
    client.from("locations").select("id,slug,timezone").eq("org_id", orgDbId),
    client.from("inventory_items").select(INVENTORY_COLUMNS).eq("org_id", orgDbId),
    client
      .from("product_recipes")
      .select("*,recipe_ingredients(*),menu_products(name,price_cents)")
      .eq("org_id", orgDbId),
  ]);
  if (org.error || locations.error || inventory.error || recipes.error)
    throw new Error("resources_read_failed");
  const costRead = await client.rpc("inventory_item_costs", { _org_id: orgDbId });
  if (costRead.error) {
    if (costRead.error.message === "permission_denied") return null;
    throw new Error("resources_read_failed");
  }
  const costs = new Map((costRead.data ?? []).map((r) => [r.item_id, r.cost_cents]));
  const resources: Resources = {
    orgId: org.data?.slug ?? orgDbId,
    locations: locations.data ?? [],
    costsVisible: true,
    inventory: (inventory.data ?? []).map((i) => ({ ...i, cost_cents: costs.get(i.id) ?? null })),
    recipes: recipes.data ?? [],
    suppliers: [],
    purchases: [],
    movements: [],
    expenses: [],
  };
  const idOf = new Map(
    (locations.data ?? []).flatMap(
      (l) =>
        [
          [l.slug, l.id],
          [l.id, l.id],
        ] as const,
    ),
  );
  return mapResources(resources)
    .recipes.filter((r) => r.productId && r.locationId)
    .map((r) => ({
      productId: r.productId as string,
      locationId: idOf.get(r.locationId as string) ?? (r.locationId as string),
      costPerServingCents: r.costPerServingCents,
    }));
}

/** Sales tax collected per store and local month (0045, read under RLS). */
export const fetchSalesTaxSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      orgId: z.string().min(1),
      locationId: z.string().min(1),
      months: z.number().int().min(1).max(24),
    }),
  )
  .handler(async ({ data, context }) => {
    const sc = await scope(context.supabase, data.orgId, data.locationId);
    const { data: rows, error } = await context.supabase.rpc("sales_tax_summary", {
      _org_id: sc.org.id,
      ...(sc.location ? { _location_ids: [sc.location.id] } : {}),
      _months: data.months,
    });
    if (error) throw new Error("sales_tax_read_failed");
    return (rows ?? []).map((r) => ({
      location_id: r.location_id,
      month: r.month,
      orders: Number(r.orders),
      taxable_cents: Number(r.taxable_cents),
      tax_cents: Number(r.tax_cents),
      total_cents: Number(r.total_cents),
    }));
  });

/** Tips recorded on dining room checks per server and store, last N local days (0046, read under RLS). */
export const fetchTipsByServer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      orgId: z.string().min(1),
      locationId: z.string().min(1),
      days: z.number().int().min(1).max(366),
    }),
  )
  .handler(async ({ data, context }) => {
    const sc = await scope(context.supabase, data.orgId, data.locationId);
    const c = context.supabase;
    const { data: rows, error } = await c.rpc("tips_by_server", {
      _org_id: sc.org.id,
      ...(sc.location ? { _location_ids: [sc.location.id] } : {}),
      _days: data.days,
    });
    if (error) throw new Error("tips_read_failed");
    const ids = [...new Set((rows ?? []).map((r) => r.server_id))];
    const profiles = ids.length
      ? await c.from("profiles").select("id,full_name").in("id", ids)
      : { data: [], error: null };
    if (profiles.error) throw new Error("tips_read_failed");
    const names = new Map((profiles.data ?? []).map((p) => [p.id, p.full_name?.trim() || null]));
    return (rows ?? []).map((r) => ({
      locationId: r.location_id,
      serverId: r.server_id,
      serverName: names.get(r.server_id) ?? null,
      tenders: Number(r.tenders),
      tipsCents: Number(r.tips_cents),
      cashTipsCents: Number(r.cash_tips_cents),
      paidCents: Number(r.paid_cents),
    }));
  });
