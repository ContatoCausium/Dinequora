import { useMemo, useState } from "react";

/**
 * Column sorting for tables (redesign phase 3). Presentation only: reorders rows already on screen and
 * never changes what is loaded, filtered or counted. Empty values stay last in both directions.
 */
export type SortDir = "asc" | "desc";
export type SortState<K extends string> = { key: K; dir: SortDir } | null;
type SortValue = string | number | null | undefined;

const compare = (a: SortValue, b: SortValue) => {
  if (a == null && b == null) return 0;
  if (a == null) return 1; // empty values always last
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: "base" });
};

/** Sorts `rows` by the active column; `null` keeps the incoming order (the screen's default). */
export function useSort<T, K extends string>(
  rows: readonly T[],
  accessors: Record<K, (row: T) => SortValue>,
  initial: SortState<K> = null,
) {
  const [sort, setSort] = useState<SortState<K>>(initial);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const get = accessors[sort.key];
    const factor = sort.dir === "asc" ? 1 : -1;
    // Stable: ties keep the incoming order.
    return rows
      .map((row, i) => ({ row, i }))
      .sort((x, y) => {
        const [a, b] = [get(x.row), get(y.row)];
        // Empty values stay last in both directions; only real values follow the direction.
        if (a == null || b == null) return compare(a, b) || x.i - y.i;
        return compare(a, b) * factor || x.i - y.i;
      })
      .map((x) => x.row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);
  /** Click cycle: ascending → descending → default order. */
  const toggle = (key: K) =>
    setSort((s) =>
      !s || s.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null,
    );
  return { sorted, sort, toggle };
}
