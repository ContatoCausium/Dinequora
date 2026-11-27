import type { ReactNode } from "react";
import type { SortState } from "@/lib/use-sort";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Table kit (redesign phase 3). Presentation only: sorting reorders rows already on screen and
 * never changes what is loaded, filtered or counted. Pair with the `data-table` utility (styles.css).
 */
export function SortableTh<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  align = "left",
  className,
}: {
  label: ReactNode;
  sortKey: K;
  sort: SortState<K>;
  onSort: (key: K) => void;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort?.key === sortKey;
  const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      aria-sort={!active ? "none" : sort.dir === "asc" ? "ascending" : "descending"}
      className={cn(align === "right" && "text-right", className)}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={cn(
          "-mx-1.5 inline-flex h-7 items-center gap-1 rounded-md px-1.5 font-medium transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          active && "text-foreground",
          align === "right" && "flex-row-reverse",
        )}
      >
        {label}
        <Icon
          aria-hidden
          className={cn("size-3.5", active ? "text-primary" : "text-muted-foreground/70")}
        />
      </button>
    </th>
  );
}

/** "1–20 of 151" with previous/next; renders nothing for a single page. */
export function Pager({
  page,
  pageCount,
  pageSize,
  total,
  onPage,
  className,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  className?: string;
}) {
  const { t } = useTranslation();
  if (pageCount <= 1) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  return (
    <nav
      aria-label={t("table.pagination")}
      className={cn(
        "flex items-center justify-between gap-3 border-t px-4 py-2.5 text-[13px] text-muted-foreground",
        className,
      )}
    >
      <span className="tabular">{t("table.range", { from, to, total })}</span>
      <div className="flex items-center gap-1.5">
        <span className="tabular mr-1 hidden sm:inline">
          {t("table.pageOf", { page, count: pageCount })}
        </span>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label={t("table.previous")}
        >
          <ChevronLeft />
        </Button>
        <Button
          variant="outline"
          size="icon-sm"
          onClick={() => onPage(page + 1)}
          disabled={page >= pageCount}
          aria-label={t("table.next")}
        >
          <ChevronRight />
        </Button>
      </div>
    </nav>
  );
}
