// Adapters exposing the data shapes intelligence-service expects, built from the existing services.
import { listInventory, computeInventoryMetrics, type InventoryItem } from "./inventory-service";
import { listProductRecipes, type ProductRecipe } from "./recipes-service";
import { listExpenses } from "./finance-service";

export interface IntelligenceTransaction {
  date: string;
  type: "income" | "expense";
  category: string;
  amountCents: number;
}

export function listInventoryItems(orgId: string, locationId?: string): InventoryItem[] {
  return listInventory(orgId, locationId);
}

export function getInventoryKpis(orgId: string, locationId?: string) {
  const m = computeInventoryMetrics(listInventory(orgId, locationId));
  return { ...m, totalStockValueCents: m.totalValueCents };
}

export type IntelligenceRecipe = ProductRecipe & { targetPriceCents: number };

export function listRecipes(orgId: string): IntelligenceRecipe[] {
  return listProductRecipes(orgId).map((r) => ({ ...r, targetPriceCents: r.sellingPriceCents }));
}

export function calculateRecipeCost(recipe: ProductRecipe, _items?: InventoryItem[]): number {
  return recipe.costPerServingCents;
}

export function listTransactions(orgId: string, locationId?: string): IntelligenceTransaction[] {
  return listExpenses(orgId, locationId).map((e) => ({
    date: e.paidAt ?? e.dueDate,
    type: "expense",
    category: e.category,
    amountCents: e.amountCents,
  }));
}
