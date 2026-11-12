import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { menuItemSchema, recipePayloadSchema, saleInputSchema } from "./operational-contracts";
import { orderListQuery } from "./orders-query";
import { toMenuReadModel } from "./menu-read-model";

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
    .select("id,slug")
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
      .select("order_number,total_cents,tax_cents,subtotal_cents,is_simulation")
      .eq("id", result.data)
      .eq("org_id", s.org.id)
      .eq("location_id", s.location.id)
      .single();
    if (error || !order) throw new Error("sale_readback_failed");
    return {
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

export const fetchOperationalResources = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ orgId: z.string().min(1), locationId: z.string().optional() }))
  .handler(async ({ data, context }) => {
    const s = await scope(context.supabase, data.orgId, data.locationId);
    const c = context.supabase;
    // RLS scopes each query, including organization-wide reads by managers.
    const [inventory, recipes, suppliers, purchases, movements, finance, expenses] =
      await Promise.all([
        c.from("inventory_items").select(INVENTORY_COLUMNS).eq("org_id", s.org.id),
        c.from("product_recipes").select("*,recipe_ingredients(*)").eq("org_id", s.org.id),
        c.from("suppliers").select("*").eq("org_id", s.org.id),
        c.from("purchase_orders").select("*,purchase_order_items(*)").eq("org_id", s.org.id),
        c
          .from("inventory_movements")
          .select(MOVEMENT_COLUMNS)
          .eq("org_id", s.org.id)
          .order("created_at", { ascending: false })
          .limit(200),
        c.from("finance_entries").select("*").eq("org_id", s.org.id),
        c.from("finance_expenses").select("*").eq("org_id", s.org.id).eq("active", true),
      ]);
    if (
      [inventory, recipes, suppliers, purchases, movements, finance, expenses].some((r) => r.error)
    )
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
      finance: filter(finance.data ?? []),
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
