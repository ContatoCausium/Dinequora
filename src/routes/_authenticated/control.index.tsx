import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, ArrowUpRight, CircleSlash, History, Sparkles } from "lucide-react";
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { DemoBadge } from "@/components/app/brand-mark";
import { LoadFailure } from "@/components/control/load-failure";
import { EmptyState } from "@/components/app/states";
import { LoadingRows, Metric, Section, StatusPill, Tag } from "@/components/control/control-ui";
import { useControlData } from "@/components/control/use-control-data";
import { computeOverview } from "@/lib/platform-metrics";
import { fmtCurrency, fmtDate, fmtNumber, fmtPercent } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/control/")({
  head: () => ({
    meta: [
      { title: "Platform overview · Dinequora Control Center" },
      {
        name: "description",
        content:
          "Organizations, locations, subscriptions and activity across the Dinequora platform.",
      },
      { property: "og:title", content: "Platform overview · Dinequora Control Center" },
      {
        property: "og:description",
        content:
          "Organizations, locations, subscriptions and activity across the Dinequora platform.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Overview,
});

function Overview() {
  const { t, i18n } = useTranslation("control");
  const lng = i18n.language;
  const { data, error, loading, reload } = useControlData(12);
  const o = useMemo(() => (data ? computeOverview(data.orgs, data.plans) : null), [data]);

  return (
    <>
      <header className="mb-6">
        <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
          {t("overview.eyebrow")}
        </p>
        <h1 className="mt-1 text-[26px] font-semibold tracking-[-0.02em]">{t("overview.title")}</h1>
        <div className="mt-1 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <p className="max-w-2xl text-sm text-muted-foreground">{t("overview.subtitle")}</p>
          <Link
            to="/onboarding"
            search={{ create: "1" }}
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border bg-card px-3 text-sm font-medium shadow-xs hover:bg-muted"
          >
            {t("overview.createTest")}
          </Link>
        </div>
      </header>

      {error && <LoadFailure kind={error} retry={() => void reload()} />}
      {loading ? (
        <LoadingRows rows={6} />
      ) : !o || !data ? null : (
        <div className="grid gap-6">
          <dl className="surface grid grid-cols-2 gap-px overflow-hidden bg-border lg:grid-cols-5">
            <Metric
              label={t("overview.customers")}
              value={fmtNumber(o.customers, lng)}
              note={t("overview.demoNote", { count: o.demos })}
            />
            <Metric label={t("overview.active")} value={fmtNumber(o.active, lng)} />
            <Metric label={t("overview.trial")} value={fmtNumber(o.trial, lng)} />
            <Metric label={t("overview.suspended")} value={fmtNumber(o.suspended, lng)} />
            <Metric
              label={t("overview.locations")}
              value={fmtNumber(o.locations, lng)}
              note={t("overview.demoLocations", { count: o.demoLocations })}
            />
          </dl>

          <Section
            title={t("overview.revenue")}
            hint={o.billingConnected ? t("overview.revenueLive") : t("overview.revenueOff")}
            action={
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-medium text-warning">
                  <Sparkles className="size-2.5" />
                  {t("overview.projectedBadge", { defaultValue: "Estimate" })}
                </span>
                {!o.billingConnected && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                    <CircleSlash className="size-3" />
                    {t("overview.billingOff")}
                  </span>
                )}
              </div>
            }
          >
            <dl className="grid grid-cols-1 gap-px bg-border sm:grid-cols-3">
              <Metric
                label={t("overview.subscriptions")}
                value={
                  o.activeSubscriptions === null
                    ? t("overview.unavailable")
                    : fmtNumber(o.activeSubscriptions, lng)
                }
                tone={o.activeSubscriptions === null ? "muted" : undefined}
              />
              <Metric
                label={t("overview.mrr")}
                value={
                  o.actualMrrCents === null
                    ? t("overview.unavailable")
                    : fmtCurrency(o.actualMrrCents / 100, lng)
                }
                tone={o.actualMrrCents === null ? "muted" : undefined}
                note={t("overview.projected", {
                  value: fmtCurrency(o.projectedMrrCents / 100, lng),
                })}
              />
              <Metric
                label={t("overview.arr")}
                value={
                  o.actualArrCents === null
                    ? t("overview.unavailable")
                    : fmtCurrency(o.actualArrCents / 100, lng)
                }
                tone={o.actualArrCents === null ? "muted" : undefined}
                note={t("overview.projected", {
                  value: fmtCurrency((o.projectedMrrCents * 12) / 100, lng),
                })}
              />
            </dl>
            {o.placeholderPricing && (
              <p className="border-t px-5 py-2.5 text-xs text-muted-foreground">
                {t("overview.placeholderPricing")}
              </p>
            )}
          </Section>

          <div className="grid gap-6 lg:grid-cols-2">
            <Section title={t("overview.distribution")} hint={t("overview.distributionHint")}>
              <div className="h-44 px-4 pt-3">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={o.distribution.map((d) => ({
                      name: t(`plans.${d.plan}`, { defaultValue: d.plan }),
                      customers: d.customers,
                      demos: d.demos,
                    }))}
                    margin={{ left: -20, right: 10, top: 10, bottom: 0 }}
                  >
                    <XAxis
                      dataKey="name"
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    />
                    <YAxis
                      allowDecimals={false}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    />
                    <Tooltip
                      contentStyle={{
                        background: "var(--popover)",
                        border: "1px solid var(--border)",
                        borderRadius: 8,
                        fontSize: 12,
                      }}
                    />
                    <Bar
                      dataKey="customers"
                      fill="var(--primary)"
                      radius={[4, 4, 0, 0]}
                      name={t("overview.customers")}
                    />
                    <Bar
                      dataKey="demos"
                      fill="var(--chart-2)"
                      radius={[4, 4, 0, 0]}
                      name={t("orgs.demo")}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <ul className="grid gap-2 border-t px-5 py-3">
                {o.distribution.map((d) => {
                  const total = Math.max(1, o.customers + o.demos);
                  return (
                    <li key={d.plan} className="grid gap-1">
                      <div className="flex items-baseline justify-between text-xs">
                        <span className="font-medium">
                          {t(`plans.${d.plan}`, { defaultValue: d.plan })}
                        </span>
                        <span className="tabular text-muted-foreground">
                          {t("overview.distRow", { customers: d.customers, demos: d.demos })}
                        </span>
                      </div>
                      <div className="flex h-1 overflow-hidden rounded-full bg-muted">
                        <span
                          className="bg-primary"
                          style={{ width: `${(d.customers / total) * 100}%` }}
                        />
                        <span
                          className="demo-stripe bg-warning/40"
                          style={{ width: `${(d.demos / total) * 100}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Section>
            <Section title={t("overview.conversion")} hint={t("overview.conversionHint")}>
              <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
                <Metric
                  label={t("overview.trialsActive")}
                  value={fmtNumber(o.trials.active, lng)}
                />
                <Metric
                  label={t("overview.trialsExpired")}
                  value={fmtNumber(o.trials.expired, lng)}
                />
                <Metric
                  label={t("overview.trialsConverted")}
                  value={fmtNumber(o.trials.converted, lng)}
                />
                <Metric
                  label={t("overview.rate")}
                  value={o.trials.rate === null ? "—" : fmtPercent(o.trials.rate, lng)}
                  tone={o.trials.rate === null ? "muted" : undefined}
                />
              </dl>
            </Section>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
            <Section
              title={t("overview.attention")}
              hint={t("overview.attentionHint")}
              action={
                <Link
                  to="/control/organizations"
                  className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-medium text-primary hover:underline"
                >
                  {t("overview.viewAll")}
                  <ArrowUpRight className="size-3" />
                </Link>
              }
            >
              {o.attention.length === 0 ? (
                <div className="p-5">
                  <EmptyState
                    icon={<AlertTriangle className="size-5" />}
                    title={t("overview.nothing")}
                  />
                </div>
              ) : (
                <ul className="divide-y">
                  {o.attention.map(({ org, reasons }) => (
                    <li
                      key={org.id}
                      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-5 py-3 text-sm"
                    >
                      <Link
                        to="/control/organizations"
                        search={{ org: org.id }}
                        className="font-medium hover:underline"
                      >
                        {org.name}
                      </Link>
                      {org.is_demo && <DemoBadge label={t("orgs.demo")} />}
                      <StatusPill status={org.status} />
                      <span className="flex flex-wrap gap-1.5 sm:ml-auto">
                        {reasons.map((r) => (
                          <Tag
                            key={r}
                            tone={
                              r === "suspended" || r === "past_due" || r === "trial_expired"
                                ? "danger"
                                : "warning"
                            }
                          >
                            {t(`attention.${r}`)}
                          </Tag>
                        ))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
            <Section
              title={t("overview.activity")}
              action={
                <Link
                  to="/control/audit"
                  className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap text-xs font-medium text-primary hover:underline"
                >
                  {t("overview.viewAll")}
                  <ArrowUpRight className="size-3" />
                </Link>
              }
            >
              {data.audit.length === 0 ? (
                <div className="p-5">
                  <EmptyState icon={<History className="size-5" />} title={t("audit.empty")} />
                </div>
              ) : (
                <ol className="divide-y">
                  {data.audit.slice(0, 8).map((a) => (
                    <li key={a.id} className="flex items-start gap-3 px-5 py-2.5 text-sm">
                      <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary/60" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">
                          {t(`actions.${a.action}`, { defaultValue: a.action })}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {a.org_name ?? t("audit.platform")}
                        </p>
                      </div>
                      <time className="tabular shrink-0 text-xs text-muted-foreground">
                        {fmtDate(a.created_at, lng, {
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </time>
                    </li>
                  ))}
                </ol>
              )}
            </Section>
          </div>
        </div>
      )}
    </>
  );
}
