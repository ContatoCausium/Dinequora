import { z } from "zod";
import type { fetchOperationalResources } from "./operational.functions";
import type { InventoryItem } from "./inventory-service";
import {
  calculateIngredientCost,
  computeRecipeTotals,
  type ProductRecipe,
} from "./recipes-service";
import type { Supplier, PurchaseOrder } from "./suppliers-purchases-service";
import { EXPENSE_CATEGORIES, type Expense } from "./finance-service";

/**
 * inventory_movements.kind as written by the RPCs. Manual movements (in/out/loss/adjustment) are all
 * stored as "adjustment" today — the database does not record which manual type was chosen.
 */
export type MovementKind =
  "opening" | "receiving" | "sale" | "reversal" | "adjustment" | "transfer_in" | "transfer_out";

export type Resources = Awaited<ReturnType<typeof fetchOperationalResources>>;
export function mapResources(r: Resources) {
  const location = (id: string) => r.locations.find((l) => l.id === id)?.slug ?? id;
  const items: InventoryItem[] = r.inventory.map((i) => ({
    id: i.id,
    orgId: r.orgId,
    locationId: location(i.location_id),
    name: i.name,
    category: z
      .enum(["meat", "produce", "dairy", "bakery", "dry_goods", "beverages", "packaging"])
      .parse(i.category),
    sku: i.sku,
    unit: z.enum(["oz", "lb", "gal", "kg", "units", "pack"]).parse(i.unit),
    quantity: i.quantity,
    minQuantity: i.min_quantity,
    // 0 when the caller lacks inventory.costs: screens must check costsVisible before showing it.
    costCents: i.cost_cents ?? 0,
    supplier: i.supplier,
    active: i.active,
    updatedAt: i.updated_at,
    ...(i.expiration_date ? { expirationDate: i.expiration_date } : {}),
  }));
  const supplierDetails = z.object({
    contactName: z.string().optional(),
    email: z.string().optional(),
    phone: z.string().optional(),
    address: z.string().optional(),
    notes: z.string().optional(),
    suppliedCategories: z.array(z.string()).default([]),
  });
  const suppliers: Supplier[] = r.suppliers.map((s) => {
    const d = supplierDetails.parse(s.details);
    return {
      suppliedCategories: d.suppliedCategories,
      ...(d.contactName ? { contactName: d.contactName } : {}),
      ...(d.email ? { email: d.email } : {}),
      ...(d.phone ? { phone: d.phone } : {}),
      ...(d.address ? { address: d.address } : {}),
      ...(d.notes ? { notes: d.notes } : {}),
      id: s.id,
      orgId: r.orgId,
      name: s.name,
      active: s.active,
      createdAt: s.updated_at,
      updatedAt: s.updated_at,
    };
  });
  const recipes: ProductRecipe[] = r.recipes.map((p) => {
    const metadata = z
      .object({ productName: z.string().default(""), sellingPriceCents: z.number().default(0) })
      .parse(p.metadata);
    const ingredients = p.recipe_ingredients.map((i) => {
      const item = items.find((x) => x.id === i.inventory_item_id);
      const unit = z
        .enum(["oz", "lb", "g", "kg", "ml", "l", "units", "pack", "tsp", "tbsp", "cup"])
        .parse(i.unit);
      // Current stock cost, same basis the sale RPC uses for COGS.
      const cost = item
        ? calculateIngredientCost(item, i.quantity, unit, i.waste_percentage)
        : { unitCostCents: 0, subtotalCostCents: 0 };
      return {
        id: i.id,
        inventoryItemId: i.inventory_item_id,
        name: item?.name ?? "",
        quantity: i.quantity,
        unit,
        wastePercentage: i.waste_percentage,
        unitCostCents: cost.unitCostCents,
        subtotalCostCents: cost.subtotalCostCents,
      };
    });
    const totals = computeRecipeTotals(ingredients, p.servings, metadata.sellingPriceCents);
    return {
      id: p.id,
      orgId: r.orgId,
      productId: p.product_id,
      productName: metadata.productName,
      locationId: location(p.location_id),
      servings: p.servings,
      yieldQuantity: p.yield_quantity,
      yieldUnit: p.yield_unit,
      prepInstructions: p.instructions,
      sellingPriceCents: metadata.sellingPriceCents,
      ingredients,
      ...totals,
      history: [],
      updatedAt: p.updated_at,
    };
  });
  const purchases: PurchaseOrder[] = r.purchases.map((p) => {
    const its = p.purchase_order_items.map((i) => {
      const item = items.find((x) => x.id === i.inventory_item_id);
      return {
        id: i.id,
        inventoryItemId: i.inventory_item_id,
        name: item?.name ?? "",
        unit: item?.unit ?? "units",
        quantityOrdered: i.quantity_ordered,
        quantityReceived: i.quantity_received,
        unitPriceCents: i.unit_price_cents,
        subtotalCents: Math.round(i.quantity_ordered * i.unit_price_cents),
      };
    });
    const subtotal = its.reduce((sum, i) => sum + i.subtotalCents, 0);
    return {
      id: p.id,
      poNumber: `#PO-${p.id.slice(0, 8)}`,
      orgId: r.orgId,
      locationId: location(p.location_id),
      supplierId: p.supplier_id,
      supplierName: suppliers.find((s) => s.id === p.supplier_id)?.name ?? "",
      status: z
        .enum(["draft", "sent", "partially_received", "received", "cancelled"])
        .parse(p.status),
      items: its,
      subtotalCents: subtotal,
      taxCents: p.tax_cents,
      discountCents: p.discount_cents,
      shippingCents: p.shipping_cents,
      totalCents: subtotal - p.discount_cents + p.tax_cents + p.shipping_cents,
      notes: p.notes,
      history: [],
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    };
  });
  const expenseSchema = z.object({
    category: z.enum(EXPENSE_CATEGORIES),
    recurrence: z.enum(["fixed", "variable", "recurring"]),
    status: z.enum(["pending", "paid", "overdue"]),
    description: z.string(),
    amountCents: z.number().int().nonnegative(),
    dueDate: z.string(),
    competencyDate: z.string(),
    responsiblePerson: z.string(),
    supplierName: z.string().optional(),
    paidAt: z.string().optional(),
    isSimulation: z.boolean().default(false),
  });
  const expenses: Expense[] = r.expenses.map((e) => ({
    ...expenseSchema.parse(e.payload),
    id: e.id,
    orgId: r.orgId,
    locationId: location(e.location_id),
    currency: "usd",
    createdAt: e.updated_at,
    updatedAt: e.updated_at,
  }));
  // Movements arrive newest-first and the read keeps the newest N, so every newer movement of an
  // item is always present: walking back from the item's current quantity gives the exact balance
  // right after each movement.
  const running = new Map(items.map((i) => [i.id, i.quantity]));
  const movements = r.movements.map((m) => {
    const after = running.get(m.inventory_item_id);
    if (after !== undefined) running.set(m.inventory_item_id, after - m.delta);
    const item = items.find((i) => i.id === m.inventory_item_id);
    return {
      id: m.id,
      itemName: item?.name ?? "",
      unit: item?.unit ?? "units",
      locationId: location(m.location_id),
      kind: z
        .enum([
          "opening",
          "receiving",
          "sale",
          "reversal",
          "adjustment",
          "transfer_in",
          "transfer_out",
        ])
        .catch("adjustment")
        .parse(m.kind) satisfies MovementKind,
      type:
        m.kind === "transfer_in" || m.kind === "transfer_out"
          ? ("transfer" as const)
          : m.delta > 0
            ? ("in" as const)
            : ("out" as const),
      quantityDelta: m.delta,
      /** null when the item is no longer readable (e.g. deactivated outside this store scope). */
      resultingQuantity: after ?? null,
      reason: m.reason,
      performedBy: m.actor_id,
      createdAt: m.created_at,
    };
  });
  return {
    items,
    recipes,
    suppliers,
    purchases,
    expenses,
    movements,
    costsVisible: r.costsVisible,
  };
}
