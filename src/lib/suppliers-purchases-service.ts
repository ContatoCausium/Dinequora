import {
  assertLocationAllowed,
  assertScopeWritable,
  assertTenantContext,
  isLocationAllowed,
} from "./tenant-storage";
import { recordInventoryMovement } from "./inventory-movements-service";
import { listInventory, saveInventoryItem } from "./inventory-service";

export type POStatus = "draft" | "sent" | "partially_received" | "received" | "cancelled";

export interface Supplier {
  id: string;
  orgId: string;
  name: string;
  contactName?: string;
  email?: string;
  phone?: string;
  address?: string;
  suppliedCategories: string[];
  notes?: string | undefined;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseOrderItem {
  id: string;
  inventoryItemId: string;
  name: string;
  unit: string;
  quantityOrdered: number;
  quantityReceived: number;
  unitPriceCents: number;
  subtotalCents: number;
  divergenceNote?: string | undefined;
}

export interface PurchaseOrderHistoryEntry {
  id: string;
  timestamp: string;
  actor: string;
  fromStatus?: POStatus;
  toStatus: POStatus;
  action: string;
  notes?: string | undefined;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  orgId: string;
  locationId: string;
  supplierId: string;
  supplierName: string;
  status: POStatus;
  expectedDeliveryDate?: string | undefined;
  items: PurchaseOrderItem[];
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  shippingCents: number;
  totalCents: number;
  notes?: string | undefined;
  receivingNotes?: string | undefined;
  receivedBy?: string;
  receivedAt?: string;
  history: PurchaseOrderHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

const SUPPLIERS_KEY_PREFIX = "servora_suppliers_";
const PO_KEY_PREFIX = "servora_purchase_orders_";

const DEFAULT_SUPPLIERS: Supplier[] = [
  {
    id: "sup-usfoods",
    orgId: "default",
    name: "US Foods",
    contactName: "David Miller",
    email: "orders@usfoods-vendor.com",
    phone: "+1 (555) 234-5678",
    address: "9399 W Higgins Rd, Rosemont, IL 60018",
    suppliedCategories: ["meat", "produce", "dry_goods"],
    notes: "Standard delivery on Tuesday and Thursday mornings",
    active: true,
    createdAt: "2025-01-10T08:00:00Z",
    updatedAt: "2025-01-10T08:00:00Z",
  },
  {
    id: "sup-sysco",
    orgId: "default",
    name: "Sysco Wholesale",
    contactName: "Sarah Jenkins",
    email: "distro@sysco-partner.net",
    phone: "+1 (555) 876-5432",
    address: "1390 Enclave Pkwy, Houston, TX 77077",
    suppliedCategories: ["dairy", "bakery", "packaging"],
    notes: "Minimum PO $400 for waived freight fee",
    active: true,
    createdAt: "2025-01-12T10:00:00Z",
    updatedAt: "2025-01-12T10:00:00Z",
  },
  {
    id: "sup-ecopak",
    orgId: "default",
    name: "EcoPack Solutions",
    contactName: "Alex Wong",
    email: "support@ecopak-packaging.com",
    phone: "+1 (555) 432-1098",
    address: "452 Industrial Blvd, Newark, NJ 07102",
    suppliedCategories: ["packaging"],
    notes: "Biodegradable containers and recycled napkins",
    active: true,
    createdAt: "2025-01-15T12:00:00Z",
    updatedAt: "2025-01-15T12:00:00Z",
  },
];

/** Example suppliers exist only for the demo organization; real organizations start empty. */
function demoSuppliers(orgId: string): Supplier[] {
  return orgId === "demo" ? DEFAULT_SUPPLIERS.map((s) => ({ ...s, orgId: "demo" })) : [];
}

export function listSuppliers(orgId: string): Supplier[] {
  assertTenantContext(orgId);
  if (typeof window === "undefined") return demoSuppliers(orgId);
  try {
    const raw = localStorage.getItem(`${SUPPLIERS_KEY_PREFIX}${assertTenantContext(orgId)}`);
    if (!raw) {
      const seed = demoSuppliers(orgId);
      if (seed.length > 0)
        localStorage.setItem(`${SUPPLIERS_KEY_PREFIX}${orgId}`, JSON.stringify(seed));
      return seed;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Keep records saved before this change ("default" examples) instead of dropping them.
    return (parsed as Supplier[]).filter((s) => s.orgId === orgId || s.orgId === "default");
  } catch {
    return [];
  }
}

/** Suppliers are organization-wide: store-restricted callers cannot change them. */
export function saveSupplier(
  orgId: string,
  supplier: Partial<Supplier> & { name: string },
  allowedLocationIds?: readonly string[],
): Supplier {
  assertScopeWritable([], allowedLocationIds);
  const current = listSuppliers(orgId);
  const now = new Date().toISOString();
  let saved: Supplier;
  if (supplier.id) {
    const idx = current.findIndex((s) => s.id === supplier.id);
    if (idx >= 0 && current[idx]) {
      saved = {
        ...current[idx],
        ...supplier,
        orgId: current[idx].orgId,
        updatedAt: now,
      };
      current[idx] = saved;
    } else {
      saved = {
        id: supplier.id,
        orgId,
        name: supplier.name,
        contactName: supplier.contactName || "",
        email: supplier.email || "",
        phone: supplier.phone || "",
        address: supplier.address || "",
        suppliedCategories: supplier.suppliedCategories || [],
        notes: supplier.notes || "",
        active: supplier.active ?? true,
        createdAt: now,
        updatedAt: now,
      };
      current.push(saved);
    }
  } else {
    saved = {
      id: `sup-${crypto.randomUUID()}`,
      orgId,
      name: supplier.name,
      contactName: supplier.contactName || "",
      email: supplier.email || "",
      phone: supplier.phone || "",
      address: supplier.address || "",
      suppliedCategories: supplier.suppliedCategories || [],
      notes: supplier.notes || "",
      active: supplier.active ?? true,
      createdAt: now,
      updatedAt: now,
    };
    current.push(saved);
  }

  if (typeof window !== "undefined") {
    localStorage.setItem(
      `${SUPPLIERS_KEY_PREFIX}${assertTenantContext(orgId)}`,
      JSON.stringify(current),
    );
  }
  return saved;
}

export function toggleSupplierActive(
  orgId: string,
  supplierId: string,
  allowedLocationIds?: readonly string[],
): Supplier | null {
  assertScopeWritable([], allowedLocationIds);
  const current = listSuppliers(orgId);
  const item = current.find((s) => s.id === supplierId);
  if (!item) return null;
  item.active = !item.active;
  item.updatedAt = new Date().toISOString();
  if (typeof window !== "undefined") {
    localStorage.setItem(
      `${SUPPLIERS_KEY_PREFIX}${assertTenantContext(orgId)}`,
      JSON.stringify(current),
    );
  }
  return item;
}

export function calculatePOTotals(params: {
  items: PurchaseOrderItem[];
  taxCents?: number | undefined;
  discountCents?: number | undefined;
  shippingCents?: number | undefined;
}): { subtotalCents: number; totalCents: number } {
  const subtotalCents = params.items.reduce(
    (acc, it) => acc + it.unitPriceCents * it.quantityOrdered,
    0,
  );
  const tax = Math.max(0, params.taxCents || 0);
  const discount = Math.max(0, params.discountCents || 0);
  const shipping = Math.max(0, params.shippingCents || 0);
  const totalCents = Math.max(0, subtotalCents - discount) + tax + shipping;
  return { subtotalCents, totalCents };
}

export function listPurchaseOrders(
  orgId: string,
  locationId?: string,
  allowedLocationIds?: readonly string[],
): PurchaseOrder[] {
  assertTenantContext(orgId);
  if (locationId && locationId !== "all" && !isLocationAllowed(locationId, allowedLocationIds))
    return [];
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`${PO_KEY_PREFIX}${assertTenantContext(orgId)}`);
    if (!raw) return [];
    const all = (JSON.parse(raw) as PurchaseOrder[]).filter(
      (po) => po.orgId === orgId && isLocationAllowed(po.locationId, allowedLocationIds),
    );
    if (!locationId || locationId === "all") return all;
    return all.filter((po) => po.locationId === locationId);
  } catch {
    return [];
  }
}

export function savePurchaseOrder(
  orgId: string,
  orderData: Partial<PurchaseOrder> & { supplierId: string; locationId: string },
  actor: string,
  allowedLocationIds?: readonly string[],
): PurchaseOrder {
  assertTenantContext(orgId);
  assertLocationAllowed(orderData.locationId, allowedLocationIds);
  const existingPo = orderData.id
    ? listPurchaseOrders(orgId).find((p) => p.id === orderData.id)
    : undefined;
  if (existingPo) assertLocationAllowed(existingPo.locationId, allowedLocationIds);
  const current = listPurchaseOrders(orgId);
  const suppliers = listSuppliers(orgId);
  const targetSup = suppliers.find((s) => s.id === orderData.supplierId);
  const now = new Date().toISOString();

  const items = (orderData.items || []).map((it) => ({
    ...it,
    subtotalCents: it.unitPriceCents * it.quantityOrdered,
  }));

  const { subtotalCents, totalCents } = calculatePOTotals({
    items,
    taxCents: orderData.taxCents,
    discountCents: orderData.discountCents,
    shippingCents: orderData.shippingCents,
  });

  let po: PurchaseOrder;
  if (orderData.id) {
    const idx = current.findIndex((p) => p.id === orderData.id);
    if (idx >= 0 && current[idx]) {
      const existing = current[idx];
      if (existing.status === "received" || existing.status === "cancelled") {
        throw new Error("Completed or cancelled purchase orders cannot be edited");
      }
      po = {
        ...existing,
        ...orderData,
        supplierName: targetSup?.name || existing.supplierName,
        items,
        subtotalCents,
        totalCents,
        updatedAt: now,
        history: [
          ...existing.history,
          {
            id: `hist-${Date.now()}`,
            timestamp: now,
            actor,
            fromStatus: existing.status,
            toStatus: orderData.status || existing.status,
            action: "PO Updated",
            notes: orderData.notes,
          },
        ],
      };
      current[idx] = po;
    } else {
      throw new Error("PO not found");
    }
  } else {
    const count = current.length + 1;
    const poNum = `PO-${String(count).padStart(5, "0")}`;
    po = {
      id: `po-${crypto.randomUUID()}`,
      poNumber: poNum,
      orgId,
      locationId: orderData.locationId,
      supplierId: orderData.supplierId,
      supplierName: targetSup?.name || "Unknown Vendor",
      status: orderData.status || "draft",
      expectedDeliveryDate: orderData.expectedDeliveryDate,
      items,
      subtotalCents,
      taxCents: orderData.taxCents || 0,
      discountCents: orderData.discountCents || 0,
      shippingCents: orderData.shippingCents || 0,
      totalCents,
      notes: orderData.notes || "",
      history: [
        {
          id: `hist-${Date.now()}`,
          timestamp: now,
          actor,
          toStatus: orderData.status || "draft",
          action: "PO Created",
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    current.unshift(po);
  }

  if (typeof window !== "undefined") {
    localStorage.setItem(`${PO_KEY_PREFIX}${assertTenantContext(orgId)}`, JSON.stringify(current));
  }
  return po;
}

export interface ReceiveItemVerification {
  itemId: string;
  receivedNow: number;
  priceVerifiedCents?: number;
  divergenceReason?: string;
}

export function processPOReceiving(
  orgId: string,
  poId: string,
  receivedItems: ReceiveItemVerification[],
  actor: string,
  receivingNotes?: string,
  allowedLocationIds?: readonly string[],
): PurchaseOrder {
  const current = listPurchaseOrders(orgId);
  const idx = current.findIndex((p) => p.id === poId);
  if (idx < 0 || !current[idx]) {
    throw new Error("Purchase order not found");
  }
  const po = current[idx];
  assertLocationAllowed(po.locationId, allowedLocationIds);
  if (po.status === "received" || po.status === "cancelled") {
    throw new Error("PO is already finalized and cannot receive more goods");
  }

  const now = new Date().toISOString();
  let anyReceived = false;
  let fullyCompleted = true;

  const updatedItems = po.items.map((it) => {
    const check = receivedItems.find((r) => r.itemId === it.id);
    if (!check || check.receivedNow <= 0) {
      if (it.quantityReceived < it.quantityOrdered) fullyCompleted = false;
      return it;
    }

    const newReceived = it.quantityReceived + check.receivedNow;
    if (newReceived > it.quantityOrdered) {
      throw new Error(`Quantity received for ${it.name} exceeds ordered amount`);
    }
    anyReceived = true;

    // Integrate into inventory item stock & movement log
    try {
      recordInventoryMovement({
        orgId,
        itemId: it.inventoryItemId,
        type: "in",
        quantity: check.receivedNow,
        unitCostCents: check.priceVerifiedCents ?? it.unitPriceCents,
        reason: `PO ${po.poNumber} Receiving (${po.supplierName})`,
        performedBy: actor,
        sourceLocationId: po.locationId,
      });
    } catch (e) {
      // Fallback: update inventory item directly if record throws
      const items = listInventory(orgId, po.locationId);
      const found = items.find((i) => i.id === it.inventoryItemId);
      if (found) {
        found.quantity += check.receivedNow;
        found.costCents = check.priceVerifiedCents ?? it.unitPriceCents;
        saveInventoryItem(orgId, found);
      }
    }

    if (newReceived < it.quantityOrdered) fullyCompleted = false;

    return {
      ...it,
      quantityReceived: newReceived,
      unitPriceCents: check.priceVerifiedCents ?? it.unitPriceCents,
      subtotalCents: (check.priceVerifiedCents ?? it.unitPriceCents) * it.quantityOrdered,
      divergenceNote: check.divergenceReason || it.divergenceNote,
    };
  });

  if (!anyReceived) {
    throw new Error("No received quantities were entered");
  }

  const newStatus: POStatus = fullyCompleted ? "received" : "partially_received";
  const updatedPO: PurchaseOrder = {
    ...po,
    status: newStatus,
    items: updatedItems,
    receivingNotes: receivingNotes || po.receivingNotes,
    receivedBy: actor,
    receivedAt: now,
    updatedAt: now,
    history: [
      ...po.history,
      {
        id: `hist-${Date.now()}`,
        timestamp: now,
        actor,
        fromStatus: po.status,
        toStatus: newStatus,
        action: fullyCompleted ? "Goods Full Delivery Confirmed" : "Partial Delivery Checked",
        notes: receivingNotes,
      },
    ],
  };

  current[idx] = updatedPO;
  if (typeof window !== "undefined") {
    localStorage.setItem(`${PO_KEY_PREFIX}${assertTenantContext(orgId)}`, JSON.stringify(current));
  }
  return updatedPO;
}

export function cancelPurchaseOrder(
  orgId: string,
  poId: string,
  actor: string,
  reason: string,
  allowedLocationIds?: readonly string[],
): PurchaseOrder {
  const current = listPurchaseOrders(orgId);
  const idx = current.findIndex((p) => p.id === poId);
  if (idx < 0 || !current[idx]) throw new Error("PO not found");
  const po = current[idx];
  assertLocationAllowed(po.locationId, allowedLocationIds);
  if (po.status === "received") throw new Error("Cannot cancel fully received PO");

  const now = new Date().toISOString();
  const updated: PurchaseOrder = {
    ...po,
    status: "cancelled",
    updatedAt: now,
    history: [
      ...po.history,
      {
        id: `hist-${Date.now()}`,
        timestamp: now,
        actor,
        fromStatus: po.status,
        toStatus: "cancelled",
        action: "PO Cancelled",
        notes: reason,
      },
    ],
  };

  current[idx] = updated;
  if (typeof window !== "undefined") {
    localStorage.setItem(`${PO_KEY_PREFIX}${assertTenantContext(orgId)}`, JSON.stringify(current));
  }
  return updated;
}
