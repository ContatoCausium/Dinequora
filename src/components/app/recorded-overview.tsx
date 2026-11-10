import { useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  CalendarClock,
  ChefHat,
  CircleCheck,
  RefreshCw,
  Truck,
} from "lucide-react";

import { useScopedLocations, useWorkspace } from "./workspace-context";
import { PageHeader, Panel, Segmented } from "./page";
import { StatTile } from "./stat-tile";
import { Skeleton, StateCard } from "./states";
import { ColumnSeries, RankedBars } from "./charts";
import { Button } from "@/components/ui/button";
import { fetchOperationalResources } from "@/lib/operational.functions";
import { mapResources } from "@/lib/operational-mappers";
import { ledgerMetrics } from "@/lib/operational-metrics";
import { fetchAllOrders, OPEN_STATUSES, periodStart } from "@/lib/recorded-data";
import { buildReport, dayKey, isRecordedSale } from "@/lib/report-metrics";
import { prepStats } from "@/lib/kitchen-metrics";
import { netSalesCents, type RecordedOrder } from "@/lib/recorded-data";
import { fmtDateTime } from "@/lib/format";
import { financialResult, summarizeExpenses, todayIso } from "@/lib/expense-metrics";
import { fmtDate, fmtMoneyCents, fmtNumber, fmtPercent, fmtQuantity } from "@/lib/format";
import { cn } from "@/lib/utils";
import { averageCents, multiplyQuantityCents, sumCents } from "@/lib/money";

type Period = "today" | "7d" | "30d";
const DAYS: Record<Period, number> = { today: 1, "7d": 7, "30d": 30 };

