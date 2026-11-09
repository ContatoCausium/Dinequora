import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CircleCheck,
  Clock,
  PackageX,
  ShieldAlert,
  TrendingDown,
  FileWarning,
  Info,
} from "lucide-react";
import { EmptyState } from "@/components/app/states";

import { useScopedLocations, useWorkspace } from "@/components/app/workspace-context";
import { DemoBadge } from "@/components/app/brand-mark";
import { PageHeader, Panel, Segmented } from "@/components/app/page";
import {
  channelMix,
  computeKpis,
  DEMO_ASSUMPTIONS,
  hourlyMix,
  operationalAlerts,
  revenueSeries,
  topItems,
  type AlertKind,
} from "@/lib/demo-data";
import { fmtCurrency, fmtDate, fmtNumber, fmtPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RecordedOverview } from "@/components/app/recorded-overview";

export const Route = createFileRoute("/_authenticated/_app/")({
  head: () => ({
    meta: [
      { title: "Executive overview · Servora" },
      {
        name: "description",
        content: "Consolidated and per-location sales, orders and operational alerts.",
      },
      { property: "og:title", content: "Executive overview · Servora" },
      {
        property: "og:description",
        content: "Consolidated and per-location sales, orders and operational alerts.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: OverviewEntry,
});

function OverviewEntry() {
  const { org } = useWorkspace();
  return org.fictional ? <Overview /> : <RecordedOverview />;
}

type Range = "7" | "30" | "90";
const CHART_VARS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function Overview() {
  const { t, i18n } = useTranslation("dashboard");
  const lng = i18n.language;
  const { org, locationId, setLocationId } = useWorkspace();
  const locs = useScopedLocations();
  const [range, setRange] = useState<Range>("30");
  const days = Number(range);

  const k = useMemo(() => computeKpis(locs, days), [locs, days]);
  const series = useMemo(() => revenueSeries(locs, days), [locs, days]);
  const scope = locationId === "all" ? t("common:shell.allLocations") : locs[0]?.name;
  const peak = series.reduce(
    (a, b) => (Number(b["total"]) > Number(a["total"]) ? b : a),
    series[0] ?? { date: "", total: 0 },
  );

  if (!locs.length)
    return (
      <EmptyState
        icon={<PackageX className="size-5" />}
        title={t("common:states.noStoresTitle")}
        body={t("common:states.noStoresBody")}
      />
    );

  // Primary: the four numbers an owner checks first. Currency is always the org's USD; language only changes formatting.
  const primary: { key: string; value: string; delta?: number; spark?: string }[] = [
    { key: "gross", value: fmtCurrency(k.gross, lng), delta: k.growth, spark: "total" },
    { key: "net", value: fmtCurrency(k.net, lng) },
    { key: "orders", value: fmtNumber(k.orders, lng) },
    { key: "aov", value: fmtCurrency(k.aov, lng) },
  ];
  const secondary: { key: string; value: string; hint?: string; tone?: "neg" }[] = [
    { key: "open", value: fmtNumber(k.open, lng), hint: t("kpi.openHint") },
    { key: "cancelled", value: fmtNumber(k.cancelled, lng), tone: "neg" },
    { key: "refunds", value: fmtCurrency(k.refunds, lng), tone: "neg" },
    {
      key: "foodCost",
      value: fmtCurrency(k.foodCost, lng),
      hint: t("kpi.foodCostHint", { rate: fmtPercent(DEMO_ASSUMPTIONS.foodCostRate, lng) }),
    },
    { key: "margin", value: fmtPercent(k.margin, lng), hint: t("kpi.marginHint") },
  ];

  return (
    <div className="mx-auto max-w-[1440px]">
      <PageHeader
        eyebrow={
          <>
            <span className="eyebrow">{org.name}</span>
            <DemoBadge label={t("common:demo.badge")} />
          </>
        }
        title={t("title")}
        description={t("subtitle", {
          scope,
          date: fmtDate("2026-10-22", lng, { month: "long", day: "numeric", year: "numeric" }),
        })}
        actions={
          <Segmented<Range>
            label={t("range.label")}
            value={range}
            onChange={setRange}
            options={[
              { value: "7", label: t("range.7") },
              { value: "30", label: t("range.30") },
              { value: "90", label: t("range.90") },
            ]}
          />
        }
      />

      <section aria-label={t("kpi.sectionLabel")} className="surface overflow-hidden">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {primary.map((kpi, i) => (
            <div
              key={kpi.key}
              className={cn(
                "relative flex min-w-0 flex-col gap-2 p-4 md:p-6",
                i % 2 === 1 && "border-l",
                i >= 2 && "border-t lg:border-t-0",
                i === 2 && "lg:border-l",
              )}
            >
              <span className="text-[12.5px] font-medium text-muted-foreground">
                {t(`kpi.${kpi.key}`)}
              </span>
              <span className="tabular truncate text-[22px] font-semibold leading-none tracking-[-0.02em] md:text-[30px]">
                {kpi.value}
              </span>
              <span className="flex h-5 items-center gap-2 text-xs text-muted-foreground">
                {kpi.delta !== undefined ? (
                  <span
                    className={cn(
                      "inline-flex items-center gap-0.5 font-medium",
                      kpi.delta >= 0 ? "text-success" : "text-destructive",
                    )}
                  >
                    {kpi.delta >= 0 ? (
                      <ArrowUpRight className="size-3.5" strokeWidth={2} />
                    ) : (
                      <ArrowDownRight className="size-3.5" strokeWidth={2} />
                    )}
                    {fmtPercent(Math.abs(kpi.delta), lng)}
                  </span>
                ) : null}
                <span className="truncate">
                  {kpi.delta !== undefined ? t("kpi.vsPrevious") : t("kpi.period", { days })}
                </span>
              </span>
              {kpi.spark && (
                <div
                  className="pointer-events-none absolute right-5 top-5 hidden h-8 w-24 opacity-90 xl:block"
                  aria-hidden
                >
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={series}>
                      <Line
                        type="monotone"
                        dataKey={kpi.spark}
                        stroke="var(--primary)"
                        strokeWidth={1.5}
                        dot={false}
                        isAnimationActive={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="border-t bg-muted/35 px-4 py-3 md:px-6">
          <p className="sr-only">{t("kpi.secondary")}</p>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2.5 sm:grid-cols-2 md:grid-cols-3 lg:flex lg:flex-wrap lg:gap-x-10">
            {secondary.map((m) => (
              <div
                key={m.key}
                className="flex min-w-0 items-baseline justify-between gap-2 lg:justify-start"
              >
                <dt className="flex items-center gap-1 truncate text-xs text-muted-foreground">
                  {t(`kpi.${m.key}`)}
                  {m.hint && (
                    <span title={m.hint} className="cursor-help">
                      <Info className="size-3 opacity-70" aria-label={m.hint} />
                    </span>
                  )}
                </dt>
                <dd className="tabular text-sm font-semibold">{m.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Panel
          className="xl:col-span-2"
          title={t("revenue.title")}
          subtitle={
            locationId === "all" ? t("revenue.subtitleStacked") : t("revenue.subtitleSingle")
          }
        >
          <div className="-mt-1 mb-4 flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
            <div>
              <p className="text-xs text-muted-foreground">{t("revenue.total", { days })}</p>
              <p className="tabular mt-1 text-2xl font-semibold tracking-[-0.02em]">
                {fmtCurrency(k.gross, lng)}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-muted-foreground">{t("revenue.peak")}</p>
              <p className="tabular mt-1 text-sm font-medium">
                {fmtDate(String(peak["date"]), lng, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                })}{" "}
                · {fmtCurrency(Number(peak["total"]), lng)}
              </p>
            </div>
          </div>
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={series} margin={{ left: 0, right: 4, top: 4, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="2 4" />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickFormatter={(d) => fmtDate(d, lng)}
                  minTickGap={36}
                  dy={6}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={60}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickFormatter={(v) => fmtCurrency(v, lng, true)}
                />
                <Tooltip
                  cursor={{ stroke: "var(--border)", strokeWidth: 1 }}
                  content={
                    <ChartTooltip
                      lng={lng}
                      names={Object.fromEntries(locs.map((l) => [l.id, l.name]))}
                      previousLabel={t("revenue.previous")}
                    />
                  }
                />
                {locs.length === 1 && (
                  <Area
                    type="monotone"
                    dataKey="previous"
                    stroke="var(--muted-foreground)"
                    strokeOpacity={0.6}
                    strokeDasharray="3 4"
                    fill="none"
                    strokeWidth={1.25}
                  />
                )}
                {locs.map((l, i) => (
                  <Area
                    key={l.id}
                    type="monotone"
                    dataKey={l.id}
                    {...(locs.length > 1 ? { stackId: "s" } : {})}
                    stroke={CHART_VARS[i]!}
                    strokeWidth={1.5}
                    fill={CHART_VARS[i]!}
                    fillOpacity={locs.length > 1 ? 0.14 : 0.08}
                    activeDot={{ r: 3, strokeWidth: 0 }}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            {locs.map((l, i) => (
              <span key={l.id} className="inline-flex items-center gap-1.5">
                <span className="size-2 rounded-full" style={{ background: CHART_VARS[i] }} />
                {l.name}
              </span>
            ))}
            {locs.length === 1 && (
              <span className="inline-flex items-center gap-1.5">
                <span className="w-3 border-t border-dashed border-muted-foreground" />
                {t("revenue.previous")}
              </span>
            )}
          </div>
        </Panel>

        <AlertsPanel />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <StoreComparison days={days} onSelect={setLocationId} />
        <HourlyPanel />
        <div className="grid gap-6">
          <ChannelPanel />
          <TopItemsPanel />
        </div>
      </div>

      <p className="mt-8 flex items-start gap-2 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" />
        {t("common:demo.disclaimer")}
      </p>
    </div>
  );
}

type TooltipPayload = { dataKey: string; value: number; color?: string; stroke?: string };
function ChartTooltip({
  active,
  payload,
  label,
  lng,
  names,
  previousLabel,
}: {
  active?: boolean;
  payload?: TooltipPayload[];
  label?: string;
  lng: string;
  names: Record<string, string>;
  previousLabel: string;
}) {
  if (!active || !payload?.length || !label) return null;
  return (
    <div className="rounded-lg border bg-popover px-3 py-2 text-xs shadow-pop">
      <p className="mb-1.5 font-medium">
        {fmtDate(label, lng, { weekday: "short", month: "short", day: "numeric" })}
      </p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center justify-between gap-6">
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <span className="size-2 rounded-full" style={{ background: p.stroke }} />
            {names[p.dataKey] ?? previousLabel}
          </span>
          <span className="tabular font-medium">{fmtCurrency(p.value, lng)}</span>
        </p>
      ))}
    </div>
  );
}

const ALERT_ICON: Record<AlertKind, typeof AlertTriangle> = {
  lowInventory: PackageX,
  delayedOrders: Clock,
  pendingApproval: ShieldAlert,
  salesVariation: TrendingDown,
  missingClosing: FileWarning,
};

function AlertsPanel() {
  const { t } = useTranslation("dashboard");
  const locs = useScopedLocations();
  const order = { high: 0, medium: 1, low: 2 } as const;
  const alerts = [...operationalAlerts(locs)].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <Panel
      title={t("alerts.title")}
      subtitle={t("alerts.subtitle", { count: alerts.length })}
      bodyClassName="px-2 pb-2 pt-3"
    >
      {!alerts.length ? (
        <EmptyState
          icon={<CircleCheck className="size-5" strokeWidth={1.75} />}
          title={t("alerts.empty")}
        />
      ) : (
        <ul className="flex flex-col">
          {alerts.map((a) => {
            const Icon = ALERT_ICON[a.kind];
            return (
              <li
                key={a.id}
                className="group relative flex items-start gap-3 rounded-md px-3 py-2.5 transition-colors hover:bg-muted/50"
              >
                <span
                  className={cn(
                    "absolute left-0 top-3 h-6 w-[2px] rounded-full",
                    a.severity === "high"
                      ? "bg-destructive"
                      : a.severity === "medium"
                        ? "bg-warning"
                        : "bg-border",
                  )}
                  aria-hidden
                />
                <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium leading-snug">
                    {t(`alerts.${a.kind}.title`, { count: a.count })}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">
                    {a.location.name} · {t(`alerts.${a.kind}.detail`)}
                  </p>
                </div>
                <span
                  className={cn(
                    "mt-0.5 shrink-0 text-[11px] font-medium",
                    a.severity === "high"
                      ? "text-destructive"
                      : a.severity === "medium"
                        ? "text-warning"
                        : "text-muted-foreground",
                  )}
                >
                  {t(`alerts.severity.${a.severity}`)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

function StoreComparison({ days, onSelect }: { days: number; onSelect: (id: string) => void }) {
  const { t, i18n } = useTranslation("dashboard");
  const lng = i18n.language;
  const { org, locationId } = useWorkspace();
  const rows = org.locations
    .map((l) => ({ l, k: computeKpis([l], days) }))
    .sort((a, b) => b.k.gross - a.k.gross);
  const total = rows.reduce((s, r) => s + r.k.gross, 0) || 1;
  return (
    <Panel
      title={t("compare.title")}
      subtitle={t("compare.subtitle", { days })}
      action={
        <Link
          to="/locations"
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          {t("compare.all")}
          <ArrowRight className="size-3" />
        </Link>
      }
      bodyClassName="px-2 pb-2 pt-3"
    >
      <ul className="flex flex-col gap-0.5">
        {rows.map(({ l, k }, i) => {
          const share = k.gross / total;
          const selected = locationId === l.id;
          return (
            <li key={l.id}>
              <button
                onClick={() => onSelect(selected ? "all" : l.id)}
                aria-pressed={selected}
                className={cn(
                  "w-full rounded-md px-3 py-3 text-left transition-colors hover:bg-muted/50",
                  selected && "bg-muted/60",
                )}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 items-baseline gap-2.5">
                    <span className="tabular w-3 text-xs text-muted-foreground">{i + 1}</span>
                    <span className="truncate text-sm font-medium">{l.name}</span>
                    {l.status === "placeholder" && (
                      <span className="shrink-0 rounded border px-1 text-[10px] text-muted-foreground">
                        {t("common:shell.placeholder")}
                      </span>
                    )}
                  </span>
                  <span className="tabular shrink-0 text-sm font-semibold">
                    {fmtCurrency(k.gross, lng)}
                  </span>
                </div>
                <div className="mt-2.5 flex items-center gap-3 pl-[22px]">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/80 transition-[width] duration-500"
                      style={{ width: `${share * 100}%` }}
                    />
                  </div>
                  <span className="tabular w-12 text-right text-xs text-muted-foreground">
                    {fmtPercent(share, lng)}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 pl-[22px] text-xs text-muted-foreground">
                  <span>{t("compare.orders", { value: fmtNumber(k.orders, lng) })}</span>
                  <span>{t("compare.aov", { value: fmtCurrency(k.aov, lng) })}</span>
                  <span
                    className={cn(
                      "tabular font-medium",
                      k.growth >= 0 ? "text-success" : "text-destructive",
                    )}
                  >
                    {fmtPercent(k.growth, lng, true)}
                  </span>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function HourlyPanel() {
  const { t, i18n } = useTranslation("dashboard");
  const locs = useScopedLocations();
  const data = hourlyMix(locs);
  const peak = data.reduce((a, b) => (b.orders > a.orders ? b : a));
  const hourLabel = (h: number) =>
    new Intl.DateTimeFormat(i18n.language, { hour: "numeric", timeZone: "UTC" }).format(
      new Date(Date.UTC(2026, 0, 1, h)),
    );
  return (
    <Panel
      title={t("hourly.title")}
      subtitle={t("hourly.subtitle", { hour: hourLabel(peak.hour) })}
    >
      <div className="h-[260px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ left: -16, right: 0, top: 8 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="hour"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              tickFormatter={hourLabel}
              interval={1}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)" }}
              contentStyle={{
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontSize: 12,
              }}
              labelFormatter={(h) => hourLabel(Number(h))}
              formatter={(v: number) => [v, t("hourly.orders")]}
            />
            <Bar dataKey="orders" radius={[4, 4, 0, 0]}>
              {data.map((d) => (
                <Cell
                  key={d.hour}
                  fill={d.hour === peak.hour ? "var(--chart-1)" : "var(--chart-6)"}
                />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
  );
}

function ChannelPanel() {
  const { t, i18n } = useTranslation("dashboard");
  const locs = useScopedLocations();
  const data = channelMix(locs.map((l) => l.id).join());
  return (
    <Panel title={t("channels.title")}>
      <div className="flex items-center gap-5">
        <div className="size-24 shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                innerRadius={30}
                outerRadius={46}
                paddingAngle={2}
                stroke="none"
              >
                {data.map((d, i) => (
                  <Cell key={d.key} fill={CHART_VARS[i]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <ul className="flex flex-1 flex-col gap-2">
          {data.map((d, i) => (
            <li key={d.key} className="flex items-center justify-between text-sm">
              <span className="inline-flex items-center gap-2">
                <span className="size-2 rounded-sm" style={{ background: CHART_VARS[i] }} />
                {t(`channels.${d.key}`)}
              </span>
              <span className="tabular font-medium">{fmtPercent(d.value, i18n.language)}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

function TopItemsPanel() {
  const { t, i18n } = useTranslation("dashboard");
  const { org } = useWorkspace();
  const locs = useScopedLocations();
  const items = topItems(org, locs).slice(0, 5);
  return (
    <Panel title={t("topItems.title")} subtitle={t("topItems.subtitle")}>
      {!items.length && (
        <EmptyState icon={<PackageX className="size-5" />} title={t("topItems.empty")} />
      )}
      <ol className="flex flex-col gap-3">
        {items.map((it) => (
          <li key={it.name}>
            <div className="flex items-center justify-between text-sm">
              <span className="truncate">{it.name}</span>
              <span className="tabular text-muted-foreground">
                {fmtNumber(it.qty, i18n.language)}
              </span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-chart-2"
                style={{ width: `${it.share * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
