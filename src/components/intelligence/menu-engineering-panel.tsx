import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "@tanstack/react-router";
import { ChevronRight, UtensilsCrossed } from "lucide-react";

import { Panel } from "@/components/app/page";
import { EmptyState, Skeleton } from "@/components/app/states";
import { Badge } from "@/components/ui/badge";
import { fmtMoneyCents, fmtNumber, fmtPercent } from "@/lib/format";
import { analyzeMenu, type MenuClass, type RecipeCost } from "@/lib/menu-engineering";
import { fetchMenuItemSales } from "@/lib/operational.functions";

const CLASS_BADGE: Record<MenuClass, "success" | "warning" | "brand" | "danger"> = {
  star: "success",
  plowhorse: "warning",
  puzzle: "brand",
  dog: "danger",
};
const CLASSES: MenuClass[] = ["star", "plowhorse", "puzzle", "dog"];

/**
 * Menu engineering for the store in scope (or all stores): how much each dish sells against how much
 * it leaves per unit, from real sales (0042, read under the member's RLS) and the current recipe cost.
 * See src/lib/menu-engineering.ts for the method.
 */
export function MenuEngineeringPanel({
  orgId,
  locationId,
  periodDays,
  recipes,
}: {
  orgId: string;
  locationId: string;
  periodDays: number;
  recipes: readonly RecipeCost[];
}) {
  const { t, i18n } = useTranslation("intelligence");
  const lng = i18n.language;
  const money = (c: number) => fmtMoneyCents(c, lng);
  const q = useQuery({
    queryKey: ["menu-item-sales", orgId, locationId, periodDays],
    queryFn: () => fetchMenuItemSales({ data: { orgId, locationId, days: periodDays } }),
    staleTime: 60_000,
  });
  const result = useMemo(() => (q.data ? analyzeMenu(q.data, recipes) : null), [q.data, recipes]);
  const counts = useMemo(() => {
    const c: Record<MenuClass, number> = { star: 0, plowhorse: 0, puzzle: 0, dog: 0 };
    for (const i of result?.items ?? []) if (i.menuClass) c[i.menuClass] += 1;
    return c;
  }, [result]);

  return (
    <Panel
      title={t("menuEng.title")}
      subtitle={t("menuEng.subtitle", { count: periodDays })}
      action={
        <Link
          to="/menu"
          className="inline-flex min-h-6 items-center gap-0.5 rounded text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("menuEng.openMenu")}
          <ChevronRight className="size-3.5" aria-hidden />
        </Link>
      }
    >
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("menuEng.loadFailed")}
        </p>
      ) : !result || (result.items.length === 0 && result.noCost.length === 0) ? (
        <EmptyState
          icon={<UtensilsCrossed className="size-5" strokeWidth={1.75} />}
          title={t("menuEng.emptyTitle")}
          body={t("menuEng.emptyBody", { count: periodDays })}
        />
      ) : (
        <div className="space-y-4">
          {result.popularityThreshold !== null ? (
            <ul className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label={t("menuEng.legend")}>
              {CLASSES.map((c) => (
                <li key={c} className="rounded-md border px-3 py-2">
                  <p className="flex items-center justify-between gap-2">
                    <Badge variant={CLASS_BADGE[c]}>{t(`menuEng.classes.${c}`)}</Badge>
                    <span className="tabular text-sm font-semibold">
                      {fmtNumber(counts[c], lng)}
                    </span>
                  </p>
                  <p className="mt-1.5 text-xs text-muted-foreground">{t(`menuEng.advice.${c}`)}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">{t("menuEng.tooFew")}</p>
          )}

          {result.items.length > 0 && (
            <div
              className="overflow-x-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              tabIndex={0}
              role="region"
              aria-label={t("menuEng.tableLabel")}
            >
              <table className="data-table">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th scope="col" className="pb-2 font-medium">
                      {t("menuEng.cols.dish")}
                    </th>
                    <th scope="col" className="pb-2 font-medium">
                      {t("menuEng.cols.class")}
                    </th>
                    <th scope="col" className="pb-2 text-right font-medium">
                      {t("menuEng.cols.units")}
                    </th>
                    <th scope="col" className="pb-2 text-right font-medium">
                      {t("menuEng.cols.mix")}
                    </th>
                    <th scope="col" className="pb-2 text-right font-medium">
                      {t("menuEng.cols.price")}
                    </th>
                    <th scope="col" className="pb-2 text-right font-medium">
                      {t("menuEng.cols.cost")}
                    </th>
                    <th scope="col" className="pb-2 text-right font-medium">
                      {t("menuEng.cols.margin")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {result.items.map((i) => (
                    <tr key={i.productId}>
                      <td className="py-2.5 font-medium">{i.name}</td>
                      <td className="py-2.5">
                        {i.menuClass ? (
                          <Badge variant={CLASS_BADGE[i.menuClass]}>
                            {t(`menuEng.classes.${i.menuClass}`)}
                          </Badge>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="tabular py-2.5 text-right">{fmtNumber(i.units, lng)}</td>
                      <td className="tabular py-2.5 text-right">
                        {i.mix === null ? "—" : fmtPercent(i.mix, lng)}
                      </td>
                      <td className="tabular py-2.5 text-right">{money(i.avgPriceCents)}</td>
                      <td className="tabular py-2.5 text-right">
                        {i.unitCostCents === null ? "—" : money(i.unitCostCents)}
                      </td>
                      <td className="tabular py-2.5 text-right">
                        {i.marginCents === null ? "—" : money(i.marginCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {result.noCost.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("menuEng.noCost", {
                count: result.noCost.length,
                names: result.noCost
                  .slice(0, 6)
                  .map((i) => i.name)
                  .join(", "),
              })}
              {result.noCost.length > 6 &&
                ` ${t("menuEng.andMore", { count: result.noCost.length - 6 })}`}
            </p>
          )}

          {result.averageMarginCents !== null && result.popularityThreshold !== null && (
            <p className="text-xs text-muted-foreground">
              {t("menuEng.method", {
                margin: money(result.averageMarginCents),
                mix: fmtPercent(result.popularityThreshold, lng),
              })}
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
