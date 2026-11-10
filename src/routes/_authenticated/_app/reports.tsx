import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileBarChart, RefreshCw, ShieldAlert } from "lucide-react";

import { useWorkspace } from "@/components/app/workspace-context";
import { PageHeader, Panel, Segmented } from "@/components/app/page";
import { StatTile } from "@/components/app/stat-tile";
import { EmptyState, OrdersTruncatedNotice, Skeleton, StateCard } from "@/components/app/states";
import { ColumnSeries, RankedBars, downloadCsv } from "@/components/app/charts";
import { Button } from "@/components/ui/button";
import { fetchOperationalResources } from "@/lib/operational.functions";
import { mapResources } from "@/lib/operational-mappers";
import { fetchAllOrders, periodStart } from "@/lib/recorded-data";
import { buildReport, dayKey, expensesInPeriod } from "@/lib/report-metrics";
import { financialResult, todayIso } from "@/lib/expense-metrics";
import { fmtDate, fmtMoneyCents, fmtNumber, fmtPercent } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/_app/reports")({
  head: () => ({
    meta: [
      { title: "Reports · Dinequora" },
      { name: "description", content: "Sales, product and result reports from recorded data." },
    ],
  }),
  component: ReportsPage,
});

type Period = "7d" | "30d" | "90d";

