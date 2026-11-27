/**
 * Menu engineering (Kasavana & Smith): each dish placed by how much it sells (menu mix) and how much
 * it leaves per unit (contribution margin = average selling price − recipe cost per serving).
 *
 *   star       popular and above-average margin: keep it, protect quality and placement
 *   plowhorse  popular, below-average margin: review portion, recipe cost or price
 *   puzzle     above-average margin, sells little: promote it, rename, suggest it at the table
 *   dog        sells little, below-average margin: rework or take it off the menu
 *
 * Popular = menu mix at least 70% of an even share (1/N of the units of the classified dishes).
 * High margin = at least the units-weighted average contribution margin of the classified dishes.
 *
 * Only dishes with a recipe cost are classified: a dish without a recipe (or whose ingredients have no
 * cost) is listed apart and never given an estimated cost. Sales are what was sold in the period
 * (unit price with options, before order discounts and tax); the cost is the CURRENT recipe cost of
 * the store where it was sold (option ingredients are not in the recipe).
 */

export type MenuClass = "star" | "plowhorse" | "puzzle" | "dog";

export interface MenuSalesRow {
  location_id: string;
  product_id: string;
  product_name: string;
  units: number;
  sales_cents: number;
}

export interface RecipeCost {
  productId: string;
  /** The store (database id) the recipe belongs to. */
  locationId: string;
  /** NaN when the cost is unknown (an ingredient without cost). */
  costPerServingCents: number;
}

export interface MenuItemAnalysis {
  productId: string;
  name: string;
  units: number;
  salesCents: number;
  avgPriceCents: number;
  /** Recipe cost per unit sold (units-weighted across stores); null when unknown. */
  unitCostCents: number | null;
  /** Average selling price − unit cost; null when the cost is unknown. */
  marginCents: number | null;
  /** Share of the classified dishes' units (0..1); null for unclassified dishes. */
  mix: number | null;
  menuClass: MenuClass | null;
}

export interface MenuEngineering {
  /** Classified dishes, stars first, then by contribution (margin × units). */
  items: MenuItemAnalysis[];
  /** Sold, but without a recipe cost: not classified. */
  noCost: MenuItemAnalysis[];
  /** Thresholds used (null when fewer than two dishes could be classified). */
  popularityThreshold: number | null;
  averageMarginCents: number | null;
  totalUnits: number;
}

const CLASS_ORDER: Record<MenuClass, number> = { star: 0, plowhorse: 1, puzzle: 2, dog: 3 };

export function analyzeMenu(
  rows: readonly MenuSalesRow[],
  recipes: readonly RecipeCost[],
): MenuEngineering {
  const costOf = new Map(
    recipes.map((r) => [`${r.locationId}:${r.productId}`, r.costPerServingCents]),
  );
  const byProduct = new Map<
    string,
    { name: string; units: number; sales: number; cost: number; costKnown: boolean }
  >();
  for (const r of rows) {
    const units = Number(r.units);
    if (!(units > 0)) continue;
    const cur = byProduct.get(r.product_id) ?? {
      name: r.product_name,
      units: 0,
      sales: 0,
      cost: 0,
      costKnown: true,
    };
    const unitCost = costOf.get(`${r.location_id}:${r.product_id}`);
    cur.units += units;
    cur.sales += Number(r.sales_cents);
    if (unitCost === undefined || !Number.isFinite(unitCost)) cur.costKnown = false;
    else cur.cost += unitCost * units;
    byProduct.set(r.product_id, cur);
  }
  const base = [...byProduct.entries()].map(([productId, p]) => ({
    productId,
    name: p.name,
    units: p.units,
    salesCents: p.sales,
    avgPriceCents: Math.round(p.sales / p.units),
    unitCostCents: p.costKnown ? Math.round(p.cost / p.units) : null,
    marginCents: p.costKnown ? Math.round((p.sales - p.cost) / p.units) : null,
    totalMargin: p.costKnown ? p.sales - p.cost : 0,
  }));
  const costed = base.filter((b) => b.unitCostCents !== null);
  const noCost: MenuItemAnalysis[] = base
    .filter((b) => b.unitCostCents === null)
    .sort((a, b) => b.units - a.units)
    .map(({ totalMargin: _t, ...b }) => ({ ...b, mix: null, menuClass: null }));
  const totalUnits = costed.reduce((n, b) => n + b.units, 0);
  if (costed.length < 2 || totalUnits <= 0) {
    return {
      items: costed.map(({ totalMargin: _t, ...b }) => ({
        ...b,
        mix: totalUnits > 0 ? b.units / totalUnits : null,
        menuClass: null,
      })),
      noCost,
      popularityThreshold: null,
      averageMarginCents: null,
      totalUnits,
    };
  }
  const popularityThreshold = 0.7 / costed.length;
  const averageMargin = costed.reduce((n, b) => n + b.totalMargin, 0) / totalUnits;
  const items = costed
    .map(({ totalMargin, ...b }) => {
      const mix = b.units / totalUnits;
      const popular = mix >= popularityThreshold;
      const high = totalMargin / b.units >= averageMargin;
      const menuClass: MenuClass = popular
        ? high
          ? "star"
          : "plowhorse"
        : high
          ? "puzzle"
          : "dog";
      return { item: { ...b, mix, menuClass }, contribution: totalMargin };
    })
    .sort(
      (a, b) =>
        CLASS_ORDER[a.item.menuClass] - CLASS_ORDER[b.item.menuClass] ||
        b.contribution - a.contribution,
    )
    .map((x) => x.item);
  return {
    items,
    noCost,
    popularityThreshold,
    averageMarginCents: Math.round(averageMargin),
    totalUnits,
  };
}
