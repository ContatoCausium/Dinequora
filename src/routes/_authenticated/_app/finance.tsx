import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo, useEffect } from "react";
import {
  fetchOperationalResources,
  saveOperationalRecord,
  fetchOperationalOrders,
  fetchOperationalMenu,
} from "@/lib/operational.functions";
import { mapResources, type Resources } from "@/lib/operational-mappers";
import { ledgerMetrics } from "@/lib/operational-metrics";
import type { Order } from "@/lib/orders-service";
import type { MenuItem } from "@/lib/menu-service";
import { useTranslation } from "react-i18next";
import {
  Landmark,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Calendar,
  Plus,
  AlertCircle,
  CheckCircle2,
  Clock,
  Trash2,
  Edit2,
  ShieldAlert,
  Filter,
  PieChart as PieChartIcon,
  FileText,
  ArrowUpRight,
  ArrowDownRight,
  Tag,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from "recharts";
import { toast } from "sonner";

import { useWorkspace } from "@/components/app/workspace-context";
import { PageHeader, Panel } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  listExpenses,
  saveExpense,
  deleteExpense,
  updateExpenseStatus,
  computeFinanceSummary,
  generateMonthlyTrend,
  buildCashFlowTimeline,
  formatUsd,
  calculateDreStatement,
  calculateProductMargins,
  calculateCategoryMargins,
  compareStoreFinancials,
  type Expense,
  type ExpenseCategory,
  type ExpenseRecurrence,
  type ExpenseStatus,
  type CashFlowGranularity,
} from "@/lib/finance-service";
import { FinanceReports } from "@/components/finance/finance-reports";
import { listMenuProducts } from "@/lib/menu-service";
import { listOrders } from "@/lib/orders-service";