/** Executive overview for real (non-demo) organizations — every figure is read from the backend. */
export function RecordedOverview() {
  const { t, i18n } = useTranslation("dashboard");
  const lng = i18n.language;
  const { org, locationId, user, role, can, canAny } = useWorkspace();
  const scopedStores = useScopedLocations();
  const [period, setPeriod] = useState<Period>("7d");
  const since = periodStart(period);
  // Every block is gated by the member's permissions (RLS already limits the rows returned).
  const seeFinancials = canAny(["dashboard.financials", "finance.view"]);
  const seeSales = canAny(["dashboard.financials", "reports.view"]);
  const seeExpenses = canAny(["finance.view", "expenses.view"]);
  const seeStock = can("inventory.view");
  const seePurchases = can("purchases.view");
  const seeKitchen = can("kds.view");
  const showCashier = can("pos.sell") && !seeFinancials;
  const showKitchen = can("kds.operate") && !seeFinancials;
  // The full stock section is for people who operate stock; view-only roles (e.g. kitchen) get the
  // compact "stock alerts" panel instead.
  const showStock =
    canAny(["inventory.adjust", "inventory.edit", "purchases.receive"]) && !seeFinancials;
  const canSeeFinance = seeFinancials;
  const timeZone =
    locationId === "all"
      ? org.locations[0]?.timezone
      : org.locations.find((l) => l.id === locationId)?.timezone;

  const query = useQuery({
    queryKey: ["overview", org.id, locationId, period],
    queryFn: async () => {
      const [orders, resources] = await Promise.all([
        fetchAllOrders(org.id, locationId, since),
        fetchOperationalResources({ data: { orgId: org.id, locationId } }),
      ]);
      return { orders: orders.orders, resources, mapped: mapResources(resources) };
    },
  });

  const view = useMemo(() => {
    if (!query.data) return null;
    const { orders, resources, mapped } = query.data;
    const today = todayIso();
    const report = buildReport({
      orders,
      ledger: resources.finance,
      since,
      days: DAYS[period],
      timeZone,
    });
    const gross = financialResult({
      revenueCents: report.revenueCents,
      cogsCents: report.cogsCents,
      expensesCents: 0,
    });
    // Month-to-date result: ledger since the 1st + expenses whose competency is this month.
    const monthStart = `${today.slice(0, 7)}-01`;
    const monthLedger = ledgerMetrics(
      resources.finance.filter((e) => dayKey(e.created_at, timeZone) >= monthStart),
    );
    const monthExpenses = mapped.expenses
      .filter((e) => !e.isSimulation && e.competencyDate.slice(0, 7) === today.slice(0, 7))
      .reduce((s, e) => s + e.amountCents, 0);
    const month = financialResult({
      revenueCents: monthLedger.revenueCents,
      cogsCents: monthLedger.cogsCents,
      expensesCents: monthExpenses,
    });
    const low = mapped.items
      .filter((i) => i.active && i.quantity <= i.minQuantity)
      .sort((a, b) => a.quantity / (a.minQuantity || 1) - b.quantity / (b.minQuantity || 1));
    return {
      report,
      gross,
      month,
      expenses: summarizeExpenses(mapped.expenses, today),
      low,
      kitchen: orders.filter((o) => OPEN_STATUSES.includes(o.status) && !o.isSimulated).length,
      receiving: mapped.purchases.filter(
        (p) => p.status === "sent" || p.status === "partially_received",
      ).length,
      ...roleViews(orders, mapped, user.id, timeZone),
    };
  }, [query.data, since, period, timeZone, user.id]);

  const money = (c: number) => fmtMoneyCents(c, lng);
  const storeName = (slug: string) => org.locations.find((l) => l.id === slug)?.name ?? slug;
  const monthName = fmtDate(`${todayIso().slice(0, 7)}-01`, lng, { month: "long" });

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <PageHeader
        eyebrow={<span className="eyebrow">{org.name}</span>}
        title={t("home.greeting", { org: org.name })}
        description={[
          t(`home.role.${role}`),
          locationId === "all"
            ? org.locations.length === scopedStores.length && role === "owner"
              ? t("home.scope.all")
              : scopedStores.map((l) => l.name).join(", ")
            : t("home.scope.one", { store: scopedStores[0]?.name ?? "" }),
          t("home.asOf", {
            date: fmtDate(todayIso(), lng, { weekday: "long", day: "numeric", month: "long" }),
          }),
        ].join(" · ")}
        actions={
          <>
            {seeSales && (
              <Segmented
                label={t("home.period")}
                value={period}
                onChange={setPeriod}
                options={(["today", "7d", "30d"] as const).map((p) => ({
                  value: p,
                  label: t(`home.periods.${p}`),
                }))}
              />
            )}
            <Button
              variant="outline"
              size="icon"
              aria-label={t("home.refresh")}
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
            icon={<AlertTriangle className="size-5" />}
            title={t("home.loadFailed")}
            action={
              <Button variant="outline" onClick={() => void query.refetch()}>
                {t("home.retry")}
              </Button>
            }
          />
        </div>
      ) : !view ? (
        <div className="space-y-6">
          <Skeleton className="h-16 rounded-xl" />
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} className="h-[92px] rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-xl" />
        </div>
      ) : (
        <>
          <AttentionStrip
            items={[
              seeExpenses &&
                view.expenses.counts.overdue > 0 && {
                  key: "overdue",
                  tone: "danger" as const,
                  icon: <CalendarClock />,
                  text: t("home.attention.overdue", {
                    count: view.expenses.counts.overdue,
                    amount: money(view.expenses.overdueCents),
                  }),
                  to: "/finance" as const,
                },
              seeExpenses &&
                view.expenses.dueNext7DaysCents > 0 && {
                  key: "due",
                  tone: "warning" as const,
                  icon: <CalendarClock />,
                  text: t("home.attention.dueSoon", {
                    amount: money(view.expenses.dueNext7DaysCents),
                  }),
                  to: "/finance" as const,
                },
              seeStock &&
                view.low.length > 0 && {
                  key: "stock",
                  tone: "warning" as const,
                  icon: <Boxes />,
                  text: t("home.attention.lowStock", { count: view.low.length }),
                  to: "/inventory" as const,
                },
              seeKitchen &&
                view.kitchen > 0 && {
                  key: "kitchen",
                  tone: "neutral" as const,
                  icon: <ChefHat />,
                  text: t("home.attention.kitchen", { count: view.kitchen }),
                  to: "/kds" as const,
                },
              seePurchases &&
                view.receiving > 0 && {
                  key: "receiving",
                  tone: "neutral" as const,
                  icon: <Truck />,
                  text: t("home.attention.receiving", { count: view.receiving }),
                  to: "/inventory" as const,
                },
            ]}
          />

          {showCashier && <CashierSection v={view.cashier} money={money} />}
          {showKitchen && <KitchenSection v={view.kitchenStats} timeZone={timeZone} />}
          {showStock && (
            <StockSection
              v={view.stock}
              low={view.low.length}
              receiving={seePurchases ? view.receiving : null}
              money={money}
              storeName={storeName}
              showStore={locationId === "all"}
            />
          )}

          {seeSales && (
            <>
              <h2 className="eyebrow">{t("home.salesSection")}</h2>
              <div
                className={cn(
                  "grid grid-cols-2 gap-4",
                  canSeeFinance ? "lg:grid-cols-5" : "lg:grid-cols-3",
                )}
              >
                <StatTile
                  label={t("home.kpi.netSales")}
                  value={money(view.report.revenueCents)}
                  hint={
                    view.report.revenueCents ? t("home.kpi.netSalesHint") : t("home.kpi.noSales")
                  }
                />
                <StatTile
                  label={t("home.kpi.orders")}
                  value={fmtNumber(view.report.orderCount, lng)}
                  hint={t("home.kpi.avgTicket", { value: money(view.report.avgTicketCents) })}
                />
                <StatTile
                  label={t("home.kpi.cogs")}
                  value={money(view.report.cogsCents)}
                  hint={
                    view.gross.cogsRate == null
                      ? t("home.kpi.noSales")
                      : t("home.kpi.cogsHint", { value: fmtPercent(view.gross.cogsRate, lng) })
                  }
                />
                {canSeeFinance && (
                  <>
                    <StatTile
                      label={t("home.kpi.gross")}
                      value={money(view.gross.grossProfitCents)}
                      hint={
                        view.gross.grossMargin == null
                          ? t("home.kpi.noSales")
                          : t("home.kpi.grossHint", {
                              value: fmtPercent(view.gross.grossMargin, lng),
                            })
                      }
                    />
                    <StatTile
                      label={t("home.kpi.month")}
                      value={money(view.month.resultCents)}
                      hint={t("home.kpi.monthHint", { month: monthName })}
                      tone={view.month.resultCents < 0 ? "negative" : "positive"}
                    />
                  </>
                )}
              </div>

              <div className="grid gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
                <Panel title={t("home.sales.title")}>
                  {view.report.daysWithSales === 0 ? (
                    <p className="py-12 text-center text-sm text-muted-foreground">
                      {t("home.sales.empty")}
                    </p>
                  ) : period === "today" ? (
                    <p className="tabular py-8 text-center text-3xl font-semibold tracking-tight">
                      {money(view.report.revenueCents)}
                    </p>
                  ) : (
                    <>
                      <ColumnSeries
                        caption={t("home.sales.title")}
                        format={money}
                        points={view.report.daily.map((d) => ({
                          key: d.day,
                          label: fmtDate(d.day, lng, { day: "numeric", month: "short" }),
                          value: d.cents,
                        }))}
                      />
                      {view.report.daysWithSales === 1 && (
                        <p className="mt-3 text-xs text-muted-foreground">
                          {t("home.sales.singleDay")}
                        </p>
                      )}
                    </>
                  )}
                </Panel>
                <Panel title={t("home.sales.stores")}>
                  <RankedBars
                    caption={t("home.sales.stores")}
                    format={money}
                    empty={t("home.sales.empty")}
                    rows={view.report.byStore.map((s) => ({
                      key: s.locationId,
                      label: storeName(s.locationId),
                      value: s.cents,
                      hint: `${fmtNumber(s.orders, lng)} ${t("home.kpi.orders").toLowerCase()}`,
                    }))}
                  />
                </Panel>
              </div>
            </>
          )}

          <div
            className={cn(
              "grid gap-6",
              ["hidden", "lg:grid-cols-1", "lg:grid-cols-2", "lg:grid-cols-3"][
                [seeSales, seeExpenses, seeStock].filter(Boolean).length
              ],
            )}
          >
            {seeSales && (
              <Panel
                title={t("home.products.title")}
                action={
                  canSeeFinance ? (
                    <PanelLink to="/reports" label={t("home.products.viewAll")} />
                  ) : undefined
                }
              >
                {view.report.products.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t("home.products.empty")}</p>
                ) : (
                  <ol className="space-y-2.5 text-sm">
                    {view.report.products.slice(0, 5).map((p, i) => (
                      <li key={p.name} className="flex items-baseline gap-3">
                        <span className="tabular w-4 text-xs text-muted-foreground">{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                        <span className="tabular text-xs text-muted-foreground">
                          {t("home.products.units", { count: p.qty })}
                        </span>
                        <span className="tabular w-24 text-right font-medium">
                          {money(p.cents)}
                        </span>
                      </li>
                    ))}
                  </ol>
                )}
              </Panel>
            )}

            {seeExpenses && (
              <Panel
                title={t("home.finance.title")}
                subtitle={t("home.finance.subtitle")}
                action={<PanelLink to="/finance" label={t("home.finance.open")} />}
              >
                <dl className="space-y-2.5 text-sm">
                  <MoneyRow
                    label={t("home.finance.dueSoon")}
                    value={money(view.expenses.dueNext7DaysCents)}
                  />
                  <MoneyRow
                    label={t("home.finance.overdue")}
                    value={money(view.expenses.overdueCents)}
                    danger={view.expenses.overdueCents > 0}
                  />
                  <MoneyRow label={t("home.finance.paid")} value={money(view.expenses.paidCents)} />
                  <div className="border-t pt-2.5" />
                  <MoneyRow
                    label={t("home.finance.personnel")}
                    value={money(view.expenses.personnelCents)}
                  />
                  <MoneyRow
                    label={t("home.finance.operating")}
                    value={money(view.expenses.operatingCents)}
                  />
                </dl>
              </Panel>
            )}

            {seeStock && (
              <Panel
                title={t("home.stock.title")}
                action={<PanelLink to="/inventory" label={t("home.stock.openInventory")} />}
              >
                {view.low.length === 0 ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <CircleCheck className="size-4 text-success" /> {t("home.stock.empty")}
                  </p>
                ) : (
                  <ul className="space-y-2.5 text-sm">
                    {view.low.slice(0, 5).map((i) => (
                      <li key={i.id} className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate">
                          {i.name}
                          {locationId === "all" && (
                            <span className="ml-1.5 text-xs text-muted-foreground">
                              · {storeName(i.locationId)}
                            </span>
                          )}
                        </span>
                        <span className="tabular shrink-0 text-xs text-muted-foreground">
                          {t("home.stock.of", {
                            qty: `${fmtQuantity(i.quantity, lng)} ${t(`inventory:units.${i.unit}`, { count: i.quantity })}`,
                            min: fmtQuantity(i.minQuantity, lng),
                          })}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}
          </div>
          {!seeFinancials && <p className="text-xs text-muted-foreground">{t("home.limited")}</p>}
        </>
      )}
    </div>
  );
}

type AttentionItem = {
  key: string;
  tone: "danger" | "warning" | "neutral";
  icon: ReactNode;
  text: string;
  to: "/finance" | "/inventory" | "/kds";
};

function AttentionStrip({ items }: { items: (AttentionItem | false)[] }) {
  const { t } = useTranslation("dashboard");
  const list = items.filter((i): i is AttentionItem => Boolean(i));
  return (
    <section aria-label={t("home.attention.title")} className="surface p-4">
      <h2 className="eyebrow mb-3">{t("home.attention.title")}</h2>
      {list.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CircleCheck className="size-4 text-success" /> {t("home.attention.allClear")}
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {list.map((i) => (
            <li key={i.key}>
              <Link
                to={i.to}
                className={cn(
                  "group inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm transition-colors hover:bg-muted [&_svg]:size-4",
                  i.tone === "danger" && "border-destructive/30 bg-destructive/5",
                  i.tone === "warning" && "border-warning/40 bg-warning/10",
                )}
              >
                <span
                  className={cn(
                    "text-muted-foreground",
                    i.tone === "danger" && "text-destructive",
                    i.tone === "warning" &&
                      "text-[color-mix(in_oklab,var(--warning)_55%,var(--foreground))]",
                  )}
                >
                  {i.icon}
                </span>
                {i.text}
                <ArrowRight className="text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PanelLink({
  to,
  label,
}: {
  to: "/finance" | "/inventory" | "/reports" | "/pos" | "/kds";
  label: string;
}) {
  return (
    <Link
      to={to}
      className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
    >
      {label} <ArrowRight className="size-3.5" />
    </Link>
  );
}

function MoneyRow({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("tabular font-medium", danger && "text-destructive")}>{value}</dd>
    </div>
  );
}

// ---------------------------------------------------------------- role views (permission-driven)
type Mapped = ReturnType<typeof mapResources>;

function roleViews(orders: RecordedOrder[], mapped: Mapped, userId: string, timeZone?: string) {
  const today = dayKey(new Date().toISOString(), timeZone);
  const real = orders.filter((o) => !o.isSimulated);
  const todays = real.filter((o) => dayKey(o.createdAt, timeZone) === today);
  const mine = todays.filter((o) => o.createdBy === userId);
  const mineSales = mine.filter(isRecordedSale);
  const mySalesCents = mineSales.reduce((s, o) => s + netSalesCents(o), 0);
  const prep = prepStats(todays);
  const open = real.filter((o) => OPEN_STATUSES.includes(o.status));
  return {
    cashier: {
      mySalesCents,
      myOrders: mine.length,
      avgCents: averageCents(mySalesCents, mineSales.length),
      openStore: open.length,
      recent: mine.slice(0, 5),
    },
    kitchenStats: {
      queue: real.filter((o) => o.status === "new" || o.status === "confirmed").length,
      prep: real.filter((o) => o.status === "in_prep").length,
      ready: real.filter((o) => o.status === "ready").length,
      prepTime: prep,
      oldest: [...open]
        .filter((o) => o.status !== "ready")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, 5),
    },
    stock: {
      // null without inventory.costs: the backend sent no costs, so there is no value to show.
      valueCents: mapped.costsVisible
        ? // Same valuation as the Inventory screen: each item rounded once, like the server.
          sumCents(
            mapped.items
              .filter((i) => i.active)
              .map((i) => multiplyQuantityCents(i.quantity, i.costCents)),
          )
        : null,
      movesToday: mapped.movements.filter((m) => dayKey(m.createdAt, timeZone) === today).length,
      // the read returns at most 200 movements: say "200+" instead of presenting the cap as a total
      movesCapped: mapped.movements.length >= 200,
      recent: mapped.movements.slice(0, 6),
    },
  };
}
type RoleViews = ReturnType<typeof roleViews>;

function CashierSection({ v, money }: { v: RoleViews["cashier"]; money: (c: number) => string }) {
  const { t, i18n } = useTranslation("dashboard");
  const { t: tOrders } = useTranslation("orders");
  const lng = i18n.language;
  return (
    <section aria-label={t("home.cashier.title")} className="space-y-4">
      <h2 className="eyebrow">{t("home.cashier.title")}</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label={t("home.cashier.mySales")}
          value={money(v.mySalesCents)}
          hint={t("home.cashier.mySalesHint")}
        />
        <StatTile label={t("home.cashier.myOrders")} value={fmtNumber(v.myOrders, lng)} />
        <StatTile label={t("home.cashier.avgTicket")} value={money(v.avgCents)} />
        <StatTile
          label={t("home.cashier.openStore")}
          value={fmtNumber(v.openStore, lng)}
          hint={t("home.cashier.openStoreHint")}
          tone={v.openStore ? "warning" : "neutral"}
        />
      </div>
      <Panel
        title={t("home.cashier.recent")}
        action={<PanelLink to="/pos" label={t("home.cashier.newSale")} />}
      >
        {v.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("home.cashier.recentEmpty")}</p>
        ) : (
          <ul className="divide-y text-sm">
            {v.recent.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                <span className="font-mono text-[13px]">{o.orderNumber}</span>
                <span className="text-muted-foreground">{tOrders(`types.${o.type}`)}</span>
                <span className="text-muted-foreground">{tOrders(`statuses.${o.status}`)}</span>
                <span className="tabular font-medium">{money(o.totalCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  );
}

function KitchenSection({
  v,
  timeZone,
}: {
  v: RoleViews["kitchenStats"];
  timeZone?: string | undefined;
}) {
  const { t, i18n } = useTranslation("dashboard");
  const lng = i18n.language;
  const now = Date.now();
  return (
    <section aria-label={t("home.kitchen.title")} className="space-y-4">
      <h2 className="eyebrow">{t("home.kitchen.title")}</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label={t("home.kitchen.queue")}
          value={fmtNumber(v.queue, lng)}
          hint={t("home.kitchen.queueHint")}
          tone={v.queue ? "warning" : "neutral"}
        />
        <StatTile label={t("home.kitchen.prep")} value={fmtNumber(v.prep, lng)} />
        <StatTile label={t("home.kitchen.ready")} value={fmtNumber(v.ready, lng)} />
        <StatTile
          label={t("home.kitchen.avgPrep")}
          value={
            v.prepTime.avgMinutes == null
              ? "—"
              : t("home.kitchen.minutes", { value: fmtNumber(v.prepTime.avgMinutes, lng) })
          }
          hint={
            v.prepTime.avgMinutes != null
              ? t("home.kitchen.avgPrepSample", { count: v.prepTime.samples })
              : v.prepTime.instant > 0
                ? t("home.kitchen.onlyInstant", { count: v.prepTime.instant })
                : t("home.kitchen.noPrepData")
          }
          tone={v.prepTime.avgMinutes == null && v.prepTime.instant > 0 ? "warning" : "neutral"}
        />
      </div>
      <Panel
        title={t("home.kitchen.oldest")}
        action={<PanelLink to="/kds" label={t("home.kitchen.openKds")} />}
      >
        {v.oldest.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("home.kitchen.oldestEmpty")}</p>
        ) : (
          <ul className="divide-y text-sm">
            {v.oldest.map((o) => (
              <li key={o.id} className="flex items-center justify-between gap-3 py-2">
                <span className="font-mono text-[13px] font-medium">{o.orderNumber}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground">
                  {o.items.map((i) => `${i.quantity}× ${i.productName}`).join(", ")}
                </span>
                <span
                  className="tabular shrink-0 text-xs text-muted-foreground"
                  title={fmtDateTime(o.createdAt, lng, {
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZone,
                  })}
                >
                  {t("home.kitchen.age", {
                    value: Math.max(0, Math.round((now - Date.parse(o.createdAt)) / 60000)),
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  );
}

function StockSection({
  v,
  low,
  receiving,
  money,
  storeName,
  showStore,
}: {
  v: RoleViews["stock"];
  low: number;
  receiving: number | null;
  money: (c: number) => string;
  storeName: (slug: string) => string;
  showStore: boolean;
}) {
  const { t, i18n } = useTranslation("dashboard");
  const lng = i18n.language;
  return (
    <section aria-label={t("home.stock.title")} className="space-y-4">
      <h2 className="eyebrow">{t("home.stock.title")}</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label={t("home.stock.low")}
          value={fmtNumber(low, lng)}
          hint={t("home.stock.lowHint")}
          tone={low ? "warning" : "neutral"}
        />
        {receiving != null && (
          <StatTile label={t("home.stock.receiving")} value={fmtNumber(receiving, lng)} />
        )}
        {v.valueCents != null && (
          <StatTile
            label={t("home.stock.value")}
            value={money(v.valueCents)}
            hint={t("home.stock.valueHint")}
          />
        )}
        <StatTile
          label={t("home.stock.movesToday")}
          value={`${fmtNumber(v.movesToday, lng)}${v.movesCapped && v.movesToday >= 200 ? "+" : ""}`}
        />
      </div>
      <Panel
        title={t("home.stock.recent")}
        action={<PanelLink to="/inventory" label={t("home.stock.openInventory")} />}
      >
        {v.recent.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("home.stock.recentEmpty")}</p>
        ) : (
          <ul className="divide-y text-sm">
            {v.recent.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 flex-1 truncate">
                  {m.itemName}
                  {showStore && (
                    <span className="ml-1.5 text-xs text-muted-foreground">
                      · {storeName(m.locationId)}
                    </span>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t(`inventory:movements.kinds.${m.kind}`, { defaultValue: m.kind })}
                </span>
                <span
                  className={cn(
                    "tabular w-24 text-right font-medium",
                    m.quantityDelta < 0 && "text-muted-foreground",
                  )}
                >
                  {m.quantityDelta > 0 ? "+" : ""}
                  {fmtQuantity(m.quantityDelta, lng)}{" "}
                  {t(`inventory:units.${m.unit}`, { count: Math.abs(m.quantityDelta) })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </section>
  );
}
