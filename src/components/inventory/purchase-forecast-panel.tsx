import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Download, PackageSearch } from "lucide-react";
import { downloadCsv } from "@/components/app/charts";

import { Panel, Segmented } from "@/components/app/page";
import { EmptyState, Skeleton } from "@/components/app/states";
import { fmtNumber, fmtQuantity } from "@/lib/format";
import { fetchInventoryConsumption } from "@/lib/operational.functions";
import { purchaseForecast, type ForecastItem, type ForecastLine } from "@/lib/purchase-forecast";
import { Button } from "@/components/ui/button";

const WINDOW_DAYS = 30;
type Cover = "7" | "14";

/**
 * Purchase forecast (Inventory > Purchases): what to buy to cover the next 7 or 14 days, from what sales
 * actually consumed in the last 30 days (0044, read under the member's RLS). See purchase-forecast.ts.
 */
export function PurchaseForecastPanel({
  orgId,
  locationId,
  items,
  storeName,
  unitLabel,
  onOrder,
}: {
  orgId: string;
  locationId: string;
  items: readonly ForecastItem[];
  storeName: ((locationId: string) => string) | null;
  unitLabel: (unit: string, count?: number) => string;
  /** When the member may create purchase orders: start one from a suggested line. */
  onOrder?: ((line: ForecastLine) => void) | undefined;
}) {
  const { t, i18n } = useTranslation("inventory");
  const lng = i18n.language;
  const [cover, setCover] = useState<Cover>("7");
  const q = useQuery({
    queryKey: ["inventory-consumption", orgId, locationId, WINDOW_DAYS],
    queryFn: () => fetchInventoryConsumption({ data: { orgId, locationId, days: WINDOW_DAYS } }),
    staleTime: 60_000,
  });
  const forecast = useMemo(
    () => (q.data ? purchaseForecast(items, q.data, WINDOW_DAYS, Number(cover)) : null),
    [q.data, items, cover],
  );
  const qty = (v: number, unit: string) => `${fmtQuantity(v, lng)} ${unitLabel(unit, Math.abs(v))}`;

  return (
    <Panel
      title={t("forecast.title")}
      subtitle={t("forecast.subtitle", { days: WINDOW_DAYS })}
      action={
        <div className="flex items-center gap-2">
          <Segmented<Cover>
            label={t("forecast.coverLabel")}
            value={cover}
            onChange={setCover}
            options={(["7", "14"] as const).map((d) => ({
              value: d,
              label: t("forecast.coverDays", { count: Number(d) }),
            }))}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!forecast || forecast.lines.length === 0}
            onClick={() =>
              forecast &&
              downloadCsv(
                `purchase-forecast-${cover}d.csv`,
                [
                  t("forecast.cols.item"),
                  t("forecast.cols.store"),
                  t("forecast.cols.onHand"),
                  t("forecast.cols.dailyUse"),
                  t("forecast.cols.cover"),
                  t("forecast.cols.buy"),
                  t("forecast.cols.unit"),
                  t("forecast.cols.supplier"),
                ],
                forecast.lines.map((l) => [
                  l.name,
                  storeName ? storeName(l.locationId) : "",
                  l.quantity,
                  Math.round(l.dailyUse * 100) / 100,
                  Math.floor(l.coverDays),
                  l.suggested,
                  l.unit,
                  l.supplier,
                ]),
              )
            }
          >
            <Download aria-hidden />
            {t("forecast.csv")}
          </Button>
        </div>
      }
    >
      {q.isPending ? (
        <Skeleton className="h-32" />
      ) : q.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("forecast.loadFailed")}
        </p>
      ) : !forecast || (forecast.lines.length === 0 && forecast.belowMinimumNoUse.length === 0) ? (
        <EmptyState
          icon={<PackageSearch className="size-5" strokeWidth={1.75} />}
          title={t("forecast.emptyTitle")}
          body={t("forecast.emptyBody", { count: Number(cover) })}
        />
      ) : (
        <div className="space-y-3">
          {forecast.lines.length > 0 && (
            <div
              className="overflow-x-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              tabIndex={0}
              role="region"
              aria-label={t("forecast.tableLabel")}
            >
              <table className="data-table">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th scope="col" className="pb-2 font-medium">
                      {t("forecast.cols.item")}
                    </th>
                    {storeName && (
                      <th scope="col" className="pb-2 font-medium">
                        {t("forecast.cols.store")}
                      </th>
                    )}
                    <th scope="col" className="pb-2 text-right font-medium">
                      {t("forecast.cols.onHand")}
                    </th>
                    <th scope="col" className="pb-2 text-right font-medium">
                      {t("forecast.cols.dailyUse")}
                    </th>
                    <th scope="col" className="pb-2 text-right font-medium">
                      {t("forecast.cols.cover")}
                    </th>
                    <th scope="col" className="pb-2 text-right font-medium">
                      {t("forecast.cols.buy")}
                    </th>
                    <th scope="col" className="pb-2 font-medium">
                      {t("forecast.cols.supplier")}
                    </th>
                    {onOrder && (
                      <th scope="col" className="pb-2">
                        <span className="sr-only">{t("forecast.cols.order")}</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {forecast.lines.map((l) => (
                    <tr key={l.id}>
                      <td className="py-2.5 font-medium">{l.name}</td>
                      {storeName && <td className="py-2.5">{storeName(l.locationId)}</td>}
                      <td className="tabular py-2.5 text-right">{qty(l.quantity, l.unit)}</td>
                      <td className="tabular py-2.5 text-right">{qty(l.dailyUse, l.unit)}</td>
                      <td
                        className={
                          l.coverDays < 2
                            ? "tabular py-2.5 text-right font-semibold text-destructive"
                            : "tabular py-2.5 text-right"
                        }
                      >
                        {t("forecast.days", {
                          count: Math.floor(l.coverDays),
                          formatted: fmtNumber(Math.floor(l.coverDays), lng),
                        })}
                      </td>
                      <td className="tabular py-2.5 text-right font-semibold">
                        {qty(l.suggested, l.unit)}
                      </td>
                      <td className="py-2.5 text-muted-foreground">{l.supplier || "—"}</td>
                      {onOrder && (
                        <td className="py-2.5 text-right">
                          <Button
                            variant="outline"
                            size="sm"
                            aria-label={t("forecast.orderItem", { item: l.name })}
                            onClick={() => onOrder(l)}
                          >
                            {t("forecast.order")}
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {forecast.belowMinimumNoUse.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {t("forecast.noUse", {
                count: forecast.belowMinimumNoUse.length,
                names: forecast.belowMinimumNoUse
                  .slice(0, 8)
                  .map((i) => i.name)
                  .join(", "),
              })}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {t("forecast.method", { days: WINDOW_DAYS, count: Number(cover) })}
          </p>
        </div>
      )}
    </Panel>
  );
}