export const Route = createFileRoute("/_authenticated/_app/finance")({
  head: () => ({
    meta: [
      { title: "Financial Management · Servora" },
      { name: "description", content: "Recorded restaurant revenue, expenses and recipe cost." },
      { property: "og:title", content: "Financial Management · Servora" },
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

const CATEGORIES: ExpenseCategory[] = [
  "suppliers",
  "taxes",
  "rent",
  "payroll",
  "utilities",
  "ingredients",
  "maintenance",
  "marketing",
  "other",
];

export function FinancePage() {
  const { t } = useTranslation("finance");
  const { org, locationId, role } = useWorkspace();
  const canManage = role !== "staff";
  // Owners are org-wide; managers/staff are limited to their authorized stores.
  const locationScope = role === "owner" ? undefined : org.locations.map((l) => l.id);

  const [allExpenses, setAllExpenses] = useState<Expense[]>([]);
  const [allOrders, setAllOrders] = useState<Order[]>([]);
  const [entries, setEntries] = useState<Resources["finance"]>([]);
  const [products, setProducts] = useState<MenuItem[]>([]);
  const expenses = allExpenses.filter((e) => locationId === "all" || e.locationId === locationId);
  const ledger = ledgerMetrics(
    entries.filter(
      (e) =>
        locationId === "all" ||
        org.locations.find((l) => l.id === locationId)?.dbId === e.location_id,
    ),
  );
  const [saving, setSaving] = useState(false);
  async function reloadFinance() {
    const [r, o, m] = await Promise.all([
      fetchOperationalResources({ data: { orgId: org.id } }),
      fetchOperationalOrders({ data: { orgId: org.id, limit: 200 } }),
      fetchOperationalMenu({ data: { orgId: org.id } }),
    ]);
    setAllExpenses(mapResources(r).expenses);
    setAllOrders(o.orders);
    setEntries(r.finance);
    setProducts(m.items);
  }
  useEffect(() => {
    let active = true;
    setAllExpenses([]);
    setAllOrders([]);
    setEntries([]);
    setProducts([]);
    Promise.all([
      fetchOperationalResources({ data: { orgId: org.id } }),
      fetchOperationalOrders({ data: { orgId: org.id, limit: 200 } }),
      fetchOperationalMenu({ data: { orgId: org.id } }),
    ])
      .then(([r, o, m]) => {
        if (!active) return;
        setAllExpenses(mapResources(r).expenses);
        setAllOrders(o.orders);
        setEntries(r.finance);
        setProducts(m.items);
      })
      .catch(() => {
        if (active) toast.error(t("errors.generic"));
      });
    return () => {
      active = false;
    };
  }, [org.id]);
  const [statusFilter, setStatusFilter] = useState<ExpenseStatus | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<ExpenseCategory | "all">("all");
  const [recurrenceFilter, setRecurrenceFilter] = useState<ExpenseRecurrence | "all">("all");
  const [search, setSearch] = useState("");
  const [viewTab, setViewTab] = useState<
    "overview" | "comparison" | "dre" | "cashflow" | "payables" | "reports"
  >("overview");
  const [cfGranularity, setCfGranularity] = useState<CashFlowGranularity>("monthly");
  const [selectedLocationIds, setSelectedLocationIds] = useState<string[]>(() =>
    org.locations.map((l) => l.id),
  );

  // Modal states
  const [formOpen, setFormOpen] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Form Fields
  const [formDescription, setFormDescription] = useState("");
  const [formAmount, setFormAmount] = useState("");
  const [formCategory, setFormCategory] = useState<ExpenseCategory>("suppliers");
  const [formRecurrence, setFormRecurrence] = useState<ExpenseRecurrence>("fixed");
  const [formStatus, setFormStatus] = useState<ExpenseStatus>("pending");
  const [formDueDate, setFormDueDate] = useState(
    () => new Date().toISOString().split("T")[0] || "",
  );
  const [formSupplier, setFormSupplier] = useState("");
  const [formResponsible, setFormResponsible] = useState("");

  // Pull sales orders to compute revenue, separating real paid orders from simulated/unfulfilled ones
  const orders = allOrders.filter((o) => locationId === "all" || o.locationId === locationId);
  const realSalesCents = useMemo(() => {
    return orders
      .filter((o) => o.status !== "cancelled" && !o.isSimulated)
      .reduce((sum, o) => sum + o.subtotalCents, 0);
  }, [orders]);

  const simulatedSalesCents = useMemo(() => {
    return orders.filter((o) => o.isSimulated).reduce((sum, o) => sum + o.totalCents, 0);
  }, [orders]);

  const discountsCents = useMemo(() => {
    return orders
      .filter((o) => !o.isSimulated && o.status !== "cancelled")
      .reduce((sum, o) => sum + (o.discountCents || 0), 0);
  }, [orders]);

  const taxesCents = useMemo(() => {
    return orders
      .filter((o) => !o.isSimulated && o.status !== "cancelled")
      .reduce((sum, o) => sum + (o.taxCents || 0), 0);
  }, [orders]);

  const menuProducts = products;

  // Calculate product margins and overall COGS
  const productMargins = useMemo(() => {
    return calculateProductMargins(
      menuProducts.map((p, idx) => ({
        id: p.id,
        name: p.name,
        category: p.category,
        priceCents: p.priceCents,
        recipeCostCents: 0,
        unitsSold: 0,
      })),
    );
  }, [menuProducts]);

  const categoryMargins = useMemo(() => {
    return calculateCategoryMargins(productMargins);
  }, [productMargins]);

  const totalCogsCents = useMemo(() => {
    return ledger.cogsCents;
  }, [ledger.cogsCents]);

  const dreStatement = useMemo(() => {
    // The ledger already excludes tax and discounts. Never manufacture a baseline.
    return calculateDreStatement(
      ledger.revenueCents,
      0,
      0,
      totalCogsCents,
      expenses,
      simulatedSalesCents,
    );
  }, [ledger.revenueCents, totalCogsCents, expenses, simulatedSalesCents]);

  // Multi-Store Comparison calculations
  const allOrgExpenses = allExpenses;
  const allOrgOrders = allOrders;

  const storeComparison = useMemo(() => {
    const activeLocations = org.locations.filter(
      (l) => selectedLocationIds.length === 0 || selectedLocationIds.includes(l.id),
    );
    const inputs = activeLocations.map((loc) => {
      const locOrders = allOrgOrders.filter((o) => o.locationId === loc.id);
      const locExpenses = allOrgExpenses.filter(
        (e) => e.locationId === loc.id || e.locationId === "all",
      );
      return {
        id: loc.id,
        name: loc.name,
        orders: locOrders.map((o) => ({
          id: o.id,
          totalCents: o.totalCents,
          discountCents: o.discountCents,
          taxCents: o.taxCents,
          status: o.status,
          isSimulated: o.isSimulated,
        })),
        expenses: locExpenses,
      };
    });
    return compareStoreFinancials(inputs);
  }, [org.locations, selectedLocationIds, allOrgOrders, allOrgExpenses]);

  // Finance metrics
  const summary = useMemo(() => {
    return computeFinanceSummary(expenses, ledger.revenueCents, simulatedSalesCents, 0);
  }, [expenses, ledger.revenueCents, simulatedSalesCents]);

  const monthlyTrend = useMemo(() => {
    return [];
  }, [summary.totalExpensesCents, realSalesCents]);

  const cashFlowTimeline = useMemo(() => {
    return buildCashFlowTimeline(expenses, ledger.revenueCents, cfGranularity, 0);
  }, [expenses, ledger.revenueCents, cfGranularity]);

  // Filtered expenses list
  const filteredExpenses = useMemo(() => {
    return expenses.filter((exp) => {
      if (statusFilter !== "all" && exp.status !== statusFilter) return false;
      if (categoryFilter !== "all" && exp.category !== categoryFilter) return false;
      if (recurrenceFilter !== "all" && exp.recurrence !== recurrenceFilter) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchDesc = exp.description.toLowerCase().includes(q);
        const matchSupp = exp.supplierName?.toLowerCase().includes(q) ?? false;
        if (!matchDesc && !matchSupp) return false;
      }
      return true;
    });
  }, [expenses, statusFilter, categoryFilter, recurrenceFilter, search]);

  const handleOpenNew = () => {
    setEditingExpense(null);
    setFormDescription("");
    setFormAmount("");
    setFormCategory("suppliers");
    setFormRecurrence("fixed");
    setFormStatus("pending");
    setFormDueDate(new Date().toISOString().split("T")[0] || "");
    setFormSupplier("");
    setFormResponsible("");
    setFormOpen(true);
  };

  const handleOpenEdit = (exp: Expense) => {
    setEditingExpense(exp);
    setFormDescription(exp.description);
    setFormAmount((exp.amountCents / 100).toFixed(2));
    setFormCategory(exp.category);
    setFormRecurrence(exp.recurrence);
    setFormStatus(exp.status);
    setFormDueDate(exp.dueDate);
    setFormSupplier(exp.supplierName || "");
    setFormResponsible(exp.responsiblePerson);
    setFormOpen(true);
  };

  const handleSaveExpense = async () => {
    if (!formDescription.trim()) {
      toast.error(t("errors.descriptionRequired"));
      return;
    }
    const val = parseFloat(formAmount);
    if (isNaN(val) || val <= 0) {
      toast.error(t("errors.amountPositive"));
      return;
    }
    const amountCents = Math.round(val * 100);

    if (saving) return;
    setSaving(true);
    try {
      await saveOperationalRecord({
        data: {
          orgId: org.id,
          locationId: locationId === "all" ? org.locations[0]?.id : locationId,
          kind: "expense",
          payload: {
            ...(editingExpense ? { id: editingExpense.id } : {}),
            orgId: org.id,
            locationId: locationId === "all" ? org.locations[0]?.id || "all" : locationId,
            category: formCategory,
            recurrence: formRecurrence,
            status: formStatus,
            supplierName: formSupplier.trim(),
            description: formDescription.trim(),
            amountCents,
            currency: "usd",
            dueDate: formDueDate,
            competencyDate: formDueDate.substring(0, 7) + "-01",
            responsiblePerson: formResponsible.trim() || "Store Manager",
            isSimulation: false,
          },
        },
      });
      await reloadFinance();
    } catch {
      toast.error(t("errors.generic", { defaultValue: "Action not allowed for this store" }));
      return;
    } finally {
      setSaving(false);
    }
    setFormOpen(false);
    toast.success(editingExpense ? t("expenseUpdated") : t("expenseCreated"));
  };

  const handleDeleteExpense = async (id: string) => {
    if (!canManage) return;
    try {
      const exp = expenses.find((e) => e.id === id);
      if (!exp) return;
      await saveOperationalRecord({
        data: {
          orgId: org.id,
          locationId: exp.locationId,
          kind: "expense",
          payload: { ...exp, active: false },
        },
      });
      await reloadFinance();
    } catch {
      toast.error(t("errors.generic", { defaultValue: "Action not allowed for this store" }));
      return;
    }
    setDeleteConfirmId(null);
    toast.success(t("expenseDeleted"));
  };

  const handleToggleStatus = async (exp: Expense) => {
    if (!canManage) return;
    const nextStatus: ExpenseStatus = exp.status === "paid" ? "pending" : "paid";
    try {
      await saveOperationalRecord({
        data: {
          orgId: org.id,
          locationId: exp.locationId,
          kind: "expense",
          payload: {
            ...exp,
            status: nextStatus,
            paidAt: nextStatus === "paid" ? new Date().toISOString() : "",
          },
        },
      });
      await reloadFinance();
    } catch {
      toast.error(t("errors.generic", { defaultValue: "Action not allowed for this store" }));
      return;
    }
    toast.success(t("statusChanged"));
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-6">
      <PageHeader
        eyebrow={<span className="eyebrow">{org.name}</span>}
        title={t("title")}
        description={t("subtitle")}
        actions={
          canManage ? (
            <Button size="sm" onClick={handleOpenNew}>
              <Plus className="mr-1.5 size-4" />
              {t("newExpense")}
            </Button>
          ) : undefined
        }
      />

      {/* Role Notice */}
      {!canManage && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-2.5 text-xs text-muted-foreground flex items-center gap-2">
          <ShieldAlert className="size-4 text-warning shrink-0" />
          <span>{t("readOnlyNotice")}</span>
        </div>
      )}

      {/* Key Metric Cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">
              {t("metrics.netProfit")}
            </span>
            <TrendingUp className="size-4 text-primary" />
          </div>
          <p className="tabular mt-2 text-2xl font-bold tracking-tight">
            {formatUsd(summary.estimatedNetCents)}
          </p>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{t("metrics.margin")}:</span>
            <span className="font-semibold text-foreground">
              {summary.marginPercent.toFixed(1)}%
            </span>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">
              {t("metrics.totalExpenses")}
            </span>
            <TrendingDown className="size-4 text-destructive" />
          </div>
          <p className="tabular mt-2 text-2xl font-bold tracking-tight text-destructive">
            {formatUsd(summary.totalExpensesCents)}
          </p>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
            <span>Fix: {formatUsd(summary.fixedExpensesCents)}</span>
            <span>•</span>
            <span>Var: {formatUsd(summary.variableExpensesCents)}</span>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">
              {t("metrics.payablesPending")}
            </span>
            <Clock className="size-4 text-amber-500" />
          </div>
          <p className="tabular mt-2 text-2xl font-bold tracking-tight text-amber-600">
            {formatUsd(summary.pendingPayablesCents)}
          </p>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span>{t("metrics.overdue")}:</span>
            <span className="font-bold text-destructive">
              {formatUsd(summary.overduePayablesCents)}
            </span>
          </div>
        </div>

        <div className="rounded-xl border bg-card p-4 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-medium uppercase tracking-wider">
              {t("metrics.paidThisMonth")}
            </span>
            <CheckCircle2 className="size-4 text-emerald-500" />
          </div>
          <p className="tabular mt-2 text-2xl font-bold tracking-tight text-emerald-600">
            {formatUsd(summary.paidCents)}
          </p>
          <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
            <span>
              {expenses.filter((e) => e.status === "paid").length} {t("table.paid")}
            </span>
          </div>
        </div>
      </div>

      {/* Real vs Simulated Income Notice */}
      <div className="rounded-lg border bg-muted/30 p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2">
          <DollarSign className="size-4 text-primary shrink-0" />
          <div>
            <span className="font-medium text-foreground">{t("audit.salesRevenueTitle")}: </span>
            <span className="text-muted-foreground">
              {formatUsd(summary.totalRevenueCents)} {t("audit.salesRevenueDesc")}
            </span>
          </div>
        </div>
        {summary.simulatedRevenueCents > 0 && (
          <Badge
            variant="outline"
            className="border-amber-500/40 text-amber-600 bg-amber-500/5 text-[11px]"
          >
            {t("audit.simulationNotice")}: {formatUsd(summary.simulatedRevenueCents)}
          </Badge>
        )}
      </div>

      {/* View Selector Tabs */}
      <div className="flex items-center gap-1 border-b pb-2 text-xs font-medium">
        <button
          type="button"
          onClick={() => setViewTab("overview")}
          className={`px-3 py-1.5 rounded-md transition-colors ${
            viewTab === "overview"
              ? "bg-primary text-primary-foreground font-semibold"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          {t("tabs.overview")}
        </button>
        <button
          type="button"
          onClick={() => setViewTab("comparison")}
          className={`px-3 py-1.5 rounded-md transition-colors ${
            viewTab === "comparison"
              ? "bg-primary text-primary-foreground font-semibold"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          {t("tabs.comparison")}
        </button>
        <button
          type="button"
          onClick={() => setViewTab("dre")}
          className={`px-3 py-1.5 rounded-md transition-colors ${
            viewTab === "dre"
              ? "bg-primary text-primary-foreground font-semibold"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          {t("tabs.dre")}
        </button>
        <button
          type="button"
          onClick={() => setViewTab("cashflow")}
          className={`px-3 py-1.5 rounded-md transition-colors ${
            viewTab === "cashflow"
              ? "bg-primary text-primary-foreground font-semibold"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          {t("tabs.cashflow")}
        </button>
        <button
          type="button"
          onClick={() => setViewTab("payables")}
          className={`px-3 py-1.5 rounded-md transition-colors ${
            viewTab === "payables"
              ? "bg-primary text-primary-foreground font-semibold"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          {t("tabs.payables")}
        </button>
        <button
          type="button"
          onClick={() => setViewTab("reports")}
          className={`px-3 py-1.5 rounded-md transition-colors ${
            viewTab === "reports"
              ? "bg-primary text-primary-foreground font-semibold"
              : "text-muted-foreground hover:bg-muted"
          }`}
        >
          {t("tabs.reports")}
        </button>
      </div>

      {/* Reports & Exports View */}
      {viewTab === "reports" && (
        <FinanceReports
          orgId={org.id}
          restaurantName={org.name}
          locations={org.locations.map((l) => ({ id: l.id, name: l.name }))}
          currentLocationId={locationId}
          expenses={expenses}
          orders={orders}
          productMargins={productMargins}
          storeComparisons={storeComparison.stores}
        />
      )}

      {/* Multi-Store Comparison View */}
      {viewTab === "comparison" && (
        <div className="space-y-6">
          <Panel title={t("comparison.title")} subtitle={t("comparison.subtitle")}>
            {/* Store Selection Filters */}
            <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-medium text-muted-foreground">
                  {t("comparison.filterStores")}:
                </span>
                {org.locations.map((loc) => {
                  const isChecked = selectedLocationIds.includes(loc.id);
                  return (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => {
                        setSelectedLocationIds((prev) =>
                          prev.includes(loc.id)
                            ? prev.filter((id) => id !== loc.id)
                            : [...prev, loc.id],
                        );
                      }}
                      className={`text-xs px-2.5 py-1 rounded-md border transition-colors ${
                        isChecked
                          ? "bg-primary text-primary-foreground border-primary font-medium shadow-xs"
                          : "bg-card text-muted-foreground border-border hover:bg-muted"
                      }`}
                    >
                      {loc.name}
                    </button>
                  );
                })}
              </div>
              <div className="text-xs text-muted-foreground">
                <span>
                  {storeComparison.stores.length} {t("comparison.storesAnalyzed")}
                </span>
              </div>
            </div>

            {/* Benchmarks Header Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 pb-2">
              <div className="rounded-lg border bg-muted/10 p-3.5">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t("comparison.topRevenueStore")}
                </p>
                <p className="text-lg font-bold mt-1 text-foreground">
                  {storeComparison.topRevenueStoreName}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Total: {formatUsd(storeComparison.benchmarkTotalGrossRevenueCents)}
                </p>
              </div>
              <div className="rounded-lg border bg-emerald-500/5 border-emerald-500/20 p-3.5">
                <p className="text-[11px] font-medium uppercase tracking-wider text-emerald-600">
                  {t("comparison.topMarginStore")}
                </p>
                <p className="text-lg font-bold mt-1 text-emerald-600">
                  {storeComparison.topMarginStoreName}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Benchmark Avg: {storeComparison.benchmarkAvgMarginPct.toFixed(1)}%
                </p>
              </div>
              <div className="rounded-lg border bg-amber-500/5 border-amber-500/20 p-3.5">
                <p className="text-[11px] font-medium uppercase tracking-wider text-amber-600">
                  {t("comparison.highestExpenseStore")}
                </p>
                <p className="text-lg font-bold mt-1 text-foreground">
                  {storeComparison.highestExpenseStoreName}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Total Net: {formatUsd(storeComparison.benchmarkTotalNetProfitCents)}
                </p>
              </div>
            </div>

            {/* Comparison Chart */}
            <div className="h-[260px] w-full pt-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={storeComparison.stores}
                  margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                >
                  <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="locationName"
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                    tickFormatter={(v) => `$${v / 100000}k`}
                  />
                  <Tooltip
                    contentStyle={{
                      background: "var(--popover)",
                      border: "1px solid var(--border)",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(val: number) => [formatUsd(val), "USD"]}
                  />
                  <Bar
                    dataKey="grossRevenueCents"
                    fill="var(--primary)"
                    radius={[4, 4, 0, 0]}
                    name="Gross Revenue"
                  />
                  <Bar
                    dataKey="estimatedNetProfitCents"
                    fill="#10b981"
                    radius={[4, 4, 0, 0]}
                    name="Net Profit"
                  />
                  <Bar
                    dataKey="operatingExpensesCents"
                    fill="#ef4444"
                    radius={[4, 4, 0, 0]}
                    name="OpEx"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Comparison Table */}
            <div className="mt-6 overflow-x-auto rounded-md border">
              <table className="w-full text-left text-xs">
                <thead className="bg-muted/50 border-b text-muted-foreground uppercase text-[10px] tracking-wider">
                  <tr>
                    <th className="p-3">{t("comparison.store")}</th>
                    <th className="p-3 text-center">{t("comparison.rank")}</th>
                    <th className="p-3 text-right">{t("comparison.orders")}</th>
                    <th className="p-3 text-right">{t("comparison.ticket")}</th>
                    <th className="p-3 text-right">{t("comparison.grossRevenue")}</th>
                    <th className="p-3 text-right">{t("comparison.cogs")}</th>
                    <th className="p-3 text-right">{t("comparison.opEx")}</th>
                    <th className="p-3 text-right">{t("comparison.netProfit")}</th>
                    <th className="p-3 text-right">{t("comparison.netMargin")}</th>
                    <th className="p-3">{t("comparison.status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {storeComparison.stores.map((s) => (
                    <tr key={s.locationId} className="hover:bg-muted/30 transition-colors">
                      <td className="p-3 font-semibold text-foreground">
                        <div className="flex items-center gap-1.5">
                          <span>{s.locationName}</span>
                          {s.isBestPerformer && (
                            <Badge variant="default" className="text-[9px] bg-emerald-600">
                              {t("comparison.topPerformer")}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="p-3 text-center tabular font-semibold text-muted-foreground">
                        #{s.netProfitRank}
                      </td>
                      <td className="p-3 text-right tabular">{s.orderCount}</td>
                      <td className="p-3 text-right tabular">{formatUsd(s.averageTicketCents)}</td>
                      <td className="p-3 text-right tabular font-medium text-foreground">
                        {formatUsd(s.grossRevenueCents)}
                      </td>
                      <td className="p-3 text-right tabular text-muted-foreground">
                        {formatUsd(s.cogsCents)} ({s.cogsPct.toFixed(0)}%)
                      </td>
                      <td className="p-3 text-right tabular text-destructive">
                        {formatUsd(s.operatingExpensesCents)}
                      </td>
                      <td className="p-3 text-right tabular font-bold text-foreground">
                        {formatUsd(s.estimatedNetProfitCents)}
                      </td>
                      <td className="p-3 text-right tabular font-bold">
                        <span
                          className={s.netMarginPct < 10 ? "text-amber-600" : "text-emerald-600"}
                        >
                          {s.netMarginPct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="p-3">
                        {s.status === "realized" ? (
                          <Badge
                            variant="secondary"
                            className="text-emerald-600 bg-emerald-500/10 text-[10px]"
                          >
                            {t("comparison.statusRealized")}
                          </Badge>
                        ) : s.status === "simulated" ? (
                          <Badge
                            variant="outline"
                            className="border-amber-500 text-amber-600 text-[10px]"
                          >
                            {t("comparison.statusSimulated")}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-muted-foreground text-[10px]">
                            {t("comparison.statusEmpty")}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </div>
      )}

      {/* DRE & Profitability View */}
      {viewTab === "dre" && (
        <div className="space-y-6">
          <Panel title={t("dre.title")} subtitle={t("dre.subtitle")}>
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="lg:col-span-2 space-y-2 rounded-lg border p-4 bg-muted/10 font-mono text-xs">
                <div className="flex justify-between py-1.5 border-b font-semibold text-sm text-foreground">
                  <span>{t("dre.grossRevenue")}</span>
                  <span>{formatUsd(dreStatement.grossRevenueCents)}</span>
                </div>
                <div className="flex justify-between py-1 text-muted-foreground">
                  <span className="pl-4">{t("dre.discounts")}</span>
                  <span className="text-destructive">
                    -{formatUsd(dreStatement.discountsCents)}
                  </span>
                </div>
                <div className="flex justify-between py-1 text-muted-foreground">
                  <span className="pl-4">{t("dre.taxes")}</span>
                  <span className="text-destructive">-{formatUsd(dreStatement.taxesCents)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-t border-b font-semibold text-foreground bg-muted/30 px-2 rounded">
                  <span>{t("dre.netRevenue")}</span>
                  <span>{formatUsd(dreStatement.netRevenueCents)}</span>
                </div>
                <div className="flex justify-between py-1 text-muted-foreground">
                  <span className="pl-4">{t("dre.cogs")}</span>
                  <span className="text-destructive">-{formatUsd(dreStatement.cogsCents)}</span>
                </div>
                <div className="flex justify-between py-1.5 border-t border-b font-semibold text-emerald-600 bg-emerald-500/10 px-2 rounded">
                  <span>
                    {t("dre.grossProfit")} ({dreStatement.grossMarginPct.toFixed(1)}%)
                  </span>
                  <span>{formatUsd(dreStatement.grossProfitCents)}</span>
                </div>
                <div className="flex justify-between py-1 text-muted-foreground">
                  <span className="pl-4">{t("dre.operatingExpenses")}</span>
                  <span className="text-destructive">
                    -{formatUsd(dreStatement.operatingExpensesCents)}
                  </span>
                </div>
                <div className="flex justify-between py-1 text-[11px] text-muted-foreground pl-8">
                  <span>• {t("dre.fixedExpenses")}</span>
                  <span>{formatUsd(dreStatement.fixedExpensesCents)}</span>
                </div>
                <div className="flex justify-between py-1 text-[11px] text-muted-foreground pl-8">
                  <span>• {t("dre.variableExpenses")}</span>
                  <span>{formatUsd(dreStatement.variableExpensesCents)}</span>
                </div>
                <div className="flex justify-between py-2 border-t font-bold text-base text-primary bg-primary/10 px-2 rounded mt-2">
                  <span>
                    {t("dre.netProfit")} ({dreStatement.netMarginPct.toFixed(1)}%)
                  </span>
                  <span>{formatUsd(dreStatement.estimatedNetProfitCents)}</span>
                </div>
              </div>

              <div className="space-y-4">
                <div className="rounded-lg border p-4 bg-card">
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                    {t("dre.categoryMarginsTitle")}
                  </h4>
                  <div className="space-y-3">
                    {categoryMargins.map((cm) => (
                      <div key={cm.category} className="space-y-1 text-xs">
                        <div className="flex justify-between font-medium">
                          <span>{cm.category}</span>
                          <span className="tabular text-muted-foreground">
                            {formatUsd(cm.grossProfitCents)} ({cm.grossMarginPct.toFixed(0)}%)
                          </span>
                        </div>
                        <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-emerald-500 rounded-full"
                            style={{ width: `${Math.min(100, Math.max(0, cm.grossMarginPct))}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 space-y-3">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                {t("dre.productMarginsTitle")}
              </h4>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-left text-xs">
                  <thead className="bg-muted/50 border-b text-muted-foreground uppercase text-[10px] tracking-wider">
                    <tr>
                      <th className="p-3">Item</th>
                      <th className="p-3">Category</th>
                      <th className="p-3 text-right">Units Sold</th>
                      <th className="p-3 text-right">Revenue</th>
                      <th className="p-3 text-right">COGS</th>
                      <th className="p-3 text-right">Gross Profit</th>
                      <th className="p-3 text-right">Margin %</th>
                      <th className="p-3">Health</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {productMargins.map((pm) => (
                      <tr key={pm.productId} className="hover:bg-muted/30 transition-colors">
                        <td className="p-3 font-medium text-foreground">{pm.productName}</td>
                        <td className="p-3 text-muted-foreground">{pm.category}</td>
                        <td className="p-3 text-right tabular">{pm.unitsSold}</td>
                        <td className="p-3 text-right tabular">{formatUsd(pm.revenueCents)}</td>
                        <td className="p-3 text-right tabular text-destructive">
                          {formatUsd(pm.cogsCents)}
                        </td>
                        <td className="p-3 text-right tabular font-bold text-foreground">
                          {formatUsd(pm.grossProfitCents)}
                        </td>
                        <td className="p-3 text-right tabular font-bold">
                          {pm.grossMarginPct.toFixed(1)}%
                        </td>
                        <td className="p-3">
                          {pm.hasHighCostAlert ? (
                            <Badge variant="destructive" className="text-[10px]">
                              {t("dre.alertHighCogs")}
                            </Badge>
                          ) : pm.hasLowMarginAlert ? (
                            <Badge
                              variant="outline"
                              className="border-amber-500 text-amber-600 text-[10px]"
                            >
                              {t("dre.alertLowMargin")}
                            </Badge>
                          ) : (
                            <Badge
                              variant="secondary"
                              className="text-emerald-600 bg-emerald-500/10 text-[10px]"
                            >
                              {t("dre.healthy")}
                            </Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </Panel>
        </div>
      )}

      {/* Cash Flow Special Section when selected */}
      {viewTab === "cashflow" && (
        <Panel
          title={t("cashflow.title")}
          subtitle={t("cashflow.subtitle")}
          action={
            <div className="flex items-center gap-1 rounded-lg border bg-muted/30 p-0.5 text-xs">
              {(["daily", "weekly", "monthly"] as CashFlowGranularity[]).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setCfGranularity(g)}
                  className={`px-2 py-1 rounded capitalize font-medium transition-colors ${
                    cfGranularity === g
                      ? "bg-background shadow-xs text-foreground font-semibold"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t(`cashflow.${g}`)}
                </button>
              ))}
            </div>
          }
        >
          <div className="grid grid-cols-2 gap-3 pb-4 sm:grid-cols-4">
            <div className="rounded-lg border bg-muted/10 p-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                {t("cashflow.openingBalance")}
              </p>
              <p className="tabular text-lg font-bold mt-1">
                {formatUsd(cashFlowTimeline.initialOpeningCents)}
              </p>
            </div>
            <div className="rounded-lg border bg-emerald-500/5 border-emerald-500/20 p-3">
              <p className="text-[11px] uppercase tracking-wider text-emerald-600 font-medium">
                {t("cashflow.inflows")}
              </p>
              <p className="tabular text-lg font-bold text-emerald-600 mt-1">
                +{formatUsd(cashFlowTimeline.totalInflowCents)}
              </p>
            </div>
            <div className="rounded-lg border bg-destructive/5 border-destructive/20 p-3">
              <p className="text-[11px] uppercase tracking-wider text-destructive font-medium">
                {t("cashflow.outflows")}
              </p>
              <p className="tabular text-lg font-bold text-destructive mt-1">
                -{formatUsd(cashFlowTimeline.totalOutflowCents)}
              </p>
            </div>
            <div className="rounded-lg border bg-primary/5 border-primary/20 p-3">
              <p className="text-[11px] uppercase tracking-wider text-primary font-medium">
                {t("cashflow.closingBalance")}
              </p>
              <p className="tabular text-lg font-bold text-primary mt-1">
                {formatUsd(cashFlowTimeline.closingCashCents)}
              </p>
            </div>
          </div>

          <div className="h-[240px] w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={cashFlowTimeline.buckets}
                margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
              >
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickFormatter={(v) => `$${v / 100000}k`}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(val: number) => [formatUsd(val), "USD"]}
                />
                <Bar dataKey="inflowCents" fill="#10b981" radius={[4, 4, 0, 0]} name="Inflow (+)" />
                <Bar
                  dataKey="outflowCents"
                  fill="#ef4444"
                  radius={[4, 4, 0, 0]}
                  name="Outflow (-)"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      )}

      {/* Monthly Chart and Breakdown */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Panel
          className="lg:col-span-2"
          title={t("charts.trendTitle")}
          subtitle={t("charts.trendSubtitle")}
        >
          <div className="h-[260px] w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyTrend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis
                  dataKey="month"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  tickFormatter={(v) => `$${v / 100000}k`}
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--popover)",
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                  formatter={(val: number) => [formatUsd(val), "USD"]}
                />
                <Bar
                  dataKey="revenueCents"
                  fill="var(--primary)"
                  radius={[4, 4, 0, 0]}
                  name="Revenue"
                />
                <Bar
                  dataKey="expensesCents"
                  fill="var(--destructive)"
                  opacity={0.8}
                  radius={[4, 4, 0, 0]}
                  name="Expenses"
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title={t("charts.breakdownTitle")} subtitle={t("charts.breakdownSubtitle")}>
          <div className="flex flex-col gap-3 py-2">
            {CATEGORIES.map((cat) => {
              const catExpenses = expenses.filter((e) => e.category === cat);
              const totalCents = catExpenses.reduce((s, e) => s + e.amountCents, 0);
              const pct =
                summary.totalExpensesCents > 0
                  ? (totalCents / summary.totalExpensesCents) * 100
                  : 0;
              if (totalCents === 0) return null;
              return (
                <div key={cat} className="flex flex-col gap-1">
                  <div className="flex justify-between text-xs font-medium">
                    <span className="capitalize">{t(`categories.${cat}`)}</span>
                    <span className="tabular text-muted-foreground">
                      {formatUsd(totalCents)} ({pct.toFixed(0)}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </Panel>
      </div>

      {/* Filters & Expense Management Table */}
      <Panel title={t("table.title")} subtitle={t("table.subtitle")}>
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              placeholder={t("table.searchPlaceholder")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 w-56 text-xs"
            />
            <select
              value={categoryFilter}
              onChange={(e) => setCategoryFilter(e.target.value as any)}
              className="h-8 rounded-md border bg-background px-2.5 text-xs text-foreground"
            >
              <option value="all">{t("table.allCategories")}</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {t(`categories.${c}`)}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="h-8 rounded-md border bg-background px-2.5 text-xs text-foreground"
            >
              <option value="all">{t("table.allStatus")}</option>
              <option value="pending">{t("table.pending")}</option>
              <option value="paid">{t("table.paid")}</option>
              <option value="overdue">{t("table.overdue")}</option>
            </select>
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/50 border-b text-muted-foreground uppercase text-[10px] tracking-wider">
              <tr>
                <th className="p-3">{t("table.description")}</th>
                <th className="p-3">{t("table.category")}</th>
                <th className="p-3">{t("table.recurrence")}</th>
                <th className="p-3">{t("table.dueDate")}</th>
                <th className="p-3 text-right">{t("table.amount")}</th>
                <th className="p-3">{t("table.status")}</th>
                {canManage && <th className="p-3 text-right">{t("table.actions")}</th>}
              </tr>
            </thead>
            <tbody className="divide-y">
              {filteredExpenses.map((exp) => (
                <tr key={exp.id} className="hover:bg-muted/30 transition-colors">
                  <td className="p-3">
                    <p className="font-medium text-foreground leading-snug">{exp.description}</p>
                    {exp.supplierName && (
                      <p className="text-[11px] text-muted-foreground">{exp.supplierName}</p>
                    )}
                  </td>
                  <td className="p-3 capitalize">
                    <Badge variant="secondary" className="text-[10px] font-normal">
                      {t(`categories.${exp.category}`)}
                    </Badge>
                  </td>
                  <td className="p-3 capitalize text-muted-foreground">
                    {t(`recurrence.${exp.recurrence}`)}
                  </td>
                  <td className="p-3 tabular font-medium text-muted-foreground">{exp.dueDate}</td>
                  <td className="p-3 text-right tabular font-bold text-foreground">
                    {formatUsd(exp.amountCents)}
                  </td>
                  <td className="p-3">
                    <button
                      type="button"
                      disabled={!canManage}
                      onClick={() => handleToggleStatus(exp)}
                      className="focus:outline-none"
                    >
                      <Badge
                        variant={
                          exp.status === "paid"
                            ? "default"
                            : exp.status === "overdue"
                              ? "destructive"
                              : "outline"
                        }
                        className="capitalize text-[10px] cursor-pointer"
                      >
                        {t(`table.${exp.status}`)}
                      </Badge>
                    </button>
                  </td>
                  {canManage && (
                    <td className="p-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          onClick={() => handleOpenEdit(exp)}
                        >
                          <Edit2 className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 text-destructive hover:bg-destructive/10"
                          onClick={() => setDeleteConfirmId(exp.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
              {filteredExpenses.length === 0 && (
                <tr>
                  <td colSpan={canManage ? 7 : 6} className="p-8 text-center text-muted-foreground">
                    {t("table.empty")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Create / Edit Modal */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingExpense ? t("form.editTitle") : t("form.newTitle")}</DialogTitle>
            <DialogDescription>{t("form.subtitle")}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-2 text-xs">
            <div>
              <label className="font-medium text-foreground">{t("form.description")}</label>
              <Input
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="e.g. Organic Produce weekly delivery"
                className="mt-1 h-8"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-medium text-foreground">{t("form.amount")} (USD)</label>
                <Input
                  type="number"
                  step="0.01"
                  value={formAmount}
                  onChange={(e) => setFormAmount(e.target.value)}
                  placeholder="0.00"
                  className="mt-1 h-8"
                />
              </div>
              <div>
                <label className="font-medium text-foreground">{t("form.dueDate")}</label>
                <Input
                  type="date"
                  value={formDueDate}
                  onChange={(e) => setFormDueDate(e.target.value)}
                  className="mt-1 h-8"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-medium text-foreground">{t("form.category")}</label>
                <select
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value as ExpenseCategory)}
                  className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-xs"
                >
                  {CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {t(`categories.${cat}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="font-medium text-foreground">{t("form.recurrence")}</label>
                <select
                  value={formRecurrence}
                  onChange={(e) => setFormRecurrence(e.target.value as ExpenseRecurrence)}
                  className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-xs"
                >
                  <option value="fixed">{t("recurrence.fixed")}</option>
                  <option value="variable">{t("recurrence.variable")}</option>
                  <option value="recurring">{t("recurrence.recurring")}</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="font-medium text-foreground">{t("form.supplier")}</label>
                <Input
                  value={formSupplier}
                  onChange={(e) => setFormSupplier(e.target.value)}
                  placeholder="e.g. Sysco Wholesale"
                  className="mt-1 h-8"
                />
              </div>
              <div>
                <label className="font-medium text-foreground">{t("form.status")}</label>
                <select
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value as ExpenseStatus)}
                  className="mt-1 h-8 w-full rounded-md border bg-background px-2 text-xs"
                >
                  <option value="pending">{t("table.pending")}</option>
                  <option value="paid">{t("table.paid")}</option>
                  <option value="overdue">{t("table.overdue")}</option>
                </select>
              </div>
            </div>

            <div>
              <label className="font-medium text-foreground">{t("form.responsible")}</label>
              <Input
                value={formResponsible}
                onChange={(e) => setFormResponsible(e.target.value)}
                placeholder="e.g. Kitchen Lead / Store Manager"
                className="mt-1 h-8"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>
              {t("form.cancel")}
            </Button>
            <Button onClick={handleSaveExpense}>{t("form.save")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <Dialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("deleteConfirm.title")}</DialogTitle>
            <DialogDescription>{t("deleteConfirm.body")}</DialogDescription>
          </DialogHeader>
          <DialogFooter className="mt-4 flex gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              {t("form.cancel")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirmId && handleDeleteExpense(deleteConfirmId)}
            >
              {t("deleteConfirm.action")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
