/**
 * Category identity colors (redesign phase 5). Decorative: the category name is always written next
 * to the color. Colors come from the validated series palette in a fixed order, assigned by the
 * category's position in the name-sorted list, so the POS and the Menu show the same color.
 */
export const CATEGORY_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
] as const;

export function categoryColorMap(
  categories: readonly { id: string; name: string }[],
  lng: string,
): Map<string, string> {
  const sorted = [...categories].sort(
    (a, b) =>
      a.name.localeCompare(b.name, lng, { sensitivity: "base" }) || a.id.localeCompare(b.id),
  );
  return new Map(sorted.map((c, i) => [c.id, CATEGORY_COLORS[i % CATEGORY_COLORS.length]!]));
}

/** "Classic Burger" → "CB": the fallback when a product has no photo. */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
}
