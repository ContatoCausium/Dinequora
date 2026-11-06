import { listInventory, saveInventoryItem, type InventoryItem } from "./inventory-service";
import {
  assertLocationAllowed,
  assertTenantContext,
  isLocationAllowed,
  readTenantRecords,
  writeTenantRecords,
} from "./tenant-storage";

export type MovementType = "in" | "out" | "adjustment" | "loss" | "transfer";

export interface InventoryMovement {
  id: string;
  orgId: string;
  itemId: string;
  itemName: string;
  type: MovementType;
  quantityDelta: number;
  previousQuantity: number;
  resultingQuantity: number;
  unitCostCents: number;
  totalCostCents: number;
  reason: string;
  performedBy: string;
  sourceLocationId: string;
  targetLocationId?: string | undefined;
  createdAt: string;
}

export interface RecordMovementParams {
  orgId: string;
  itemId: string;
  type: MovementType;
  quantity: number;
  reason: string;
  performedBy: string;
  unitCostCents?: number;
  sourceLocationId: string;
  targetLocationId?: string | undefined;
  allowNegativeStock?: boolean;
  /** Stores the caller may act on; undefined = org-wide caller (owner). */
  allowedLocationIds?: readonly string[] | undefined;
}

function readMovementsStore(orgId: string): InventoryMovement[] {
  return readTenantRecords<InventoryMovement>("inventory_movements", orgId);
}

function writeMovementsStore(orgId: string, movements: InventoryMovement[]): void {
  writeTenantRecords("inventory_movements", orgId, movements);
}

export function listInventoryMovements(
  orgId: string,
  filter?: {
    locationId?: string | undefined;
    itemId?: string;
    type?: MovementType;
    startDate?: string;
    endDate?: string;
  },
  allowedLocationIds?: readonly string[],
): InventoryMovement[] {
  assertTenantContext(orgId);
  const requested = filter?.locationId;
  if (requested && requested !== "all" && !isLocationAllowed(requested, allowedLocationIds))
    return [];
  const all = readMovementsStore(orgId);
  return all.filter((mov) => {
    if (mov.orgId !== orgId) {
      return false;
    }
    // Each side of a transfer is recorded with its own store as source.
    if (!isLocationAllowed(mov.sourceLocationId, allowedLocationIds)) {
      return false;
    }
    if (filter?.locationId && filter.locationId !== "all") {
      if (
        mov.sourceLocationId !== filter.locationId &&
        mov.targetLocationId !== filter.locationId
      ) {
        return false;
      }
    }
    if (filter?.itemId && mov.itemId !== filter.itemId) {
      return false;
    }
    if (filter?.type && mov.type !== filter.type) {
      return false;
    }
    if (filter?.startDate && mov.createdAt < filter.startDate) {
      return false;
    }
    if (filter?.endDate && mov.createdAt > filter.endDate) {
      return false;
    }
    return true;
  });
}

export function recordInventoryMovement(params: RecordMovementParams): {
  movement: InventoryMovement;
  transferMovement?: InventoryMovement | undefined;
} {
  const {
    orgId,
    itemId,
    type,
    quantity,
    reason,
    performedBy,
    sourceLocationId,
    targetLocationId,
    allowNegativeStock,
    allowedLocationIds,
  } = params;
  assertTenantContext(orgId);
  assertLocationAllowed(sourceLocationId, allowedLocationIds);
  if (type === "transfer") assertLocationAllowed(targetLocationId, allowedLocationIds);

  if (quantity <= 0) {
    throw new Error("A quantidade da movimentação deve ser maior que zero.");
  }

  const currentItems = listInventory(orgId, "all");
  const item = currentItems.find((i) => i.id === itemId);
  if (!item) {
    throw new Error("Insumo não encontrado.");
  }
  if (item.locationId !== sourceLocationId) {
    throw new Error("O insumo não pertence à unidade de origem informada.");
  }

  const costPerUnit = params.unitCostCents !== undefined ? params.unitCostCents : item.costCents;
  const now = new Date().toISOString();
  const allMovements = readMovementsStore(orgId);

  let delta = 0;
  if (type === "in") {
    delta = quantity;
  } else if (type === "out" || type === "loss") {
    delta = -quantity;
  } else if (type === "adjustment") {
    delta = quantity - item.quantity;
  } else if (type === "transfer") {
    if (!targetLocationId || targetLocationId === sourceLocationId) {
      throw new Error("Unidade de destino inválida para transferência.");
    }
    delta = -quantity;
  }

  const newQuantity = type === "adjustment" ? quantity : item.quantity + delta;
  if (newQuantity < 0 && !allowNegativeStock) {
    throw new Error("Saldo insuficiente em estoque. Operação de estoque negativo não autorizada.");
  }

  // Atomic balance update on source item
  saveInventoryItem(orgId, {
    ...item,
    quantity: newQuantity,
    costCents: costPerUnit,
  });

  const movement: InventoryMovement = {
    id: `mov-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    orgId,
    itemId,
    itemName: item.name,
    type,
    quantityDelta: delta,
    previousQuantity: item.quantity,
    resultingQuantity: newQuantity,
    unitCostCents: costPerUnit,
    totalCostCents: Math.round(Math.abs(delta) * costPerUnit),
    reason,
    performedBy,
    sourceLocationId,
    targetLocationId: type === "transfer" ? targetLocationId : undefined,
    createdAt: now,
  };

  allMovements.unshift(movement);

  let transferMovement: InventoryMovement | undefined;

  // In case of transfer, update or seed target item atomically
  if (type === "transfer" && targetLocationId) {
    const targetItem = currentItems.find(
      (i) => i.name.toLowerCase() === item.name.toLowerCase() && i.locationId === targetLocationId,
    );

    let targetPrevQty = 0;
    let targetNewQty = quantity;

    if (targetItem) {
      targetPrevQty = targetItem.quantity;
      targetNewQty = targetItem.quantity + quantity;
      saveInventoryItem(orgId, {
        ...targetItem,
        quantity: targetNewQty,
      });
    } else {
      // Seed target store with transferred item
      saveInventoryItem(orgId, {
        orgId,
        name: item.name,
        category: item.category,
        sku: item.sku,
        unit: item.unit,
        quantity: quantity,
        minQuantity: item.minQuantity,
        costCents: costPerUnit,
        supplier: item.supplier,
        expirationDate: item.expirationDate,
        active: true,
        locationId: targetLocationId,
      });
    }

    transferMovement = {
      id: `mov-${Date.now() + 1}-${Math.random().toString(36).slice(2, 7)}`,
      orgId,
      itemId: targetItem?.id || `inv-transferred-${Date.now()}`,
      itemName: item.name,
      type: "in",
      quantityDelta: quantity,
      previousQuantity: targetPrevQty,
      resultingQuantity: targetNewQty,
      unitCostCents: costPerUnit,
      totalCostCents: Math.round(quantity * costPerUnit),
      reason: `Transferência recebida da unidade [${sourceLocationId}]: ${reason}`,
      performedBy,
      sourceLocationId: targetLocationId,
      targetLocationId: sourceLocationId,
      createdAt: now,
    };
    allMovements.unshift(transferMovement);
  }

  writeMovementsStore(orgId, allMovements);
  return { movement, transferMovement };
}
