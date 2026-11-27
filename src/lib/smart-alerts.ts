/**
 * Deterministic alerts for Insights (plan Phase 5, use case 4), from data the page already reads:
 *
 *   salesDrop               sales of the period against the period before it (complete ledger only)
 *   supplierPriceIncreases  the last purchase price of a stock item against the one before it
 *
 * No model, no estimate: an alert exists only when both figures exist and the change passes the threshold.
 */

/** Relative change of the period (negative = drop), or null when there is nothing to compare. */
export function salesDrop(
  currentCents: number,
  previousCents: number,
  threshold = 0.15,
): { change: number } | null {
  if (!(previousCents > 0) || currentCents < 0) return null;
  const change = (currentCents - previousCents) / previousCents;
  return change <= -threshold ? { change } : null;
}

export interface PurchaseRow {
  id: string;
  status: string;
  supplier_id: string;
  created_at: string;
  purchase_order_items?:
    | readonly { inventory_item_id: string; unit_price_cents: number; quantity_ordered: number }[]
    | null;
}

export interface PriceIncrease {
  itemId: string;
  itemName: string;
  supplierName: string | null;
  previousCents: number;
  latestCents: number;
  /** (latest − previous) / previous */
  change: number;
  latestAt: string;
}

/**
 * For each stock item, its unit price in the most recent purchase order (sent, received or partially
 * received; drafts and cancelled orders are not prices that were agreed) against the order before it.
 * Listed when it rose by the threshold or more, the biggest rise first.
 */
export function supplierPriceIncreases(
  purchases: readonly PurchaseRow[],
  names: { items: ReadonlyMap<string, string>; suppliers: ReadonlyMap<string, string> },
  threshold = 0.1,
): PriceIncrease[] {
  const byItem = new Map<string, { at: string; cents: number; supplier: string }[]>();
  for (const po of purchases) {
    if (po.status === "draft" || po.status === "cancelled") continue;
    for (const line of po.purchase_order_items ?? []) {
      if (!(line.unit_price_cents > 0) || !(line.quantity_ordered > 0)) continue;
      const list = byItem.get(line.inventory_item_id) ?? [];
      list.push({ at: po.created_at, cents: line.unit_price_cents, supplier: po.supplier_id });
      byItem.set(line.inventory_item_id, list);
    }
  }
  const out: PriceIncrease[] = [];
  for (const [itemId, list] of byItem) {
    if (list.length < 2) continue;
    list.sort((a, b) => a.at.localeCompare(b.at));
    const latest = list[list.length - 1]!;
    const previous = list[list.length - 2]!;
    const change = (latest.cents - previous.cents) / previous.cents;
    if (change < threshold) continue;
    out.push({
      itemId,
      itemName: names.items.get(itemId) ?? itemId,
      supplierName: names.suppliers.get(latest.supplier) ?? null,
      previousCents: previous.cents,
      latestCents: latest.cents,
      change,
      latestAt: latest.at,
    });
  }
  return out.sort((a, b) => b.change - a.change);
}
