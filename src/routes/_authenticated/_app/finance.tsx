import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CircleAlert, Plus, ShieldAlert } from "lucide-react";
import { toast } from "sonner";

import {
  fetchOperationalOrders,
  fetchOperationalResources,
  saveOperationalRecord,
} from "@/lib/operational.functions";
import { mapResources, type Resources } from "@/lib/operational-mappers";
import { ledgerMetrics } from "@/lib/operational-metrics";
import {
  cashOutForecast,
  financialResult,
  summarizeExpenses,
  todayIso,
} from "@/lib/expense-metrics";
import type { Expense } from "@/lib/finance-service";
import type { Order } from "@/lib/orders-service";
import { fmtMoneyCents, fmtPercent } from "@/lib/format";
import { useWorkspace } from "@/components/app/workspace-context";
import { PageHeader } from "@/components/app/page";
import { DemoBadge } from "@/components/app/brand-mark";
import { Skeleton, StateCard } from "@/components/app/states";
import { StatTile } from "@/components/app/stat-tile";
import { Button, buttonVariants } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { FinanceReports } from "@/components/finance/finance-reports";
import {
  BillListPanel,
  CashflowSection,
  CategoryBreakdownPanel,
  ExpensesPanel,
  PnlPanel,
  StoresPanel,
  TrendPanel,
  type ExpenseActions,
} from "@/components/finance/finance-sections";
import { ExpenseFormDialog } from "@/components/finance/expense-form-dialog";
import {
  expensePayload,
  initialFormValues,
  type ExpenseFormValues,
  ledgerForLocation,
  markPaidPayload,
  monthlyTrend,
  overdueBills,
  parseAmountToCents,
  storeResults,
  upcomingBills,
  withEffectiveStatus,
} from "@/components/finance/finance-model";

