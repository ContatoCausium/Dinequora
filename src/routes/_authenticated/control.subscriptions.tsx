import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Search,
  AlertTriangle,
  DollarSign,
  TrendingUp,
  UserCheck,
  RefreshCw,
  ArrowUpRight,
  Ban,
  ShieldAlert,
  CheckCircle2,
  Clock,
  CreditCard,
} from "lucide-react";
import { toast } from "sonner";

import { useControlData } from "@/components/control/use-control-data";
import { LoadFailure } from "@/components/control/load-failure";
import { AppPending } from "@/components/app/states";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { FormSelect } from "@/components/ui/form-select";
import { StatTile } from "@/components/app/stat-tile";
import { Pager } from "@/components/app/data-table";
import { fmtCurrency, fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { updateOrganization, type OrgInsight, type PlanId } from "@/lib/admin-service";

export const Route = createFileRoute("/_authenticated/control/subscriptions")({
  pendingComponent: AppPending,
  component: SubscriptionsControlRoute,
});

type ActionType =
  | "upgrade"
  | "downgrade"
  | "cancel"
  | "renew"
  | "reactivate"
  | "simulate_failed"
  | "simulate_grace";

interface AuditLogEntry {
  id: string;
  orgId: string;
  orgName: string;
  action: ActionType;
  reason: string;
  date: string;
}

/**
 * Placeholder LIST prices used only for estimates on this page (labelled as such in the UI). They
 * are not the billing catalog and are never charged; unchanged in wave 0 (no price changes).
 */
const PLAN_PRICES: Record<PlanId, { monthly: number; annual: number }> = {
  starter: { monthly: 29, annual: 290 },
  growth: { monthly: 79, annual: 790 },
  enterprise: { monthly: 199, annual: 1990 },
};

function SubscriptionsControlRoute() {
  const { t, i18n } = useTranslation("control");
  const lng = i18n.language;
  const { data, error, reload } = useControlData();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [planFilter, setPlanFilter] = useState<string>("all");
  const [page, setPage] = useState(1);
  const pageSize = 8;

  const [actionTarget, setActionTarget] = useState<OrgInsight | null>(null);
  const [selectedAction, setSelectedAction] = useState<ActionType | null>(null);
  const [targetPlan, setTargetPlan] = useState<PlanId>("growth");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [localAudit, setLocalAudit] = useState<AuditLogEntry[]>([]);

  const items = useMemo(() => {
    if (!data) return [];
    return data.orgs.filter((org) => !org.is_demo);
  }, [data]);

  const metrics = useMemo(() => {
    const activeOrgs = items.filter((o) => o.status === "active");
    const trialOrgs = items.filter((o) => o.status === "trial");
    const suspendedOrgs = items.filter((o) => o.status === "suspended");

    const mrr = activeOrgs.reduce((acc, o) => {
      const price = PLAN_PRICES[o.plan as PlanId]?.monthly ?? 0;
      const count = Math.max(1, o.active_store_count || 1);
      return acc + price * count;
    }, 0);

    const arr = mrr * 12;
    const churnRate = items.length > 0 ? (suspendedOrgs.length / items.length) * 100 : 0;
    const trialConversion = items.length > 0 ? (activeOrgs.length / items.length) * 100 : 0;

    return {
      mrr,
      arr,
      churnRate: churnRate.toFixed(1),
      trialConversion: trialConversion.toFixed(1),
      activeCount: activeOrgs.length,
      trialCount: trialOrgs.length,
    };
  }, [items]);

  const filtered = useMemo(() => {
    return items.filter((org) => {
      const matchSearch =
        org.name.toLowerCase().includes(search.toLowerCase()) ||
        (org.owner_email ?? "").toLowerCase().includes(search.toLowerCase());
      const matchStatus = statusFilter === "all" || org.status === statusFilter;
      const matchPlan = planFilter === "all" || org.plan === planFilter;
      return matchSearch && matchStatus && matchPlan;
    });
  }, [items, search, statusFilter, planFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const paginated = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  if (error) return <LoadFailure kind={error} retry={() => void reload()} />;
  if (!data) return null;

  const handleOpenAction = (org: OrgInsight, action: ActionType) => {
    setActionTarget(org);
    setSelectedAction(action);
    setTargetPlan(action === "downgrade" ? "starter" : "enterprise");
    setReason("");
  };

  const handleExecuteAction = async () => {
    if (!actionTarget || !selectedAction) return;
    if (reason.trim().length < 5) {
      toast.error(t("subsPage.reasonRequired"));
      return;
    }

    setSaving(true);
    try {
      if (selectedAction === "upgrade" || selectedAction === "downgrade") {
        await updateOrganization(actionTarget.id, { plan: targetPlan }, reason);
      } else if (selectedAction === "cancel" || selectedAction === "simulate_failed") {
        await updateOrganization(actionTarget.id, { status: "suspended" }, reason);
      } else if (selectedAction === "reactivate" || selectedAction === "renew") {
        await updateOrganization(actionTarget.id, { status: "active" }, reason);
      } else {
        // No write exists for this action without a billing provider (e.g. grace period): say so,
        // never "applied and recorded" (wave 0).
        toast.info(t("subsPage.nothingApplied"));
        setActionTarget(null);
        setSelectedAction(null);
        return;
      }

      const newLog: AuditLogEntry = {
        id: `aud-${Date.now()}`,
        orgId: actionTarget.id,
        orgName: actionTarget.name,
        action: selectedAction,
        reason: reason.trim(),
        date: new Date().toISOString(),
      };
      setLocalAudit((prev) => [newLog, ...prev]);

      toast.success(t("subsPage.saved"));
      setActionTarget(null);
      setSelectedAction(null);
      await reload();
    } catch (err) {
      toast.error(
        t("subsPage.failed"),
        err instanceof Error ? { description: err.message } : undefined,
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{t("nav.subscriptions")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{t("subsPage.subtitle")}</p>
      </header>

      {/* Billing provider not connected: nothing here charges a card. */}
      <div
        role="note"
        className="flex items-start gap-3 rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-foreground"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
        <p>
          <strong className="font-semibold">{t("subsPage.notConnectedTitle")}</strong>{" "}
          {t("subsPage.notConnectedBody")}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatTile
          label={t("subsPage.mrr")}
          value={fmtCurrency(metrics.mrr, lng)}
          hint={t("subsPage.mrrHint")}
          icon={<DollarSign />}
        />
        <StatTile
          label={t("subsPage.arr")}
          value={fmtCurrency(metrics.arr, lng)}
          hint={t("subsPage.arrHint")}
          icon={<TrendingUp />}
        />
        <StatTile
          label={t("subsPage.churn")}
          value={`${metrics.churnRate}%`}
          hint={t("subsPage.churnHint")}
          icon={<Ban />}
        />
        <StatTile
          label={t("subsPage.trialConversion")}
          value={`${metrics.trialConversion}%`}
          hint={t("subsPage.trialConversionHint", { count: metrics.trialCount })}
          icon={<UserCheck />}
        />
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <label className="relative w-full sm:max-w-sm">
          <span className="sr-only">{t("subsPage.search")}</span>
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            placeholder={t("subsPage.search")}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <FormSelect
            aria-label={t("subsPage.statusFilter")}
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="min-w-40"
          >
            <option value="all">{t("subsPage.allStatuses")}</option>
            <option value="active">{t("status.active")}</option>
            <option value="trial">{t("status.trial")}</option>
            <option value="suspended">{t("status.suspended")}</option>
          </FormSelect>
          <FormSelect
            aria-label={t("subsPage.planFilter")}
            value={planFilter}
            onChange={(e) => {
              setPlanFilter(e.target.value);
              setPage(1);
            }}
            className="min-w-40"
          >
            <option value="all">{t("subsPage.allPlans")}</option>
            <option value="starter">{t("plans.starter")}</option>
            <option value="growth">{t("plans.growth")}</option>
            <option value="enterprise">{t("plans.enterprise")}</option>
          </FormSelect>
        </div>
      </div>

      <div className="surface overflow-hidden">
        <div
          className="overflow-x-auto focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          tabIndex={0}
          role="region"
          aria-label={t("nav.subscriptions")}
        >
          <table className={cn("data-table text-left", paginated.length > 0 && "min-w-[760px]")}>
            <thead>
              <tr>
                <th scope="col">{t("subsPage.colOrg")}</th>
                <th scope="col">{t("subsPage.colPlan")}</th>
                <th scope="col">{t("subsPage.colStores")}</th>
                <th scope="col">{t("subsPage.colRenewal")}</th>
                <th scope="col">{t("subsPage.colStatus")}</th>
                <th scope="col" className="text-right">
                  <span className="sr-only">{t("subsPage.colActions")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-muted-foreground">
                      <CreditCard className="size-5" aria-hidden />
                      {t("subsPage.empty")}
                    </div>
                  </td>
                </tr>
              ) : (
                paginated.map((org) => {
                  const planInfo = PLAN_PRICES[org.plan as PlanId] ?? { monthly: 0, annual: 0 };
                  const storeMultiplier = Math.max(1, org.active_store_count || 1);
                  const totalMonthly = planInfo.monthly * storeMultiplier;
                  const status = STATUS_STYLE[org.status as keyof typeof STATUS_STYLE];
                  return (
                    <tr key={org.id}>
                      <td>
                        <p className="font-medium text-foreground">{org.name}</p>
                        <p className="break-all text-xs text-muted-foreground">
                          {org.owner_email ?? t("subsPage.noOwner")}
                        </p>
                      </td>
                      <td>
                        <p className="font-medium">{t(`plans.${org.plan}`, org.plan)}</p>
                        <p className="tabular text-xs text-muted-foreground">
                          {t("subsPage.price", {
                            monthly: fmtCurrency(totalMonthly, lng),
                            annual: fmtCurrency(planInfo.annual * storeMultiplier, lng),
                          })}
                        </p>
                      </td>
                      <td className="tabular">
                        {t("subsPage.storesOf", {
                          used: org.active_store_count,
                          limit: org.store_limit,
                        })}
                      </td>
                      <td>
                        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock className="size-3.5" aria-hidden />
                          {org.trial_ends_at
                            ? t("subsPage.trialUntil", {
                                date: fmtDate(org.trial_ends_at.slice(0, 10), lng),
                              })
                            : t("subsPage.monthly")}
                        </span>
                      </td>
                      <td>
                        <Badge variant={status?.variant ?? "neutral"}>
                          {status ? <status.icon aria-hidden /> : null}
                          {t(`status.${org.status}`, org.status)}
                        </Badge>
                      </td>
                      <td>
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenAction(org, "upgrade")}
                          >
                            <ArrowUpRight aria-hidden /> {t("subsPage.changePlan")}
                          </Button>
                          {org.status === "active" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => handleOpenAction(org, "cancel")}
                            >
                              <Ban aria-hidden /> {t("subsPage.suspend")}
                            </Button>
                          )}
                          {org.status === "suspended" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-success hover:bg-success/10"
                              onClick={() => handleOpenAction(org, "reactivate")}
                            >
                              <RefreshCw aria-hidden /> {t("subsPage.reactivate")}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        <Pager
          page={page}
          pageCount={totalPages}
          pageSize={pageSize}
          total={filtered.length}
          onPage={setPage}
        />
      </div>

      <Dialog open={!!actionTarget} onOpenChange={(open) => !open && setActionTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedAction ? t(`subsPage.dialog.${selectedAction}`, "") : ""}
            </DialogTitle>
            <DialogDescription>
              {t("subsPage.dialog.description", { name: actionTarget?.name ?? "" })}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {(selectedAction === "upgrade" || selectedAction === "downgrade") && (
              <div className="flex flex-col gap-1.5">
                <label htmlFor="subs-plan" className="text-sm font-medium">
                  {t("subsPage.dialog.newPlan")}
                </label>
                <FormSelect
                  id="subs-plan"
                  value={targetPlan}
                  onChange={(e) => setTargetPlan(e.target.value as PlanId)}
                  className="w-full"
                >
                  {(["starter", "growth", "enterprise"] as const).map((p) => (
                    <option key={p} value={p}>
                      {t("subsPage.dialog.planOption", {
                        plan: t(`plans.${p}`),
                        price: fmtCurrency(PLAN_PRICES[p].monthly, lng),
                      })}
                    </option>
                  ))}
                </FormSelect>
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label htmlFor="subs-reason" className="text-sm font-medium">
                {t("subsPage.dialog.reason")} <span className="text-destructive">*</span>
              </label>
              <Textarea
                id="subs-reason"
                rows={3}
                placeholder={t("subsPage.dialog.reasonPlaceholder")}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                aria-describedby="subs-reason-hint"
              />
              <p id="subs-reason-hint" className="text-xs text-muted-foreground">
                {t("subsPage.dialog.reasonHint")}
              </p>
            </div>

            <p className="rounded-md bg-muted p-2.5 text-xs text-muted-foreground">
              {t("subsPage.dialog.note")}
            </p>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setActionTarget(null)} disabled={saving}>
              {t("subsPage.dialog.cancel")}
            </Button>
            <Button
              variant={selectedAction === "cancel" ? "destructive" : "default"}
              onClick={handleExecuteAction}
              disabled={saving || reason.trim().length < 5}
              loading={saving}
            >
              {t("subsPage.dialog.confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {localAudit.length > 0 && (
        <section className="surface p-5">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <ShieldAlert className="size-4 text-primary" aria-hidden />
            {t("subsPage.sessionTitle")}
          </h2>
          <p className="mt-0.5 text-[12.5px] text-muted-foreground">{t("subsPage.sessionBody")}</p>
          <ul className="mt-3 divide-y text-sm">
            {localAudit.map((log) => (
              <li key={log.id} className="flex items-start justify-between gap-3 py-2">
                <span className="min-w-0 break-words">
                  <span className="font-medium">{log.orgName}</span>
                  <Badge variant="neutral" className="mx-1.5">
                    {t(`subsPage.dialog.${log.action}`, log.action)}
                  </Badge>
                  {log.reason}
                </span>
                <span className="tabular shrink-0 text-xs text-muted-foreground">
                  {new Date(log.date).toLocaleTimeString(lng)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Subscription status vocabulary (same as the rest of the product: icon + label). */
const STATUS_STYLE = {
  active: { variant: "success", icon: CheckCircle2 },
  trial: { variant: "info", icon: Clock },
  suspended: { variant: "danger", icon: Ban },
} as const;
