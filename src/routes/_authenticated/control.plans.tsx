import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  AlertCircle,
  Check,
  CreditCard,
  FileEdit,
  History,
  Info,
  Minus,
  Power,
  ShieldAlert,
  Sparkles,
  Users,
  Building2,
  Clock,
} from "lucide-react";

import { Section, Tag, inputCls, LoadingRows } from "@/components/control/control-ui";
import {
  FullPlanDef,
  PlanChangeEntry,
  PlanFeature,
  PlanId,
  PlanImpactSummary,
  discardPlanDraft,
  getPlanChangeHistory,
  getPlanFeatures,
  hasPlanDraft,
  listFullPlans,
  publishPlanDraft,
  savePlanDraft,
  simulatePlanImpact,
  togglePlanActive,
} from "@/lib/admin-service";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/control/plans")({
  head: () => ({
    meta: [
      { title: "Plans & pricing · Servora Control Center" },
      {
        name: "description",
        content:
          "Manage subscription tiers, visual comparisons, draft edits and impact simulations.",
      },
      { property: "og:title", content: "Plans & pricing · Servora Control Center" },
      {
        property: "og:description",
        content:
          "Manage subscription tiers, visual comparisons, draft edits and impact simulations.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ControlPlansPage,
});

function ControlPlansPage() {
  const { t, i18n } = useTranslation("control");
  const { user } = Route.useRouteContext();
  const [plans, setPlans] = useState<FullPlanDef[]>([]);
  const [features, setFeatures] = useState<PlanFeature[]>([]);
  const [history, setHistory] = useState<PlanChangeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Modal states
  const [editingPlan, setEditingPlan] = useState<FullPlanDef | null>(null);
  const [editForm, setEditForm] = useState<Partial<FullPlanDef>>({});
  const [reason, setReason] = useState("");
  const [impact, setImpact] = useState<PlanImpactSummary | null>(null);
  const [isSimulating, setIsSimulating] = useState(false);

  const loadData = async () => {
    try {
      const [allPlans, allFeatures, hist] = await Promise.all([
        listFullPlans(),
        Promise.resolve(getPlanFeatures()),
        Promise.resolve(getPlanChangeHistory()),
      ]);
      setPlans(allPlans);
      setFeatures(allFeatures);
      setHistory(hist);
    } catch (err) {
      toast.error(t("errors.unknown"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadData();
  }, []);

  const handleOpenEdit = async (p: FullPlanDef) => {
    setEditingPlan(p);
    setEditForm({
      name: p.name,
      description: p.description,
      priceMonthlyUsd: p.priceMonthlyUsd,
      priceAnnualUsd: p.priceAnnualUsd,
      maxLocations: p.maxLocations,
      maxEmployees: p.maxEmployees,
      trialDays: p.trialDays,
    });
    setReason("");
    setIsSimulating(true);
    try {
      const imp = await simulatePlanImpact(p.id, {});
      setImpact(imp);
    } finally {
      setIsSimulating(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!editingPlan) return;
    if (reason.trim().length < 3) {
      toast.error(t("errors.reason_required"));
      return;
    }
    try {
      savePlanDraft(editingPlan.id, editForm, reason, user.email ?? "platform_admin");
      toast.success(t("plansPage.saved"));
      setEditingPlan(null);
      await loadData();
    } catch (e: any) {
      toast.error(t(`errors.${e.message}`, { defaultValue: t("errors.unknown") }));
    }
  };

  const handlePublish = async (planId: PlanId) => {
    const r = window.prompt(t("plansPage.reasonPlaceholder"));
    if (!r || r.trim().length < 3) {
      toast.error(t("errors.reason_required"));
      return;
    }
    try {
      publishPlanDraft(planId, r, user.email ?? "platform_admin");
      toast.success(t("plansPage.publishedSuccess"));
      await loadData();
    } catch (e: any) {
      toast.error(t(`errors.${e.message}`, { defaultValue: t("errors.unknown") }));
    }
  };

  const handleDiscard = async (planId: PlanId) => {
    discardPlanDraft(planId);
    toast.info(t("plansPage.discarded"));
    await loadData();
  };

  const handleToggleActive = async (plan: FullPlanDef) => {
    const next = !plan.isActive;
    const r = window.prompt(t("plansPage.reasonPlaceholder"));
    if (!r || r.trim().length < 3) {
      toast.error(t("errors.reason_required"));
      return;
    }
    try {
      togglePlanActive(plan.id, next, r, user.email ?? "platform_admin");
      toast.success(t(next ? "plansPage.activated" : "plansPage.deactivated"));
      await loadData();
    } catch (e: any) {
      toast.error(t(`errors.${e.message}`, { defaultValue: t("errors.unknown") }));
    }
  };

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            {t("plansPage.title")}
          </h1>
          <p className="text-sm text-muted-foreground">{t("plansPage.subtitle")}</p>
        </div>
        <Tag tone="warning" className="w-fit">
          <ShieldAlert className="mr-1 size-3.5" />
          {t("plansPage.simBanner")}
        </Tag>
      </header>

      {loading ? (
        <LoadingRows rows={3} />
      ) : (
        <>
          {/* 1. Cards dos Planos */}
          <div className="grid gap-6 md:grid-cols-3">
            {plans.map((p) => {
              const isDraft = hasPlanDraft(p.id);
              return (
                <div
                  key={p.id}
                  className={cn(
                    "relative flex flex-col justify-between rounded-xl border bg-card p-6 shadow-sm transition-all",
                    !p.isActive && "opacity-60 grayscale",
                    isDraft && "border-warning ring-1 ring-warning",
                  )}
                >
                  {isDraft && (
                    <div className="absolute -top-3 left-4 rounded-full bg-warning px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-warning-foreground shadow">
                      {t("plansPage.hasDraft")}
                    </div>
                  )}
                  <div>
                    <div className="flex items-center justify-between">
                      <h2 className="text-xl font-bold tracking-tight">{p.name}</h2>
                      <Tag tone="neutral">
                        {t(p.isActive ? "plansPage.active" : "plansPage.inactive")}
                      </Tag>
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>

                    <div className="mt-4 flex items-baseline gap-1">
                      <span className="text-3xl font-extrabold tracking-tight">
                        {fmtCurrency(p.priceMonthlyUsd, i18n.language)}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t("plansPage.perMonth")}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {fmtCurrency(p.priceAnnualUsd, i18n.language)} {t("plansPage.perYear")} (
                      {t("plansPage.annual")})
                    </p>

                    <div className="mt-6 space-y-2.5 border-t pt-4 text-xs">
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <Building2 className="size-3.5" /> {t("plansPage.maxLocations")}
                        </span>
                        <span className="font-semibold text-foreground">
                          {p.maxLocations >= 999 ? t("plansPage.unlimited") : p.maxLocations}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <Users className="size-3.5" /> {t("plansPage.maxEmployees")}
                        </span>
                        <span className="font-semibold text-foreground">
                          {p.maxEmployees >= 999 ? t("plansPage.unlimited") : p.maxEmployees}
                        </span>
                      </div>
                      <div className="flex items-center justify-between text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                          <Clock className="size-3.5" /> {t("plansPage.trialDays")}
                        </span>
                        <span className="font-semibold text-foreground">{p.trialDays}d</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 space-y-2 border-t pt-4">
                    <div className="flex gap-2">
                      <button
                        onClick={() => void handleOpenEdit(p)}
                        className="flex-1 rounded-md border bg-secondary px-3 py-1.5 text-xs font-medium text-secondary-foreground hover:bg-secondary/80"
                      >
                        <FileEdit className="mr-1.5 inline size-3.5" />
                        {t("plansPage.editPlan")}
                      </button>
                      <button
                        onClick={() => void handleToggleActive(p)}
                        className={cn(
                          "rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors",
                          p.isActive
                            ? "text-destructive hover:bg-destructive/10"
                            : "text-success hover:bg-success/10",
                        )}
                        title={t(p.isActive ? "plansPage.deactivate" : "plansPage.activate")}
                      >
                        <Power className="size-3.5" />
                      </button>
                    </div>

                    {isDraft && (
                      <div className="flex gap-1.5 pt-1">
                        <button
                          onClick={() => void handlePublish(p.id)}
                          className="flex-1 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90"
                        >
                          {t("plansPage.publishDraft")}
                        </button>
                        <button
                          onClick={() => void handleDiscard(p.id)}
                          className="rounded-md border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted"
                        >
                          {t("plansPage.discardDraft")}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 2. Comparativo Visual de Funcionalidades */}
          <Section
            title={t("plansPage.comparison")}
            hint={t("plansPage.comparisonHint")}
            className="overflow-hidden"
          >
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="p-3.5 font-medium">{t("plansPage.features")}</th>
                    <th className="p-3.5 text-center font-medium">Starter</th>
                    <th className="p-3.5 text-center font-medium">Growth</th>
                    <th className="p-3.5 text-center font-medium">Enterprise</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {features.map((f) => (
                    <tr key={f.key} className="hover:bg-muted/20">
                      <td className="p-3.5 text-xs font-medium text-foreground">
                        {t(`planFeatures.${f.key}`, { defaultValue: f.key })}
                      </td>
                      <td className="p-3.5 text-center">
                        {f.starter ? (
                          <Check className="mx-auto size-4 text-success" />
                        ) : (
                          <Minus className="mx-auto size-4 text-muted-foreground/30" />
                        )}
                      </td>
                      <td className="p-3.5 text-center">
                        {f.growth ? (
                          <Check className="mx-auto size-4 text-success" />
                        ) : (
                          <Minus className="mx-auto size-4 text-muted-foreground/30" />
                        )}
                      </td>
                      <td className="p-3.5 text-center">
                        {f.enterprise ? (
                          <Check className="mx-auto size-4 text-success" />
                        ) : (
                          <Minus className="mx-auto size-4 text-muted-foreground/30" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* 3. Histórico de Alterações / Auditoria de Planos */}
          <Section title={t("plansPage.history")} hint={t("plansPage.historyHint")}>
            {history.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                <History className="mx-auto mb-2 size-5 opacity-40" />
                {t("plansPage.historyEmpty")}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b bg-muted/40 text-muted-foreground">
                    <tr>
                      <th className="p-3 font-medium">{t("plansPage.when")}</th>
                      <th className="p-3 font-medium">Plan</th>
                      <th className="p-3 font-medium">{t("plansPage.field")}</th>
                      <th className="p-3 font-medium">{t("plansPage.oldValue")}</th>
                      <th className="p-3 font-medium">{t("plansPage.newValue")}</th>
                      <th className="p-3 font-medium">{t("plansPage.reason")}</th>
                      <th className="p-3 font-medium">{t("plansPage.author")}</th>
                      <th className="p-3 font-medium">{t("plansPage.status")}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {history.map((h) => (
                      <tr key={h.id} className="hover:bg-muted/10">
                        <td className="whitespace-nowrap p-3 text-muted-foreground">
                          {fmtDate(h.createdAt, i18n.language, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </td>
                        <td className="p-3 font-semibold uppercase text-foreground">{h.planId}</td>
                        <td className="p-3 font-mono text-[11px]">{h.field}</td>
                        <td className="p-3 text-muted-foreground line-through">
                          {h.oldValue || "—"}
                        </td>
                        <td className="p-3 font-medium text-foreground">{h.newValue}</td>
                        <td
                          className="max-w-[200px] truncate p-3 text-muted-foreground"
                          title={h.reason}
                        >
                          {h.reason}
                        </td>
                        <td className="p-3 text-muted-foreground">{h.actorEmail}</td>
                        <td className="p-3">
                          <Tag tone={h.status === "published" ? "neutral" : "warning"}>
                            {t(`plansPage.${h.status}`)}
                          </Tag>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}

      {/* Modal de Edição com Validação e Simulação */}
      {editingPlan && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <div className="relative w-full max-w-lg rounded-xl border bg-card p-6 shadow-xl">
            <h3 className="text-lg font-bold tracking-tight">
              {t("plansPage.editTitle", { name: editingPlan.name })}
            </h3>
            <p className="text-xs text-muted-foreground">{t("plansPage.editDescription")}</p>

            <div className="my-4 space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-medium">
                  {t("plansPage.priceMonthly")}
                  <input
                    type="number"
                    className={inputCls}
                    value={editForm.priceMonthlyUsd ?? 0}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, priceMonthlyUsd: Number(e.target.value) }))
                    }
                  />
                </label>
                <label className="text-xs font-medium">
                  {t("plansPage.priceAnnual")}
                  <input
                    type="number"
                    className={inputCls}
                    value={editForm.priceAnnualUsd ?? 0}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, priceAnnualUsd: Number(e.target.value) }))
                    }
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-medium">
                  {t("plansPage.maxLocations")}
                  <input
                    type="number"
                    className={inputCls}
                    value={editForm.maxLocations ?? 1}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, maxLocations: Number(e.target.value) }))
                    }
                  />
                </label>
                <label className="text-xs font-medium">
                  {t("plansPage.maxEmployees")}
                  <input
                    type="number"
                    className={inputCls}
                    value={editForm.maxEmployees ?? 10}
                    onChange={(e) =>
                      setEditForm((f) => ({ ...f, maxEmployees: Number(e.target.value) }))
                    }
                  />
                </label>
              </div>

              <label className="block text-xs font-medium">
                {t("plansPage.description")}
                <input
                  type="text"
                  className={inputCls}
                  value={editForm.description ?? ""}
                  onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                />
              </label>

              {/* Simulação de Impacto */}
              <div className="rounded-lg border bg-muted/30 p-3 text-xs">
                <p className="flex items-center gap-1.5 font-semibold text-foreground">
                  <Sparkles className="size-3.5 text-primary" />
                  {t("plansPage.impact")}
                </p>
                <p className="mt-0.5 text-[11px] text-muted-foreground">
                  {t("plansPage.impactHint")}
                </p>
                <div className="mt-2 flex gap-4 text-muted-foreground">
                  <span>
                    {t("plansPage.affectedOrgs")}: <strong>{impact?.affectedOrgs ?? 0}</strong>
                  </span>
                  <span>
                    {t("plansPage.affectedLocations")}:{" "}
                    <strong>{impact?.affectedLocations ?? 0}</strong>
                  </span>
                </div>
              </div>

              {/* Justificativa Obrigatória */}
              <label className="block text-xs font-medium text-foreground">
                {t("plansPage.reasonLabel")}
                <textarea
                  rows={2}
                  required
                  className={cn(inputCls, "h-auto py-1.5")}
                  placeholder={t("plansPage.reasonPlaceholder")}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            </div>

            <div className="flex justify-end gap-2 border-t pt-4">
              <button
                onClick={() => setEditingPlan(null)}
                className="rounded-md border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
              >
                {t("plansPage.cancel")}
              </button>
              <button
                onClick={() => void handleSaveDraft()}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                {t("plansPage.saveDraft")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