export const Route = createFileRoute("/_authenticated/_app/finance")({
  head: () => ({
    meta: [
      { title: "Financial Management · Dinequora" },
      { name: "description", content: "Recorded restaurant revenue, expenses and recipe cost." },
      { property: "og:title", content: "Financial Management · Dinequora" },
      {
        property: "og:description",
        content: "Recorded restaurant revenue, expenses and recipe cost.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: FinancePage,
});

type LoadState = "loading" | "ready" | "error";
type Tab = "overview" | "expenses" | "pnl" | "cashflow" | "stores" | "reports";

export function FinancePage() {
  const { t, i18n } = useTranslation("finance");
  const lng = i18n.language;
  const { org, locationId, user, can, canAny } = useWorkspace();
  // Same rule as Reports and the Overview: the selected store zone, or the first store zone for "all".
  const timeZone =
    (locationId === "all"
      ? org.locations[0]?.timezone
      : org.locations.find((l) => l.id === locationId)?.timezone) ?? undefined;
  // Owners and managers manage expenses; RLS/RPCs still enforce store scope on the server.
  const canManage = canAny(["expenses.create", "expenses.edit", "expenses.pay", "expenses.delete"]);
  const stores = org.locations;
  const storeName = useCallback(
    (id: string) => stores.find((l) => l.id === id)?.name ?? "—",
    [stores],
  );
  const showStore = locationId === "all" && stores.length > 1;
  const today = useMemo(() => todayIso(), []);

  const [state, setState] = useState<LoadState>("loading");
  const [allExpenses, setAllExpenses] = useState<Expense[]>([]);
  const [entries, setEntries] = useState<Resources["finance"]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [tab, setTab] = useState<Tab>("overview");

  const load = useCallback(async () => {
    const [r, o] = await Promise.all([
      fetchOperationalResources({ data: { orgId: org.id } }),
      fetchOperationalOrders({ data: { orgId: org.id, limit: 200 } }),
    ]);
    return { expenses: mapResources(r).expenses, entries: r.finance, orders: o.orders };
  }, [org.id]);

  const reload = useCallback(async () => {
    try {
      const d = await load();
      setAllExpenses(d.expenses);
      setEntries(d.entries);
      setOrders(d.orders);
      setState("ready");
    } catch {
      setState("error");
    }
  }, [load]);

  useEffect(() => {
    let active = true;
    setState("loading");
    setAllExpenses([]);
    setEntries([]);
    setOrders([]);
    load()
      .then((d) => {
        if (!active) return;
        setAllExpenses(d.expenses);
        setEntries(d.entries);
        setOrders(d.orders);
        setState("ready");
      })
      .catch(() => {
        if (active) setState("error");
      });
    return () => {
      active = false;
    };
  }, [load]);

  // ── Scoped figures (store switcher) ──
  const expenses = useMemo(
    () =>
      locationId === "all" ? allExpenses : allExpenses.filter((e) => e.locationId === locationId),
    [allExpenses, locationId],
  );
  const scopedEntries = useMemo(
    () => ledgerForLocation(entries, stores, locationId),
    [entries, stores, locationId],
  );
  const ledger = useMemo(() => ledgerMetrics(scopedEntries), [scopedEntries]);
  const summary = useMemo(() => summarizeExpenses(expenses, today), [expenses, today]);
  const result = financialResult({ ...ledger, expensesCents: summary.totalCents });
  const trend = useMemo(
    () => monthlyTrend(scopedEntries, expenses, today.slice(0, 7), timeZone),
    [scopedEntries, expenses, today, timeZone],
  );
  const forecast = useMemo(() => cashOutForecast(expenses, 6, today), [expenses, today]);
  const last28RevenueCents = useMemo(() => {
    const from = Date.parse(today + "T00:00:00") - 27 * 86400000;
    return ledgerMetrics(scopedEntries.filter((e) => Date.parse(e.created_at) >= from))
      .revenueCents;
  }, [scopedEntries, today]);
  const perStore = useMemo(
    () => storeResults(stores, entries, allExpenses),
    [stores, entries, allExpenses],
  );
  const overdue = useMemo(() => overdueBills(expenses, today), [expenses, today]);
  const upcoming = useMemo(() => upcomingBills(expenses, today, 14), [expenses, today]);
  const reportExpenses = useMemo(
    () => withEffectiveStatus(allExpenses, today),
    [allExpenses, today],
  );
  const scopedOrders = useMemo(
    () => (locationId === "all" ? orders : orders.filter((o) => o.locationId === locationId)),
    [orders, locationId],
  );
  const simulatedSalesCents = scopedOrders
    .filter((o) => o.isSimulated)
    .reduce((s, o) => s + o.totalCents, 0);
  const simulatedExpenseCount = expenses.filter((e) => e.isSimulation).length;

  // ── Writes: only through saveOperationalRecord → save_operational_record RPC ──
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [formInitial, setFormInitial] = useState<ExpenseFormValues>(() =>
    initialFormValues(null, { locationId: "", dueDate: today, responsiblePerson: "" }),
  );
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function write(storeId: string, payload: Record<string, string | number | boolean>) {
    await saveOperationalRecord({
      data: { orgId: org.id, locationId: storeId, kind: "expense", payload },
    });
  }

  const openNew = () => {
    setEditing(null);
    setFormInitial(
      initialFormValues(null, {
        locationId:
          locationId !== "all" ? locationId : stores.length === 1 ? (stores[0]?.id ?? "") : "",
        dueDate: today,
        responsiblePerson: user.fullName ?? user.email,
      }),
    );
    setFormOpen(true);
  };

  const openEdit = (exp: Expense) => {
    setEditing(exp);
    setFormInitial(
      initialFormValues(exp, { locationId: exp.locationId, dueDate: today, responsiblePerson: "" }),
    );
    setFormOpen(true);
  };

  async function submitExpense(v: ExpenseFormValues) {
    if (!canManage || saving) return;
    const description = v.description.trim();
    if (!description) return void toast.error(t("errors.descriptionRequired"));
    const amountCents = parseAmountToCents(v.amount);
    if (amountCents === null || amountCents <= 0)
      return void toast.error(t("errors.amountPositive"));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.dueDate))
      return void toast.error(t("errors.dueDateRequired"));
    // Updates must target the record's own store (the RPC rejects a different one).
    const storeId = editing ? editing.locationId : v.locationId;
    if (!storeId || storeId === "all" || !stores.some((s) => s.id === storeId))
      return void toast.error(t("errors.storeRequired"));

    const paidAt =
      v.status === "paid"
        ? editing?.status === "paid" && editing.paidAt
          ? editing.paidAt
          : new Date().toISOString()
        : undefined;
    const payload = expensePayload({
      id: editing?.id,
      category: v.category,
      recurrence: v.recurrence,
      status: v.status,
      description,
      amountCents,
      dueDate: v.dueDate,
      competencyDate:
        editing && editing.dueDate === v.dueDate
          ? editing.competencyDate
          : `${v.dueDate.slice(0, 7)}-01`,
      responsiblePerson: v.responsiblePerson.trim(),
      supplierName: v.supplierName.trim() || undefined,
      paidAt,
      isSimulation: editing?.isSimulation ?? false,
    });

    setSaving(true);
    try {
      await write(storeId, payload);
    } catch {
      toast.error(t("errors.generic"));
      return;
    } finally {
      setSaving(false);
    }
    setFormOpen(false);
    toast.success(editing ? t("expenseUpdated") : t("expenseCreated"));
    await reload();
  }

  async function markPaid(exp: Expense) {
    if (!canManage || busyId) return;
    setBusyId(exp.id);
    try {
      await write(exp.locationId, markPaidPayload(exp, new Date().toISOString()));
    } catch {
      toast.error(t("errors.generic"));
      setBusyId(null);
      return;
    }
    toast.success(t("bills.markedPaid"));
    await reload();
    setBusyId(null);
  }

  async function confirmDelete() {
    const exp = toDelete;
    if (!exp || !canManage || deleting) return;
    setDeleting(true);
    try {
      await write(exp.locationId, { ...expensePayload(exp), active: false });
    } catch {
      toast.error(t("errors.generic"));
      return;
    } finally {
      setDeleting(false);
    }
    setToDelete(null);
    toast.success(t("expenseDeleted"));
    await reload();
  }

  const actions: ExpenseActions = {
    canManage,
    busyId,
    showStore,
    storeName,
    onMarkPaid: (e) => void markPaid(e),
    onEdit: openEdit,
    onDelete: setToDelete,
  };
  const money = (c: number) => fmtMoneyCents(c, lng);
  const hasRevenue = ledger.revenueCents !== 0;
  const resultTone =
    !hasRevenue && summary.totalCents === 0
      ? "neutral"
      : result.resultCents >= 0
        ? "positive"
        : "negative";

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <PageHeader
        eyebrow={
          <div className="flex items-center gap-2">
            <span className="eyebrow">{org.name}</span>
            {org.fictional && <DemoBadge label={t("demoBadge")} />}
          </div>
        }
        title={t("title")}
        description={t("subtitle")}
        actions={
          canManage && stores.length > 0 ? (
            <Button size="sm" onClick={openNew} disabled={state !== "ready"}>
              <Plus />
              {t("newExpense")}
            </Button>
          ) : undefined
        }
      />

      {!canManage && (
        <div className="surface flex items-center gap-2 px-4 py-2.5 text-xs text-muted-foreground">
          <ShieldAlert className="size-4 shrink-0 text-warning" />
          <span>{t("readOnlyNotice")}</span>
        </div>
      )}

      {state === "loading" && (
        <div className="space-y-6" role="status" aria-label={t("loading")}>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-[92px]" />
            ))}
          </div>
          <Skeleton className="h-80" />
        </div>
      )}

      {state === "error" && (
        <div className="surface">
          <StateCard
            tone="danger"
            icon={<CircleAlert className="size-5" />}
            title={t("errors.loadFailed")}
            body={t("errors.loadFailedBody")}
            action={
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setState("loading");
                  void reload();
                }}
              >
                {t("errors.retry")}
              </Button>
            }
          />
        </div>
      )}

      {state === "ready" && (
        <>
          {(simulatedSalesCents > 0 || simulatedExpenseCount > 0) && (
            <div className="surface demo-stripe flex flex-wrap items-center gap-2 px-4 py-2.5 text-xs text-muted-foreground">
              <DemoBadge label={t("simulation.badge")} />
              <span>
                {t("simulation.body", {
                  sales: money(simulatedSalesCents),
                  count: simulatedExpenseCount,
                })}
              </span>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatTile
              className="col-span-2 lg:col-span-1"
              label={t("kpi.result")}
              value={money(result.resultCents)}
              tone={resultTone}
              hint={
                hasRevenue
                  ? t("kpi.resultHint", {
                      gross: money(result.grossProfitCents),
                      margin:
                        result.grossMargin === null ? "—" : fmtPercent(result.grossMargin, lng),
                    })
                  : t("kpi.resultNoRevenue")
              }
            />
            <StatTile
              label={t("kpi.expenses")}
              value={money(summary.totalCents)}
              hint={t("kpi.expensesHint", {
                personnel: money(summary.personnelCents),
                operating: money(summary.operatingCents),
              })}
            />
            <StatTile
              label={t("kpi.dueSoon")}
              value={money(summary.dueNext7DaysCents)}
              tone={summary.dueNext7DaysCents > 0 ? "warning" : "neutral"}
              hint={t("kpi.dueSoonHint", { count: summary.counts.pending })}
            />
            <StatTile
              label={t("kpi.overdue")}
              value={money(summary.overdueCents)}
              tone={summary.counts.overdue > 0 ? "negative" : "neutral"}
              hint={
                summary.counts.overdue > 0
                  ? t("kpi.overdueHint", { count: summary.counts.overdue })
                  : t("kpi.overdueNone")
              }
            />
            <StatTile
              label={t("kpi.paid")}
              value={money(summary.paidCents)}
              tone={summary.counts.paid > 0 ? "positive" : "neutral"}
              hint={t("kpi.paidHint", { count: summary.counts.paid })}
            />
          </div>
          <p className="-mt-3 text-xs text-muted-foreground">{t("period")}</p>

          <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
            <div className="overflow-x-auto">
              <TabsList aria-label={t("tabs.label")}>
                <TabsTrigger value="overview">{t("tabs.overview")}</TabsTrigger>
                <TabsTrigger value="expenses">{t("tabs.expenses")}</TabsTrigger>
                <TabsTrigger value="pnl">{t("tabs.pnl")}</TabsTrigger>
                <TabsTrigger value="cashflow">{t("tabs.cashflow")}</TabsTrigger>
                {stores.length > 1 && <TabsTrigger value="stores">{t("tabs.stores")}</TabsTrigger>}
                <TabsTrigger value="reports">{t("tabs.reports")}</TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="overview" className="mt-4 space-y-6">
              <div className="grid gap-6 lg:grid-cols-3">
                <TrendPanel className="lg:col-span-2" trend={trend} />
                <CategoryBreakdownPanel summary={summary} />
              </div>
              <div className="grid gap-6 lg:grid-cols-2">
                <BillListPanel
                  title={t("bills.overdueTitle")}
                  subtitle={t("bills.overdueSubtitle")}
                  empty={t("bills.overdueEmpty")}
                  bills={overdue}
                  today={today}
                  actions={actions}
                />
                <BillListPanel
                  title={t("bills.upcomingTitle")}
                  subtitle={t("bills.upcomingSubtitle")}
                  empty={t("bills.upcomingEmpty")}
                  bills={upcoming}
                  today={today}
                  actions={actions}
                />
              </div>
            </TabsContent>

            <TabsContent value="expenses" className="mt-4">
              <ExpensesPanel
                expenses={expenses}
                stores={stores}
                today={today}
                actions={actions}
                onCreate={canManage && stores.length > 0 ? openNew : undefined}
              />
            </TabsContent>

            <TabsContent value="pnl" className="mt-4">
              <PnlPanel
                revenueCents={ledger.revenueCents}
                cogsCents={ledger.cogsCents}
                grossProfitCents={result.grossProfitCents}
                grossMargin={result.grossMargin}
                resultCents={result.resultCents}
                summary={summary}
              />
            </TabsContent>

            <TabsContent value="cashflow" className="mt-4">
              <CashflowSection
                revenueCents={ledger.revenueCents}
                paidCents={summary.paidCents}
                last28RevenueCents={last28RevenueCents}
                forecast={forecast}
              />
            </TabsContent>

            {stores.length > 1 && (
              <TabsContent value="stores" className="mt-4">
                <StoresPanel stores={perStore} />
              </TabsContent>
            )}

            <TabsContent value="reports" className="mt-4">
              <FinanceReports
                restaurantName={org.name}
                locations={stores}
                currentLocationId={locationId}
                expenses={reportExpenses}
                entries={entries}
                orders={orders}
                stores={perStore}
                currentMonth={today.slice(0, 7)}
                timeZone={timeZone}
              />
            </TabsContent>
          </Tabs>
        </>
      )}

      <ExpenseFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        editing={editing}
        initial={formInitial}
        stores={stores}
        saving={saving}
        onSubmit={(v) => void submitExpense(v)}
      />

      <AlertDialog
        open={toDelete !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteConfirm.title")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("deleteConfirm.body", { description: toDelete?.description ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t("form.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: "destructive" })}
              disabled={deleting}
              aria-busy={deleting}
              onClick={(e) => {
                // Keep the dialog open until the server confirms.
                e.preventDefault();
                void confirmDelete();
              }}
            >
              {deleting ? t("deleteConfirm.deleting") : t("deleteConfirm.action")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