function ReportsPage() {
  const { t, i18n } = useTranslation("reports");
  const { t: tOrders } = useTranslation("orders");
  const lng = i18n.language;
  const { org, locationId, role } = useWorkspace();
  const [period, setPeriod] = useState<Period>("30d");
  const since = periodStart(period);
  const days = Number(period.replace("d", ""));
  const timeZone =
    locationId === "all"
      ? org.locations[0]?.timezone
      : org.locations.find((l) => l.id === locationId)?.timezone;

  const query = useQuery({
    queryKey: ["reports", org.id, locationId, period],
    enabled: role !== "staff",
    queryFn: async () => {
      const [orders, resources] = await Promise.all([
        fetchAllOrders(org.id, locationId, since),
        fetchOperationalResources({ data: { orgId: org.id, locationId } }),
      ]);
      return { orders: orders.orders, ordersTotal: orders.total, resources };
    },
  });

  const report = useMemo(() => {
    if (!query.data) return null;
    const r = buildReport({
      orders: query.data.orders,
      ledger: query.data.resources.finance,
      since,
      days,
      timeZone,
    });
    const expenses = expensesInPeriod(
      mapResources(query.data.resources).expenses,
      dayKey(since, timeZone),
      todayIso(),
    );
    return {
      ...r,
      expensesCents: expenses,
      ...financialResult({
        revenueCents: r.revenueCents,
        cogsCents: r.cogsCents,
        expensesCents: expenses,
      }),
    };
  }, [query.data, since, days, timeZone]);

  if (role === "staff") {
    return (
      <div className="mx-auto max-w-[900px]">
        <EmptyState
          icon={<ShieldAlert className="size-5" />}
          title={t("title")}
          body={t("loadFailed")}
        />
      </div>
    );
  }

  const money = (c: number) => fmtMoneyCents(c, lng);
  const storeName = (slug: string) => org.locations.find((l) => l.id === slug)?.name ?? slug;
  const dayLabel = (d: string) => fmtDate(d, lng, { day: "numeric", month: "short" });
  const file = (name: string) =>
    `${org.name.replace(/[^\w]+/g, "-").toLowerCase()}-${name}-${period}.csv`;

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <PageHeader
        eyebrow={<span className="eyebrow">{org.name}</span>}
        title={t("title")}
        description={t("subtitle")}
        actions={
          <>
            <Segmented
              label={t("period")}
              value={period}
              onChange={setPeriod}
              options={(["7d", "30d", "90d"] as const).map((p) => ({
                value: p,
                label: t(`periods.${p}`),
              }))}
            />
            <Button
              variant="outline"
              size="icon"
              aria-label={t("retry")}
              onClick={() => void query.refetch()}
              disabled={query.isFetching}
            >
              <RefreshCw className={cn("size-4", query.isFetching && "animate-spin")} />
            </Button>
          </>
        }
      />

      {query.error ? (
        <div className="surface">
          <StateCard
            tone="danger"
            icon={<FileBarChart className="size-5" />}
            title={t("loadFailed")}
            action={
              <Button variant="outline" onClick={() => void query.refetch()}>
                {t("retry")}
              </Button>
            }
          />
        </div>
      ) : !report ? (
        <div className="grid gap-4 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[92px] rounded-xl" />
          ))}
          <Skeleton className="h-72 rounded-xl lg:col-span-4" />
        </div>
      ) : (
        <>
          {query.data && query.data.orders.length < query.data.ordersTotal && (
            <div className="mb-4">
              <OrdersTruncatedNotice
                shown={query.data.orders.length}
                total={query.data.ordersTotal}
              />
            </div>
          )}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatTile
              label={t("kpi.netSales")}
              value={money(report.revenueCents)}
              hint={t("kpi.netSalesHint")}
            />
            <StatTile
              label={t("kpi.orders")}
              value={fmtNumber(report.orderCount, lng)}
              hint={`${t("kpi.avgTicket")}: ${money(report.avgTicketCents)}`}
            />
            <StatTile
              label={t("kpi.cogsRate")}
              value={report.cogsRate == null ? "—" : fmtPercent(report.cogsRate, lng)}
              hint={report.cogsRate == null ? t("kpi.noRevenue") : t("kpi.cogsRateHint")}
            />
            <StatTile
              label={t("kpi.grossMargin")}
              value={report.grossMargin == null ? "—" : fmtPercent(report.grossMargin, lng)}
              hint={money(report.grossProfitCents)}
            />
          </div>

          <Panel
            title={t("daily.title")}
            subtitle={t("daily.subtitle")}
            action={
              <CsvButton
                label={t("exportCsv")}
                onClick={() =>
                  downloadCsv(
                    file("daily"),
                    [t("csv.day"), t("csv.sales")],
                    report.daily.map((d) => [d.day, (d.cents / 100).toFixed(2)]),
                  )
                }
              />
            }
          >
            {report.daysWithSales === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">{t("daily.empty")}</p>
            ) : (
              <>
                <ColumnSeries
                  caption={t("daily.title")}
                  format={money}
                  points={report.daily.map((d) => ({
                    key: d.day,
                    label: dayLabel(d.day),
                    value: d.cents,
                  }))}
                />
                {report.daysWithSales === 1 && (
                  <p className="mt-3 text-xs text-muted-foreground">{t("daily.singleDay")}</p>
                )}
              </>
            )}
          </Panel>

          <div className="grid gap-6 lg:grid-cols-2">
            <Panel
              title={t("byStore.title")}
              action={
                <CsvButton
                  label={t("exportCsv")}
                  onClick={() =>
                    downloadCsv(
                      file("stores"),
                      [t("csv.store"), t("csv.orders"), t("csv.sales")],
                      report.byStore.map((s) => [
                        storeName(s.locationId),
                        s.orders,
                        (s.cents / 100).toFixed(2),
                      ]),
                    )
                  }
                />
              }
            >
              <RankedBars
                caption={t("byStore.title")}
                format={money}
                empty={t("byStore.empty")}
                rows={report.byStore.map((s) => ({
                  key: s.locationId,
                  label: storeName(s.locationId),
                  value: s.cents,
                  hint: `${fmtNumber(s.orders, lng)} ${t("kpi.orders").toLowerCase()}`,
                }))}
              />
            </Panel>
            <Panel title={t("byChannel.title")}>
              <RankedBars
                caption={t("byChannel.title")}
                format={money}
                empty={t("byChannel.empty")}
                rows={report.byChannel.map((c) => ({
                  key: c.channel,
                  label: tOrders(`types.${c.channel}`),
                  value: c.cents,
                  hint: `${fmtNumber(c.orders, lng)} ${t("kpi.orders").toLowerCase()}`,
                }))}
              />
            </Panel>
          </div>

          <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Panel
              title={t("products.title")}
              subtitle={t("products.subtitle")}
              bodyClassName="p-0 pt-3"
              action={
                <CsvButton
                  label={t("exportCsv")}
                  onClick={() =>
                    downloadCsv(
                      file("products"),
                      [t("csv.product"), t("csv.qty"), t("csv.sales")],
                      report.products.map((p) => [p.name, p.qty, (p.cents / 100).toFixed(2)]),
                    )
                  }
                />
              }
            >
              {report.products.length === 0 ? (
                <p className="px-5 pb-5 text-sm text-muted-foreground">{t("products.empty")}</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr className="border-y">
                      <th className="px-5 py-2 font-medium">{t("products.product")}</th>
                      <th className="px-5 py-2 text-right font-medium">{t("products.qty")}</th>
                      <th className="px-5 py-2 text-right font-medium">{t("products.sales")}</th>
                      <th className="px-5 py-2 text-right font-medium">{t("products.share")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(() => {
                      const total = report.products.reduce((s, p) => s + p.cents, 0);
                      return report.products.map((p) => (
                        <tr key={p.name} className="border-b last:border-0">
                          <td className="px-5 py-2.5">{p.name}</td>
                          <td className="tabular px-5 py-2.5 text-right">
                            {fmtNumber(p.qty, lng)}
                          </td>
                          <td className="tabular px-5 py-2.5 text-right font-medium">
                            {money(p.cents)}
                          </td>
                          <td className="tabular px-5 py-2.5 text-right text-muted-foreground">
                            {fmtPercent(total ? p.cents / total : 0, lng)}
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              )}
            </Panel>

            <Panel title={t("pnl.title")} subtitle={t("pnl.subtitle")}>
              <dl className="space-y-2.5 text-sm">
                <PnlRow label={t("pnl.revenue")} value={money(report.revenueCents)} />
                <PnlRow label={t("pnl.cogs")} value={`− ${money(report.cogsCents)}`} muted />
                <PnlRow label={t("pnl.gross")} value={money(report.grossProfitCents)} strong />
                <PnlRow
                  label={t("pnl.expenses")}
                  value={`− ${money(report.expensesCents)}`}
                  muted
                />
                <div className="flex items-baseline justify-between border-t pt-3">
                  <dt className="font-semibold">{t("pnl.result")}</dt>
                  <dd
                    className={cn(
                      "tabular text-lg font-semibold",
                      report.resultCents < 0 && "text-destructive",
                    )}
                  >
                    {money(report.resultCents)}
                  </dd>
                </div>
              </dl>
              <ul className="mt-4 space-y-1.5 text-xs text-muted-foreground">
                <li>{t("pnl.cogsNote")}</li>
                <li>{t("pnl.purchasesNote")}</li>
              </ul>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function CsvButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button variant="ghost" size="sm" onClick={onClick}>
      <Download /> {label}
    </Button>
  );
}

function PnlRow({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className={cn(muted ? "text-muted-foreground" : "", strong && "font-medium")}>{label}</dt>
      <dd className={cn("tabular", strong && "font-medium")}>{value}</dd>
    </div>
  );
}
