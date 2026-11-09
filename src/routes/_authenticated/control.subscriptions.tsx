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
  ArrowDownRight,
  Ban,
  ShieldAlert,
  CheckCircle2,
  Clock,
  Building2,
  CreditCard,
} from "lucide-react";
import { toast } from "sonner";

import { useControlData } from "@/components/control/use-control-data";
import { LoadFailure } from "@/components/control/load-failure";
import { AppPending } from "@/components/app/states";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
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

const PLAN_PRICES: Record<PlanId, { monthly: number; annual: number }> = {
  starter: { monthly: 29, annual: 290 },
  growth: { monthly: 79, annual: 790 },
  enterprise: { monthly: 199, annual: 1990 },
};

function SubscriptionsControlRoute() {
  const { t } = useTranslation("control");
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
      toast.error(
        t(
          "errors.reason_required",
          "A justificativa detalhada é obrigatória (mínimo 5 caracteres).",
        ),
      );
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

      toast.success(t("saved", "Ação administrativa executada e auditada com sucesso."));
      setActionTarget(null);
      setSelectedAction(null);
      await reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao executar ação");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Stripe Disconnected Notice */}
      <div className="flex items-center gap-3 rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 text-amber-800 dark:text-amber-200">
        <AlertTriangle className="size-5 shrink-0" />
        <div className="text-xs leading-relaxed md:text-sm">
          <strong>Stripe desconectado:</strong> Nenhuma cobrança real é faturada ou alterada em
          provedores externos. Todas as ações e números são simulados em ambiente controlado com
          auditoria interna.
        </div>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">
          Assinaturas e Faturamento
        </h1>
        <p className="text-sm text-muted-foreground">
          Visão geral de faturamento por organização, métricas estimadas e controles administrativos
          com justificativa obrigatória.
        </p>
      </div>

      {/* Metrics Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              MRR Estimado
            </CardTitle>
            <DollarSign className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-bold">${metrics.mrr.toLocaleString("en-US")}</div>
              <Badge
                variant="outline"
                className="text-[10px] text-amber-600 border-amber-300 dark:border-amber-700"
              >
                Estimativa
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Projeção com base nos planos ativos
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              ARR Projetado
            </CardTitle>
            <TrendingUp className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-bold">${metrics.arr.toLocaleString("en-US")}</div>
              <Badge
                variant="outline"
                className="text-[10px] text-amber-600 border-amber-300 dark:border-amber-700"
              >
                Estimativa
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Anualização teórica sem Stripe</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Taxa de Churn
            </CardTitle>
            <Ban className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-bold">{metrics.churnRate}%</div>
              <Badge variant="secondary" className="text-[10px]">
                Simulado
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">Baseado em contas suspensas</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Conversão de Trial
            </CardTitle>
            <UserCheck className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2">
              <div className="text-2xl font-bold">{metrics.trialConversion}%</div>
              <Badge variant="secondary" className="text-[10px]">
                Estimado
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {metrics.trialCount} em trial atualmente
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            placeholder="Buscar cliente ou email..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              setStatusFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos Status</SelectItem>
              <SelectItem value="active">Ativas</SelectItem>
              <SelectItem value="trial">Em Trial</SelectItem>
              <SelectItem value="suspended">Suspensas</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={planFilter}
            onValueChange={(v) => {
              setPlanFilter(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Plano" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos Planos</SelectItem>
              <SelectItem value="starter">Starter</SelectItem>
              <SelectItem value="growth">Growth</SelectItem>
              <SelectItem value="enterprise">Enterprise</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Organização / Cliente</TableHead>
                <TableHead>Plano & Valor</TableHead>
                <TableHead>Lojas Ativas</TableHead>
                <TableHead>Renovação / Ciclo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações Administrativas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginated.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="h-32 text-center text-muted-foreground">
                    Nenhuma assinatura encontrada para os filtros selecionados.
                  </TableCell>
                </TableRow>
              ) : (
                paginated.map((org) => {
                  const planInfo = PLAN_PRICES[org.plan as PlanId] ?? { monthly: 0, annual: 0 };
                  const storeMultiplier = Math.max(1, org.active_store_count || 1);
                  const totalMonthly = planInfo.monthly * storeMultiplier;

                  return (
                    <TableRow key={org.id}>
                      <TableCell className="font-medium">
                        <div className="flex flex-col">
                          <span className="font-semibold text-foreground">{org.name}</span>
                          <span className="text-xs text-muted-foreground">
                            {org.owner_email ?? "Sem proprietário"}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col">
                          <span className="capitalize font-medium">{org.plan}</span>
                          <span className="text-xs text-muted-foreground">
                            ${totalMonthly}/mês (${planInfo.annual * storeMultiplier}/ano)
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {org.active_store_count} de {org.store_limit}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock className="size-3.5" />
                          {org.trial_ends_at ? (
                            <span>
                              Trial até {new Date(org.trial_ends_at).toLocaleDateString()}
                            </span>
                          ) : (
                            <span>Mensal (renovação dia 1)</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            org.status === "active"
                              ? "default"
                              : org.status === "trial"
                                ? "secondary"
                                : "destructive"
                          }
                          className="capitalize"
                        >
                          {org.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleOpenAction(org, "upgrade")}
                            title="Upgrade / Downgrade"
                          >
                            <ArrowUpRight className="size-3.5 mr-1" /> Alterar
                          </Button>
                          {org.status === "active" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:bg-destructive/10"
                              onClick={() => handleOpenAction(org, "cancel")}
                              title="Cancelar / Suspender"
                            >
                              <Ban className="size-3.5 mr-1" /> Suspender
                            </Button>
                          )}
                          {org.status === "suspended" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-emerald-600 hover:bg-emerald-500/10"
                              onClick={() => handleOpenAction(org, "reactivate")}
                              title="Reativar"
                            >
                              <RefreshCw className="size-3.5 mr-1" /> Reativar
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            Página {page} de {totalPages} ({filtered.length} total)
          </span>
          <div className="flex gap-1">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
            </Button>
          </div>
        </div>
      )}

      {/* Action Dialog */}
      <Dialog open={!!actionTarget} onOpenChange={(open) => !open && setActionTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {selectedAction === "upgrade" && "Alterar Plano da Assinatura"}
              {selectedAction === "cancel" && "Suspender / Cancelar Assinatura"}
              {selectedAction === "reactivate" && "Reativar Assinatura"}
              {selectedAction === "renew" && "Renovar Assinatura"}
            </DialogTitle>
            <DialogDescription>
              Ação direta para a organização <strong>{actionTarget?.name}</strong>. Todas as ações
              exigem justificativa registrada na auditoria.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {(selectedAction === "upgrade" || selectedAction === "downgrade") && (
              <div className="space-y-2">
                <label className="text-xs font-semibold">Novo Plano</label>
                <Select value={targetPlan} onValueChange={(v) => setTargetPlan(v as PlanId)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Selecione o plano" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="starter">Starter ($29/mês)</SelectItem>
                    <SelectItem value="growth">Growth ($79/mês)</SelectItem>
                    <SelectItem value="enterprise">Enterprise ($199/mês)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <label className="text-xs font-semibold text-foreground">
                Justificativa Obrigatória <span className="text-destructive">*</span>
              </label>
              <Textarea
                rows={3}
                placeholder="Descreva o motivo desta ação administrativa para auditoria..."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Mínimo de 5 caracteres. Ficará registrado permanentemente no log da plataforma.
              </p>
            </div>

            <div className="rounded-md bg-muted p-2.5 text-xs text-muted-foreground">
              <strong>Nota:</strong> Como o Stripe está desconectado, não há cobrança em cartão.
              Esta ação atualiza permissões e status internamente.
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setActionTarget(null)} disabled={saving}>
              Cancelar
            </Button>
            <Button
              variant={selectedAction === "cancel" ? "destructive" : "default"}
              onClick={handleExecuteAction}
              disabled={saving || reason.trim().length < 5}
            >
              {saving ? "Processando..." : "Confirmar Ação"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Audit History Snapshot */}
      {localAudit.length > 0 && (
        <Card className="border-dashed">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <ShieldAlert className="size-4 text-primary" />
              Ações Administrativas Recentes nesta Sessão
            </CardTitle>
            <CardDescription className="text-xs">
              Histórico de alterações realizadas sem recarregar a tela.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {localAudit.map((log) => (
                <div
                  key={log.id}
                  className="flex items-start justify-between border-b pb-2 text-xs"
                >
                  <div>
                    <span className="font-semibold">{log.orgName}:</span>{" "}
                    <span className="uppercase text-[10px] font-mono bg-muted px-1 rounded">
                      {log.action}
                    </span>{" "}
                    - {log.reason}
                  </div>
                  <span className="text-muted-foreground text-[10px]">
                    {new Date(log.date).toLocaleTimeString()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
