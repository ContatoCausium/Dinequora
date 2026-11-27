/**
 * Purchase forecast: from what sales actually consumed (inventory_consumption, 0044) over the last N
 * days, how long each stock item lasts and how much to buy to cover the next D days and still end at
 * its minimum. Pure; the numbers come only from recorded movements:
 *
 *   daily use     = consumed in the window / days of the window
 *   days of cover = quantity on hand / daily use
 *   suggested     = daily use × D + minimum − on hand   (only when positive)
 *
 * An item with no sales consumption in the window gets no suggestion (nothing to project from); if it is
 * at or below its minimum it is listed apart, so it is not forgotten, but no quantity is invented.
 */

export interface ForecastItem {
  id: string;
  name: string;
  unit: string;
  locationId: string;
  quantity: number;
  minQuantity: number;
  supplier: string;
  active: boolean;
}

export interface ConsumptionRow {
  inventory_item_id: string;
  consumed: number;
}

export interface ForecastLine {
  id: string;
  name: string;
  unit: string;
  locationId: string;
  supplier: string;
  quantity: number;
  minQuantity: number;
  dailyUse: number;
  /** Days the stock on hand lasts at the daily use. */
  coverDays: number;
  /** Quantity to buy, rounded up (whole units for countable units, 0.1 otherwise). */
  suggested: number;
}

export interface PurchaseForecast {
  /** Items to buy, the ones that run out first at the top. */
  lines: ForecastLine[];
  /** At or below the minimum, but with no sales consumption to project from. */
  belowMinimumNoUse: ForecastItem[];
}

const COUNTABLE = new Set(["units", "pack", "un", "unit", "each", "ea", "pc", "pcs"]);
const roundUp = (v: number, unit: string) =>
  COUNTABLE.has(unit.trim().toLowerCase()) ? Math.ceil(v - 1e-9) : Math.ceil(v * 10 - 1e-9) / 10;

export function purchaseForecast(
  items: readonly ForecastItem[],
  consumption: readonly ConsumptionRow[],
  windowDays: number,
  coverTargetDays: number,
): PurchaseForecast {
  const used = new Map<string, number>();
  for (const r of consumption) {
    const v = Number(r.consumed);
    if (v > 0) used.set(r.inventory_item_id, (used.get(r.inventory_item_id) ?? 0) + v);
  }
  const lines: ForecastLine[] = [];
  const belowMinimumNoUse: ForecastItem[] = [];
  for (const i of items) {
    if (!i.active) continue;
    const consumed = used.get(i.id) ?? 0;
    if (consumed <= 0) {
      if (i.quantity <= i.minQuantity) belowMinimumNoUse.push(i);
      continue;
    }
    const dailyUse = consumed / Math.max(1, windowDays);
    const need = dailyUse * coverTargetDays + i.minQuantity - i.quantity;
    if (need <= 0) continue;
    lines.push({
      id: i.id,
      name: i.name,
      unit: i.unit,
      locationId: i.locationId,
      supplier: i.supplier,
      quantity: i.quantity,
      minQuantity: i.minQuantity,
      dailyUse,
      coverDays: Math.max(0, i.quantity) / dailyUse,
      suggested: roundUp(need, i.unit),
    });
  }
  lines.sort((a, b) => a.coverDays - b.coverDays || a.name.localeCompare(b.name));
  belowMinimumNoUse.sort((a, b) => a.name.localeCompare(b.name));
  return { lines, belowMinimumNoUse };
}
