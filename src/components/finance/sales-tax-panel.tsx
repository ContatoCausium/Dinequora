import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Download, Landmark } from "lucide-react";

import { Panel, Segmented } from "@/components/app/page";
import { EmptyState, Skeleton } from "@/components/app/states";
import { downloadCsv } from "@/components/app/charts";
import { Button } from "@/components/ui/button";
import { fmtMoneyCents, fmtNumber, fmtPercent } from "@/lib/format";
import { fetchSalesTaxSummary } from "@/lib/operational.functions";

type Months = "3" | "6" | "12";

/**
 * Sales tax collected per store and month (0045, read under the member's RLS), for filing and for the
 * accountant: orders, taxable sales (subtotal − discount), tax collected and the effective rate, with a
 * CSV download. Cancelled and simulated orders are left out; tips are not sales.
 */
export function SalesTaxPanel({
  orgId,
  locationId,
  storeName,
}: {
  orgId: string;
  locationId: string;
  storeName: (dbId: string) => string;
}) {
  const { t, i18n } = useTranslation("finance");
  const lng = i18n.language;
  const money = (c: number) => fmtMoneyCents(c, lng);
  const [months, setMonths] = useState<Months>("3");
  const q = useQuery({
    queryKey: ["sales-tax", orgId, locationId, months],
    queryFn: () => fetchSalesTaxSummary({ data: { orgId, locationId, months: Number(months) } }),
    staleTime: 60_000,
  });
  const rows = (q.data ?? [])
    .slice()
    .sort(
      (a, b) =>
        b.month.localeCompare(a.month) ||
        storeName(a.location_id).localeCompare(storeName(b.location_id), lng),
    );
  const rate = (taxable: number, tax: number) => (taxable > 0 ? tax / taxable : 0);

  return (
    <Panel
      title={t("salesTax.title")}
      subtitle={t("salesTax.subtitle")}
      action={
        <div className="flex items-center gap-2">
          <Segmented<Months>
            label={t("salesTax.monthsLabel")}
            value={months}
            onChange={setMonths}
            options={(["3", "6", "12"] as const).map((m) => ({
              value: m,
              label: t("salesTax.months", { count: Number(m) }),
            }))}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(
                `sales-tax-${months}m.csv`,
                [
                  t("salesTax.cols.month"),
                  t("salesTax.cols.store"),
                  t("salesTax.cols.orders"),
                  t("salesTax.cols.taxable"),
                  t("salesTax.cols.tax"),
                  t("salesTax.cols.rate"),
                  t("salesTax.cols.total"),
                ],
                rows.map((r) => [
                  r.month,
                  storeName(r.location_id),
                  r.orders,
                  (r.taxable_cents / 100).toFixed(2),
                  (r.tax_cents / 100).toFixed(2),
                  (rate(r.taxable_cents, r.tax_cents) * 100).toFixed(3),
                  (r.total_cents / 100).toFixed(2),
                ]),
              )
            }
          >
            <Download aria-hidden />
            {t("salesTax.csv")}
          </Button>
        </div>
      }
    >
      {q.isPending ? (
        <Skeleton className="h-32" />
      ) : q.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("salesTax.loadFailed")}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Landmark className="size-5" strokeWidth={1.75} />}
          title={t("salesTax.emptyTitle")}
          body={t("salesTax.emptyBody")}
        />
      ) : (
        <div className="space-y-3">
          <div
            className="overflow-x-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            tabIndex={0}
            role="region"
            aria-label={t("salesTax.tableLabel")}
          >
            <table className="data-table">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="pb-2 font-medium">
                    {t("salesTax.cols.month")}
                  </th>
                  <th scope="col" className="pb-2 font-medium">
                    {t("salesTax.cols.store")}
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    {t("salesTax.cols.orders")}
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    {t("salesTax.cols.taxable")}
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    {t("salesTax.cols.tax")}
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    {t("salesTax.cols.rate")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={`${r.month}-${r.location_id}`}>
                    <td className="tabular py-2.5">{r.month}</td>
                    <td className="py-2.5">{storeName(r.location_id)}</td>
                    <td className="tabular py-2.5 text-right">{fmtNumber(r.orders, lng)}</td>
                    <td className="tabular py-2.5 text-right">{money(r.taxable_cents)}</td>
                    <td className="tabular py-2.5 text-right font-semibold">
                      {money(r.tax_cents)}
                    </td>
                    <td className="tabular py-2.5 text-right">
                      {r.taxable_cents > 0
                        ? fmtPercent(rate(r.taxable_cents, r.tax_cents), lng)
                        : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">{t("salesTax.note")}</p>
        </div>
      )}
    </Panel>
  );
}
