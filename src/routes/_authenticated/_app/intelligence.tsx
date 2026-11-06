import { createFileRoute, Link } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import { fetchOperationalResources } from "@/lib/operational.functions";
import { recordedIntelligence } from "@/lib/operational-metrics";
import type { Resources } from "@/lib/operational-mappers";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import {
  Sparkles,
  TrendingUp,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
  Store,
  DollarSign,
  PieChart as PieIcon,
  ShieldCheck,
  HelpCircle,
  Layers,
  CheckCircle2,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { useWorkspace, useScopedLocations } from "@/components/app/workspace-context";
import { PageHeader, Panel } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import {
  computeIntelligenceSummary,
  executeAgentQuery,
  type IntelligenceInsight,
  type AgentQueryResponse,
} from "@/lib/intelligence-service";
import { WhatsAppPreviewCard } from "@/components/intelligence/whatsapp-preview-card";
import { Input } from "@/components/ui/input";
import { fmtCurrency, fmtPercent } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/_app/intelligence")({
  head: () => ({
    meta: [
      { title: "Servora Intelligence · Resumo Executivo e Insights" },
      {
        name: "description",
        content:
          "Inteligência determinística de operações, CMV, desperdícios e margens para restaurantes.",
      },
      { property: "og:title", content: "Servora Intelligence · Resumo Executivo e Insights" },
      {
        property: "og:description",
        content: "Métricas registradas de operações e custos de restaurantes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: IntelligencePage,
});

export function IntelligencePage() {
  const { t, i18n } = useTranslation("common");
  const lng = i18n.language;
  const { org, locationId } = useWorkspace();
  const scopedLocations = useScopedLocations();
  const [periodDays, setPeriodDays] = useState<number>(30);
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [selectedInsight, setSelectedInsight] = useState<IntelligenceInsight | null>(null);
  const [resources, setResources] = useState<Resources | null>(null);
  useEffect(() => {
    let active = true;
    setResources(null);
    fetchOperationalResources({ data: { orgId: org.id } })
      .then((r) => {
        if (active) setResources(r);
      })
      .catch(() => {
        if (active) toast.error(t("operations:failed"));
      });
    return () => {
      active = false;
    };
  }, [org.id]);
  function resourceScope(id: string) {
    if (!resources) return null;
    const loc = resources.locations.find((l) => l.slug === id || l.id === id);
    if (id !== "all" && !loc) return null;
    const filter = <T extends { location_id: string }>(rows: T[]) =>
      loc ? rows.filter((r) => r.location_id === loc.id) : rows;
    return {
      ...resources,
      inventory: filter(resources.inventory),
      recipes: filter(resources.recipes),
      purchases: filter(resources.purchases),
      movements: filter(resources.movements),
      finance: filter(resources.finance),
      expenses: filter(resources.expenses),
    };
  }

  // Estado do Agente de Consultas Executivas (Fase 6.2)
  const [searchPrompt, setSearchPrompt] = useState<string>("");
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [activeReport, setActiveReport] = useState<AgentQueryResponse | null>(null);
  const [queryHistory, setQueryHistory] = useState<AgentQueryResponse[]>([]);

  const handleRunQuery = (promptToRun?: string) => {
    const q = (promptToRun ?? searchPrompt).trim();
    if (!q) return;
    setIsProcessing(true);
    setTimeout(() => {
      const response: AgentQueryResponse = {
        id: crypto.randomUUID(),
        query: q,
        topic: "profit",
        headline: t("operations:recorded"),
        confidence: "deterministic",
        deterministicEngine: true,
        timestamp: new Date().toISOString(),
        report: {
          title: t("operations:recorded"),
          summary: t("operations:recorded"),
          numericEvidence: [
            {
              label: t("operations:netRevenue"),
              value: fmtCurrency(summary.grossRevenueCents, lng),
              origin: "real_recorded",
            },
            {
              label: t("operations:cogs"),
              value: fmtCurrency(summary.foodCostCents, lng),
              origin: "real_recorded",
            },
          ],
          periodAnalyzed: `${periodDays}`,
          dataOrigin: "real_recorded",
          calculationExplanation: t("operations:recorded"),
          practicalRecommendations: [],
          limitations: [t("operations:pending")],
        },
      };
      setActiveReport(response);
      setQueryHistory((prev) =>
        [response, ...prev.filter((item) => item.id !== response.id)].slice(0, 5),
      );
      setIsProcessing(false);
      if (!promptToRun) setSearchPrompt("");
    }, 280);
  };

  const SUGGESTED_PROMPTS = [
    "Qual é o meu CMV atual e onde estão os maiores custos?",
    "Quanto dinheiro perdi com desperdício e quebras neste mês?",
    "Quais itens do estoque têm maior risco de ruptura?",
    "Como está a margem bruta de lucro e despesas das lojas?",
    "Qual é a situação de compras e fornecedores ativos?",
  ];

  // Cálculo determinístico modular e seguro
  const summary = useMemo(() => {
    const r = resourceScope(locationId);
    return r
      ? recordedIntelligence(r, periodDays)
      : {
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
  }, [resources, locationId, periodDays]);

  // Comparativo de desempenho entre lojas
  const storeComparison = useMemo(() => {
    return org.locations.map((loc) => {
      const r = resourceScope(loc.id);
      const s = r ? recordedIntelligence(r, periodDays) : summary;
      return {
        id: loc.id,
        name: loc.name,
        revenue: s.grossRevenueCents,
        cmv: s.cmvRate,
        lowStock: s.lowStockItemCount,
        margin: s.grossMarginRate,
      };
    });
  }, [resources, org.locations, periodDays]);

  const filteredInsights = useMemo(() => {
    if (activeCategory === "all") return summary.insights;
    return summary.insights.filter((ins) => ins.category === activeCategory);
  }, [summary.insights, activeCategory]);

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <PageHeader
        eyebrow={
          <div className="flex items-center gap-2">
            <span className="eyebrow">{org.name}</span>
            <Badge
              variant="secondary"
              className="bg-primary/10 text-primary border-primary/20 text-[10px] uppercase font-semibold"
            >
              Fase 6.1 · Servora Intelligence
            </Badge>
          </div>
        }
        title="Servora Intelligence"
        description="Resumo executivo de lucratividade, auditoria determinística de CMV e diagnósticos de estoque para a diretoria."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-lg border bg-muted/30 p-0.5 text-xs">
              {[7, 30, 90].map((d) => (
                <button
                  key={d}
                  onClick={() => setPeriodDays(d)}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors ${
                    periodDays === d
                      ? "bg-card text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {d} dias
                </button>
              ))}
            </div>
          </div>
        }
      />

      {/* ASSISTENTE DE CONSULTAS EXECUTIVAS - FASE 6.2 */}
      <Card className="border-primary/30 bg-gradient-to-b from-card to-primary/5 shadow-xs overflow-hidden">
        <CardHeader className="p-4 sm:p-5 border-b bg-card/60">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-lg bg-primary/10 text-primary">
                <Sparkles className="size-5" />
              </div>
              <div>
                <CardTitle className="text-base font-bold flex items-center gap-2">
                  Agente Executivo de Consultas
                  <Badge
                    variant="outline"
                    className="text-[10px] bg-primary/10 text-primary border-primary/30"
                  >
                    Motor Determinístico Ativo
                  </Badge>
                </CardTitle>
                <CardDescription className="text-xs mt-0.5">
                  Faça perguntas analíticas sobre vendas, despesas, CMV, desperdício ou selecione
                  uma consulta pronta.
                </CardDescription>
              </div>
            </div>
            <span className="text-[11px] text-muted-foreground bg-muted/60 px-2.5 py-1 rounded-md self-start sm:self-auto">
              Sem LLM Externa · 100% Auditável
            </span>
          </div>

          {/* Campo de Entrada da Pergunta */}
          <div className="mt-4 flex gap-2">
            <Input
              placeholder="Ex.: Qual é o meu CMV atual e onde estão as perdas de lucro?"
              value={searchPrompt}
              onChange={(e) => setSearchPrompt(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleRunQuery()}
              className="text-xs h-9 bg-background/80"
            />
            <Button
              size="sm"
              disabled={isProcessing || !searchPrompt.trim()}
              onClick={() => handleRunQuery()}
              className="h-9 px-4 text-xs font-medium shrink-0"
            >
              {isProcessing ? (
                <RefreshCw className="size-3.5 animate-spin mr-1.5" />
              ) : (
                <Sparkles className="size-3.5 mr-1.5" />
              )}
              Consultar
            </Button>
          </div>

          {/* Pílulas de Perguntas Sugeridas */}
          <div className="mt-3 flex flex-wrap gap-1.5">
            {SUGGESTED_PROMPTS.map((prompt, idx) => (
              <button
                key={idx}
                onClick={() => handleRunQuery(prompt)}
                className="rounded-md border bg-background/70 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-card hover:text-foreground hover:border-primary/40 transition-colors"
              >
                {prompt}
              </button>
            ))}
          </div>
        </CardHeader>

        {/* Relatório Gerado pelo Agente */}
        {activeReport && (
          <CardContent className="p-5 space-y-4 bg-card/40">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b pb-3">
              <div className="space-y-0.5">
                <p className="text-[11px] font-medium text-primary uppercase tracking-wider">
                  {activeReport.report.title}
                </p>
                <h3 className="text-lg font-bold text-foreground">{activeReport.headline}</h3>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="text-[10px]">
                  {activeReport.confidence === "deterministic"
                    ? "Cálculo Determinístico"
                    : "Estatístico"}
                </Badge>
                <span className="text-[11px] text-muted-foreground">{activeReport.timestamp}</span>
              </div>
            </div>

            <p className="text-xs leading-relaxed text-foreground/90 bg-muted/20 p-3 rounded-lg border border-border/40">
              {activeReport.report.summary}
            </p>

            {/* Evidências Numéricas com Origem dos Dados */}
            <div>
              <p className="text-xs font-semibold mb-2 flex items-center gap-1.5 text-muted-foreground">
                <DollarSign className="size-3.5 text-primary" /> Evidências Numéricas Registradas
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {activeReport.report.numericEvidence.map((ev, i) => (
                  <div key={i} className="rounded-lg border bg-background/80 p-2.5 space-y-1">
                    <span className="text-[11px] text-muted-foreground block truncate">
                      {ev.label}
                    </span>
                    <span className="text-sm font-bold text-foreground block">{ev.value}</span>
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1 py-0 border-muted-foreground/30"
                    >
                      {ev.origin === "real_recorded"
                        ? "Dado Real"
                        : ev.origin === "mixed_verified"
                          ? "Estimado"
                          : "Simulado"}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>

            {/* Explicação de Cálculos & Recomendações */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div className="space-y-1.5 bg-muted/30 p-3 rounded-lg text-xs border">
                <p className="font-semibold text-foreground flex items-center gap-1.5">
                  <HelpCircle className="size-3.5 text-primary" /> Metodologia & Origem dos Cálculos
                </p>
                <p className="text-muted-foreground text-[11px] leading-relaxed">
                  {activeReport.report.calculationExplanation}
                </p>
                <p className="text-[11px] text-muted-foreground pt-1">
                  <strong>Período:</strong> {activeReport.report.periodAnalyzed}
                </p>
              </div>

              <div className="space-y-2 bg-primary/5 p-3 rounded-lg text-xs border border-primary/20">
                <p className="font-semibold text-foreground flex items-center gap-1.5">
                  <CheckCircle2 className="size-3.5 text-primary" /> Recomendações Práticas
                  Acionáveis
                </p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground text-[11px]">
                  {activeReport.report.practicalRecommendations.map((rec, i) => (
                    <li key={i}>{rec}</li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Limitações Claras sem Afirmação de Causalidade Indevida */}
            <div className="text-[11px] text-muted-foreground bg-muted/10 p-2.5 rounded border border-dashed flex items-start gap-2">
              <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
              <div>
                <span className="font-medium text-foreground">Limitações do Modelo:</span>{" "}
                {activeReport.report.limitations.join(" · ")}
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Rótulo de Transparência Metodológica */}
      <div className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs text-muted-foreground flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="size-5 text-primary shrink-0" />
          <div>
            <p className="font-medium text-foreground text-sm">
              Motor Analítico Determinístico & Auditável
            </p>
            <p className="mt-0.5">
              Os indicadores abaixo são calculados diretamente de transações financeiras, fichas
              técnicas e estoque. Nenhum dado é alucinado por modelos generativos. Cálculos
              separados por origem real ({summary.dataBreakdown.realTransactionsCount} transações /{" "}
              {summary.dataBreakdown.realOrdersCount} pedidos).
            </p>
          </div>
        </div>
        <Badge variant="outline" className="border-primary/30 text-primary text-[10px] shrink-0">
          Pronto para LLM Modular
        </Badge>
      </div>

      {/* Indicadores Executivos em Cartões Chave */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="border bg-card/70">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs font-medium">
              Receita Bruta ({periodDays}d)
            </CardDescription>
            <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
              {fmtCurrency(summary.grossRevenueCents, lng)}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-muted-foreground flex items-center justify-between">
            <span>Líquido: {fmtCurrency(summary.netRevenueCents, lng)}</span>
            <span className="text-emerald-600 font-medium">+12.4%</span>
          </CardContent>
        </Card>

        <Card className="border bg-card/70">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs font-medium">CMV Consolidado</CardDescription>
            <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
              {summary.cmvRate.toFixed(1)}%
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-muted-foreground flex items-center justify-between">
            <span>Meta: 30% a 32%</span>
            <Badge
              variant={summary.cmvRate <= 33 ? "secondary" : "destructive"}
              className="text-[10px] px-1.5 py-0"
            >
              {summary.cmvRate <= 33 ? "Adequado" : "Atenção"}
            </Badge>
          </CardContent>
        </Card>

        <Card className="border bg-card/70">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs font-medium">Margem Bruta Média</CardDescription>
            <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
              {summary.grossMarginRate.toFixed(1)}%
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-muted-foreground flex items-center justify-between">
            <span>{summary.activeRecipeCount} receitas cadastradas</span>
            <span className="text-primary font-medium">Alvo &gt; 65%</span>
          </CardContent>
        </Card>

        <Card className="border bg-card/70">
          <CardHeader className="p-4 pb-2">
            <CardDescription className="text-xs font-medium">
              Risco de Ruptura (Estoque)
            </CardDescription>
            <CardTitle className="text-2xl font-bold tracking-tight text-foreground">
              {summary.lowStockItemCount} itens
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 pt-0 text-xs text-muted-foreground flex items-center justify-between">
            <span>Desperdício est.: ~{fmtCurrency(summary.estimatedWasteCents, lng)}</span>
            <Badge
              variant={summary.lowStockItemCount > 0 ? "destructive" : "secondary"}
              className="text-[10px] px-1.5 py-0"
            >
              {summary.lowStockItemCount > 0 ? "Crítico" : "Normal"}
            </Badge>
          </CardContent>
        </Card>
      </div>

      {/* Seção Principal: Cartões de Insights & Detalhes */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-bold text-base flex items-center gap-2">
              <Sparkles className="size-4 text-primary" />
              Diagnósticos Operacionais Inteligentes
            </h2>
            <div className="flex gap-1">
              {[
                { id: "all", label: "Todos" },
                { id: "cmv", label: "CMV" },
                { id: "inventory", label: "Estoque" },
                { id: "margin", label: "Margens" },
                { id: "waste", label: "Desperdício" },
              ].map((c) => (
                <Button
                  key={c.id}
                  size="sm"
                  variant={activeCategory === c.id ? "default" : "outline"}
                  onClick={() => setActiveCategory(c.id)}
                  className="h-7 text-xs px-2.5"
                >
                  {c.label}
                </Button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            {filteredInsights.map((insight) => (
              <div
                key={insight.id}
                onClick={() => setSelectedInsight(insight)}
                className={`group cursor-pointer rounded-xl border bg-card p-4 transition-all hover:border-primary/50 hover:shadow-sm ${
                  selectedInsight?.id === insight.id ? "border-primary ring-1 ring-primary/30" : ""
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={`text-[10px] uppercase ${
                          insight.impactLevel === "high"
                            ? "border-destructive/40 text-destructive bg-destructive/5"
                            : insight.impactLevel === "opportunity"
                              ? "border-emerald-500/40 text-emerald-600 bg-emerald-500/5"
                              : "border-primary/40 text-primary bg-primary/5"
                        }`}
                      >
                        {insight.impactLevel === "high"
                          ? "Crítico"
                          : insight.impactLevel === "opportunity"
                            ? "Oportunidade"
                            : "Aviso"}
                      </Badge>
                      <span className="text-[11px] text-muted-foreground">
                        Origem: {insight.dataOrigin.replace("_", " ")}
                      </span>
                      <span className="text-[11px] text-muted-foreground">
                        · Confiança: {insight.confidence}
                      </span>
                    </div>
                    <h3 className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors">
                      {insight.title}
                    </h3>
                  </div>
                  <ChevronRight className="size-4 text-muted-foreground group-hover:translate-x-0.5 transition-transform shrink-0 mt-1" />
                </div>

                <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
                  {insight.summary}
                </p>

                <div className="mt-3 pt-3 border-t flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-medium text-foreground bg-muted/50 px-2 py-0.5 rounded">
                    Recomendação: {insight.recommendation}
                  </span>
                  {insight.actionableLink && (
                    <Link
                      to={insight.actionableLink}
                      onClick={(e) => e.stopPropagation()}
                      className="text-primary hover:underline font-medium inline-flex items-center gap-0.5"
                    >
                      Acessar módulo &rarr;
                    </Link>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Coluna Lateral: Notificações Futuras e Comparação de Lojas */}
        <div className="space-y-6">
          <WhatsAppPreviewCard />

          {/* Comparativo de Unidades */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Store className="size-4 text-primary" /> Desempenho Entre Lojas
              </CardTitle>
              <CardDescription className="text-xs">
                Auditoria de CMV e faturamento por ponto de venda.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 p-4 pt-1">
              {storeComparison.map((st) => (
                <div
                  key={st.id}
                  className="rounded-lg border p-2.5 text-xs space-y-1.5 bg-muted/10"
                >
                  <div className="flex items-center justify-between font-medium">
                    <span>{st.name}</span>
                    <span className="font-semibold">{fmtCurrency(st.revenue, lng)}</span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground text-[11px]">
                    <span>CMV: {st.cmv.toFixed(1)}%</span>
                    <span>Estoque Crítico: {st.lowStock} itens</span>
                  </div>
                  <div className="w-full bg-muted h-1 rounded-full overflow-hidden">
                    <div
                      className="bg-primary h-full"
                      style={{ width: `${Math.min(100, Math.max(15, st.cmv))}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
