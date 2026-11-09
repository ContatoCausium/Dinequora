import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { AlertTriangle, ChevronRight, ClipboardList, ShieldCheck, Store } from "lucide-react";
import { fetchOperationalResources } from "@/lib/operational.functions";
import { ledgerMetrics, recordedIntelligence } from "@/lib/operational-metrics";
import type { Resources } from "@/lib/operational-mappers";
import {
  classifyQueryTopic,
  type AgentQueryTopic,
  type IntelligenceSummary,
} from "@/lib/intelligence-service";
import { fmtDateTime, fmtMoneyCents, fmtNumber, fmtPercent } from "@/lib/format";
import { useWorkspace, useScopedLocations } from "@/components/app/workspace-context";
import { PageHeader, Panel, Segmented } from "@/components/app/page";
import { StatTile } from "@/components/app/stat-tile";
import { EmptyState, Skeleton, StateCard } from "@/components/app/states";
import { DemoBadge } from "@/components/app/brand-mark";
import { WhatsAppPreviewCard } from "@/components/intelligence/whatsapp-preview-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/_app/intelligence")({
  head: () => ({
    meta: [
      { title: "Servora Intelligence · Servora" },
      {
        name: "description",
        content: "Revenue, food cost and stock signals calculated from recorded operations.",
      },
      { property: "og:title", content: "Servora Intelligence · Servora" },
      {
        property: "og:description",
        content: "Revenue, food cost and stock signals calculated from recorded operations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IntelligencePage,
});

type Period = "7" | "30" | "90";
type InsightFilter = "all" | "cmv" | "inventory" | "sales";
type InsightLevel = "high" | "medium" | "low";

/** Reference food-cost band used only to classify the recorded rate (ratio, not a target we invent). */
const CMV_REFERENCE = { min: 0.28, max: 0.32 } as const;
const DAY_MS = 86400000;

const EMPTY_SUMMARY: IntelligenceSummary = {
  grossRevenueCents: 0,
  netRevenueCents: 0,
  foodCostCents: 0,
  cmvRate: 0,
  grossMarginRate: 0,
  operatingExpensesCents: 0,
  estimatedWasteCents: 0,
  lowStockItemCount: 0,
  activeRecipeCount: 0,
  analyzedOrderCount: 0,
  dataBreakdown: { realTransactionsCount: 0, realOrdersCount: 0, inventoryCount: 0 },
  insights: [],
};

interface Insight {
  id: string;
  category: Exclude<InsightFilter, "all">;
  level: InsightLevel;
  title: string;
  body: string;
  detail?: string | undefined;
  action: string;
  link: "/finance" | "/inventory" | "/pos" | "/menu";
}

interface StoreRow {
  id: string;
  name: string;
  summary: IntelligenceSummary;
}

interface AgentAnswer {
  id: string;
  query: string;
  topic: AgentQueryTopic;
  headline: string;
  evidence: { label: string; value: string }[];
  method: string;
  limitation: string;
  answeredAt: string;
}

function scopeResources(resources: Resources, id: string): Resources | null {
  if (id === "all") return resources;
  const loc = resources.locations.find((l) => l.slug === id || l.id === id);
  if (!loc) return null;
  const only = <T extends { location_id: string }>(rows: T[]) =>
    rows.filter((r) => r.location_id === loc.id);
  return {
    ...resources,
    inventory: only(resources.inventory),
    recipes: only(resources.recipes),
    purchases: only(resources.purchases),
    movements: only(resources.movements),
    finance: only(resources.finance),
    expenses: only(resources.expenses),
  };
}

/** Revenue recorded in the equal-length period immediately before the current one. */
function previousRevenueCents(resources: Resources, periodDays: number) {
  const now = Date.now();
  const end = now - periodDays * DAY_MS;
  const start = now - 2 * periodDays * DAY_MS;
  const entries = resources.finance.filter((e) => {
    const at = Date.parse(e.created_at);
    return at >= start && at < end;
  });
  return ledgerMetrics(entries).revenueCents;
}

const ratio = (pct: number) => pct / 100;

function buildInsights(
  summary: IntelligenceSummary,
  stores: StoreRow[],
  showStores: boolean,
  periodDays: number,
  t: TFunction,
  lng: string,
): Insight[] {
  const out: Insight[] = [];
  const range = {
    min: fmtPercent(CMV_REFERENCE.min, lng),
    max: fmtPercent(CMV_REFERENCE.max, lng),
  };
  if (summary.grossRevenueCents <= 0) {
    out.push({
      id: "no-revenue",
      category: "sales",
      level: "medium",
      title: t("insights.noRevenue.title", { days: periodDays }),
      body: t("insights.noRevenue.body"),
      action: t("insights.noRevenue.action"),
      link: "/pos",
    });
  } else {
    const rate = ratio(summary.cmvRate);
    const high = rate > CMV_REFERENCE.max;
    out.push({
      id: high ? "cmv-high" : "cmv-ok",
      category: "cmv",
      level: high ? "high" : "low",
      title: t(high ? "insights.cmvHigh.title" : "insights.cmvOk.title"),
      body: t(high ? "insights.cmvHigh.body" : "insights.cmvOk.body", {
        rate: fmtPercent(rate, lng),
        ...range,
      }),
      action: t(high ? "insights.cmvHigh.action" : "insights.cmvOk.action"),
      link: "/finance",
    });
  }
  if (summary.lowStockItemCount > 0) {
    const affected = stores.filter((s) => s.summary.lowStockItemCount > 0);
    out.push({
      id: "low-stock",
      category: "inventory",
      level: "high",
      title: t("insights.lowStock.title", { count: summary.lowStockItemCount }),
      body: t("insights.lowStock.body"),
      detail:
        showStores && affected.length > 0
          ? t("insights.lowStock.byStore", {
              stores: affected
                .map((s) => `${s.name} (${fmtNumber(s.summary.lowStockItemCount, lng)})`)
                .join(" · "),
            })
          : undefined,
      action: t("insights.lowStock.action"),
      link: "/inventory",
    });
  }
  if (summary.activeRecipeCount === 0) {
    out.push({
      id: "no-recipes",
      category: "cmv",
      level: "medium",
      title: t("insights.noRecipes.title"),
      body: t("insights.noRecipes.body"),
      action: t("insights.noRecipes.action"),
      link: "/menu",
    });
  }
  return out;
}

function answerQuery(
  query: string,
  topic: AgentQueryTopic,
  ctx: {
    summary: IntelligenceSummary;
    scoped: Resources | null;
    stores: StoreRow[];
    periodDays: number;
    t: TFunction;
    lng: string;
  },
): AgentAnswer {
  const { summary, scoped, stores, periodDays, t, lng } = ctx;
  const hasRevenue = summary.grossRevenueCents > 0;
  const money = (c: number) => fmtMoneyCents(c, lng);
  const pct = (p: number) => (hasRevenue ? fmtPercent(ratio(p), lng) : "—");
  const base = { id: crypto.randomUUID(), query, topic, answeredAt: new Date().toISOString() };
  const finance = [
    { label: t("agent.labels.revenue"), value: money(summary.grossRevenueCents) },
    { label: t("agent.labels.margin"), value: pct(summary.grossMarginRate) },
    { label: t("agent.labels.expenses"), value: money(summary.operatingExpensesCents) },
    { label: t("agent.labels.net"), value: money(summary.netRevenueCents) },
  ];
  switch (topic) {
    case "cmv":
      return {
        ...base,
        headline: hasRevenue
          ? t("agent.headlines.cmv", { rate: pct(summary.cmvRate), days: periodDays })
          : t("agent.headlines.noRevenue", { days: periodDays }),
        evidence: [
          { label: t("agent.labels.cmv"), value: pct(summary.cmvRate) },
          { label: t("agent.labels.recipeCost"), value: money(summary.foodCostCents) },
          { label: t("agent.labels.revenue"), value: money(summary.grossRevenueCents) },
        ],
        method: t("agent.methods.cmv"),
        limitation: t("agent.limits.ledger"),
      };
    case "inventory":
    case "waste":
      return {
        ...base,
        headline:
          topic === "waste"
            ? t("agent.headlines.waste", { count: summary.lowStockItemCount })
            : t("agent.headlines.inventory", { count: summary.lowStockItemCount }),
        evidence: [
          { label: t("agent.labels.lowStock"), value: fmtNumber(summary.lowStockItemCount, lng) },
          {
            label: t("agent.labels.tracked"),
            value: fmtNumber(summary.dataBreakdown.inventoryCount, lng),
          },
        ],
        method: t("agent.methods.inventory"),
        limitation: t(topic === "waste" ? "agent.limits.waste" : "agent.limits.inventory"),
      };
    case "suppliers": {
      const purchases = scoped?.purchases ?? [];
      const open = purchases.filter(
        (p) => p.status !== "received" && p.status !== "cancelled",
      ).length;
      return {
        ...base,
        headline: t("agent.headlines.suppliers", { open, total: purchases.length }),
        evidence: [
          { label: t("agent.labels.purchasesTotal"), value: fmtNumber(purchases.length, lng) },
          { label: t("agent.labels.purchasesOpen"), value: fmtNumber(open, lng) },
          {
            label: t("agent.labels.suppliers"),
            value: fmtNumber(scoped?.suppliers.length ?? 0, lng),
          },
        ],
        method: t("agent.methods.suppliers"),
        limitation: t("agent.limits.suppliers"),
      };
    }
    case "store_performance":
      return {
        ...base,
        headline:
          stores.length > 0
            ? t("agent.headlines.stores", { days: periodDays })
            : t("agent.headlines.noStores"),
        evidence: stores.map((s) => ({ label: s.name, value: money(s.summary.grossRevenueCents) })),
        method: t("agent.methods.stores"),
        limitation: t("agent.limits.ledger"),
      };
    default:
      return {
        ...base,
        headline: hasRevenue
          ? t("agent.headlines.finance", {
              rate: pct(summary.grossMarginRate),
              revenue: money(summary.grossRevenueCents),
            })
          : t("agent.headlines.noRevenue", { days: periodDays }),
        evidence: [
          ...finance,
          { label: t("agent.labels.orders"), value: fmtNumber(summary.analyzedOrderCount, lng) },
        ],
        method: t("agent.methods.finance"),
        limitation: t("agent.limits.ledger"),
      };
  }
}

const LEVEL_BADGE = { high: "danger", medium: "warning", low: "success" } as const;

export function IntelligencePage() {
  const { t, i18n } = useTranslation("intelligence");
  const lng = i18n.language;
  const { org, locationId } = useWorkspace();
  const scopedLocations = useScopedLocations();
  const [period, setPeriod] = useState<Period>("30");
  const periodDays = Number(period);
  const [filter, setFilter] = useState<InsightFilter>("all");
  const [resources, setResources] = useState<Resources | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setResources(null);
    setLoadFailed(false);
    fetchOperationalResources({ data: { orgId: org.id } })
      .then((r) => {
        if (active) setResources(r);
      })
      .catch(() => {
        if (active) setLoadFailed(true);
      });
    return () => {
      active = false;
    };
  }, [org.id, reloadKey]);

  const isAll = locationId === "all";
  const scopeLabel = isAll ? t("allStores") : (scopedLocations[0]?.name ?? t("allStores"));

  const scoped = useMemo(
    () => (resources ? scopeResources(resources, locationId) : null),
    [resources, locationId],
  );
  const summary = useMemo(
    () => (scoped ? recordedIntelligence(scoped, periodDays) : EMPTY_SUMMARY),
    [scoped, periodDays],
  );
  const previousRevenue = useMemo(
    () => (scoped ? previousRevenueCents(scoped, periodDays) : 0),
    [scoped, periodDays],
  );

  const stores = useMemo<StoreRow[]>(() => {
    if (!resources) return [];
    return scopedLocations.flatMap((loc) => {
      const r = scopeResources(resources, loc.id);
      return r
        ? [{ id: loc.id, name: loc.name, summary: recordedIntelligence(r, periodDays) }]
        : [];
    });
  }, [resources, scopedLocations, periodDays]);

  const insights = useMemo(
    () => buildInsights(summary, stores, isAll, periodDays, t, lng),
    [summary, stores, isAll, periodDays, t, lng],
  );
  const visibleInsights =
    filter === "all" ? insights : insights.filter((i) => i.category === filter);

  // Deterministic query agent (no LLM): answers from the summary shown on this page.
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AgentAnswer | null>(null);
  const ask = useCallback(
    (query: string, topic?: AgentQueryTopic) => {
      const q = query.trim();
      if (!q || !resources) return;
      setAnswer(
        answerQuery(q, topic ?? classifyQueryTopic(q), {
          summary,
          scoped,
          stores,
          periodDays,
          t,
          lng,
        }),
      );
    },
    [resources, summary, scoped, stores, periodDays, t, lng],
  );
  // Answers are a snapshot of the selected scope/period; clear them when either changes.
  useEffect(() => {
    setAnswer(null);
  }, [locationId, periodDays, org.id]);

  const suggestions: { topic: AgentQueryTopic; key: string }[] = [
    { topic: "cmv", key: "cmv" },
    { topic: "sales", key: "sales" },
    { topic: "inventory", key: "inventory" },
    { topic: "margin", key: "margin" },
    { topic: "suppliers", key: "suppliers" },
  ];

  const hasRevenue = summary.grossRevenueCents > 0;
  const cmvRatio = ratio(summary.cmvRate);
  const revenueHint =
    previousRevenue > 0
      ? t("kpi.vsPrevious", {
          delta: fmtPercent(
            (summary.grossRevenueCents - previousRevenue) / previousRevenue,
            lng,
            true,
          ),
          days: periodDays,
        })
      : t("kpi.noPrior", { days: periodDays });

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            <span className="eyebrow">
              {org.name} · {scopeLabel}
            </span>
            {org.fictional && <DemoBadge label={t("demoBadge")} />}
          </span>
        }
        title={t("title")}
        description={t("description")}
        actions={
          <Segmented<Period>
            label={t("period.label")}
            value={period}
            onChange={setPeriod}
            options={(["7", "30", "90"] as const).map((d) => ({
              value: d,
              label: t("period.days", { count: Number(d) }),
            }))}
          />
        }
      />

      {loadFailed ? (
        <div className="surface">
          <StateCard
            tone="danger"
            icon={<AlertTriangle className="size-5" strokeWidth={1.75} />}
            title={t("states.loadFailed")}
            body={t("states.loadFailedBody")}
            action={
              <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)}>
                {t("states.retry")}
              </Button>
            }
          />
        </div>
      ) : !resources ? (
        <div className="space-y-6" aria-busy="true">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-[104px]" />
            ))}
          </div>
          <Skeleton className="h-40" />
        </div>
      ) : (
        <>
          <section className="space-y-3">
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              <StatTile
                label={t("kpi.grossRevenue")}
                value={fmtMoneyCents(summary.grossRevenueCents, lng)}
                hint={revenueHint}
              />
              <StatTile
                label={t("kpi.netResult")}
                value={fmtMoneyCents(summary.netRevenueCents, lng)}
                hint={t("kpi.netResultHint")}
                tone={hasRevenue && summary.netRevenueCents < 0 ? "negative" : "neutral"}
              />
              <StatTile
                label={t("kpi.cmv")}
                value={hasRevenue ? fmtPercent(cmvRatio, lng) : "—"}
                hint={
                  hasRevenue
                    ? t("kpi.cmvHint", {
                        min: fmtPercent(CMV_REFERENCE.min, lng),
                        max: fmtPercent(CMV_REFERENCE.max, lng),
                      })
                    : t("kpi.noRevenue")
                }
                tone={
                  !hasRevenue ? "neutral" : cmvRatio > CMV_REFERENCE.max ? "warning" : "positive"
                }
              />
              <StatTile
                label={t("kpi.grossMargin")}
                value={hasRevenue ? fmtPercent(ratio(summary.grossMarginRate), lng) : "—"}
                hint={t("kpi.recipes", { count: summary.activeRecipeCount })}
              />
              <StatTile
                label={t("kpi.lowStock")}
                value={fmtNumber(summary.lowStockItemCount, lng)}
                hint={t("kpi.tracked", { count: summary.dataBreakdown.inventoryCount })}
                tone={summary.lowStockItemCount > 0 ? "negative" : "positive"}
              />
            </div>
            <p className="flex items-start gap-2 text-xs text-muted-foreground">
              <ShieldCheck className="mt-px size-3.5 shrink-0" aria-hidden />
              {t("dataSource", {
                entries: fmtNumber(summary.dataBreakdown.realTransactionsCount, lng),
                orders: fmtNumber(summary.dataBreakdown.realOrdersCount, lng),
              })}
            </p>
          </section>

          <Panel title={t("agent.title")} subtitle={t("agent.subtitle")}>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                ask(question);
              }}
            >
              <Input
                aria-label={t("agent.inputLabel")}
                placeholder={t("agent.placeholder")}
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                className="h-9"
              />
              <Button type="submit" disabled={!question.trim()} className="h-9 shrink-0">
                {t("agent.ask")}
              </Button>
            </form>
            <div
              className="mt-3 flex flex-wrap gap-2"
              role="group"
              aria-label={t("agent.suggestionsLabel")}
            >
              {suggestions.map((s) => {
                const text = t(`agent.suggestions.${s.key}`);
                return (
                  <Button
                    key={s.key}
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs font-normal text-muted-foreground"
                    onClick={() => {
                      setQuestion(text);
                      ask(text, s.topic);
                    }}
                  >
                    {text}
                  </Button>
                );
              })}
            </div>

            {answer && (
              <div className="mt-5 space-y-4 border-t pt-4" aria-live="polite">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 space-y-1">
                    <p className="eyebrow">{t(`agent.topics.${answer.topic}`)}</p>
                    <h3 className="text-[15px] font-semibold">{answer.headline}</h3>
                    <p className="text-xs text-muted-foreground">
                      {t("agent.scope", { days: periodDays, scope: scopeLabel })}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="neutral">{t("agent.deterministic")}</Badge>
                    <span className="text-xs text-muted-foreground">
                      {t("agent.answeredAt", {
                        time: fmtDateTime(answer.answeredAt, lng, {
                          hour: "2-digit",
                          minute: "2-digit",
                        }),
                      })}
                    </span>
                  </div>
                </div>

                {answer.evidence.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">
                      {t("agent.evidence")}
                    </p>
                    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                      {answer.evidence.map((ev) => (
                        <div key={ev.label} className="rounded-md border p-3">
                          <dt className="truncate text-xs text-muted-foreground">{ev.label}</dt>
                          <dd className="tabular mt-1 text-sm font-semibold">{ev.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                )}

                <div className="grid gap-4 text-xs md:grid-cols-2">
                  <div>
                    <p className="font-medium">{t("agent.method")}</p>
                    <p className="mt-1 text-muted-foreground">{answer.method}</p>
                  </div>
                  <div>
                    <p className="font-medium">{t("agent.limitation")}</p>
                    <p className="mt-1 text-muted-foreground">{answer.limitation}</p>
                  </div>
                </div>
              </div>
            )}
          </Panel>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <Panel
                title={t("insights.title")}
                subtitle={t("insights.subtitle")}
                action={
                  <Segmented<InsightFilter>
                    label={t("insights.filterLabel")}
                    value={filter}
                    onChange={setFilter}
                    options={(["all", "cmv", "inventory", "sales"] as const).map((f) => ({
                      value: f,
                      label: t(`insights.filters.${f}`),
                    }))}
                  />
                }
              >
                {visibleInsights.length === 0 ? (
                  <EmptyState
                    icon={<ClipboardList className="size-5" strokeWidth={1.75} />}
                    title={t("insights.emptyTitle")}
                    body={t("insights.emptyBody")}
                  />
                ) : (
                  <ul className="divide-y">
                    {visibleInsights.map((ins) => (
                      <li key={ins.id} className="py-4 first:pt-0 last:pb-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant={LEVEL_BADGE[ins.level]}>
                            {t(`insights.levels.${ins.level}`)}
                          </Badge>
                          <h3 className="text-sm font-semibold">{ins.title}</h3>
                        </div>
                        <p className="mt-1.5 text-sm text-muted-foreground">{ins.body}</p>
                        {ins.detail && (
                          <p className="mt-1 text-xs text-muted-foreground">{ins.detail}</p>
                        )}
                        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                          <span>{ins.action}</span>
                          <Link
                            to={ins.link}
                            className="inline-flex items-center gap-0.5 font-medium text-primary hover:underline"
                          >
                            {t("insights.openModule")}
                            <ChevronRight className="size-3.5" aria-hidden />
                          </Link>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel title={t("stores.title")} subtitle={t("stores.subtitle")}>
                {stores.length === 0 ? (
                  <EmptyState
                    icon={<Store className="size-5" strokeWidth={1.75} />}
                    title={t("stores.emptyTitle")}
                    body={t("stores.emptyBody")}
                  />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-xs text-muted-foreground">
                          <th scope="col" className="pb-2 font-medium">
                            <span className="sr-only">{t("stores.title")}</span>
                          </th>
                          <th scope="col" className="pb-2 text-right font-medium">
                            {t("stores.revenue")}
                          </th>
                          <th scope="col" className="pb-2 text-right font-medium">
                            {t("stores.cmv")}
                          </th>
                          <th scope="col" className="pb-2 text-right font-medium">
                            {t("stores.lowStock")}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {stores.map((s) => (
                          <tr key={s.id}>
                            <td className="py-2.5 font-medium">{s.name}</td>
                            <td className="tabular py-2.5 text-right">
                              {fmtMoneyCents(s.summary.grossRevenueCents, lng)}
                            </td>
                            <td className="tabular py-2.5 text-right">
                              {s.summary.grossRevenueCents > 0
                                ? fmtPercent(ratio(s.summary.cmvRate), lng)
                                : "—"}
                            </td>
                            <td className="tabular py-2.5 text-right">
                              {fmtNumber(s.summary.lowStockItemCount, lng)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Panel>
            </div>

            <WhatsAppPreviewCard
              summary={summary}
              periodDays={periodDays}
              scopeLabel={scopeLabel}
            />
          </div>
        </>
      )}
    </div>
  );
}
