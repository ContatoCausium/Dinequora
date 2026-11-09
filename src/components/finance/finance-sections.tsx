import { useMemo, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
  BarChart3,
  CalendarClock,
  CheckCircle2,
  Edit2,
  Receipt,
  Store as StoreIcon,
  Trash2,
} from "lucide-react";
import { Panel, Segmented } from "@/components/app/page";
import { EmptyState } from "@/components/app/states";
import { StatTile } from "@/components/app/stat-tile";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  effectiveStatus,
  type ExpenseStatusView,
  type ExpenseSummary,
} from "@/lib/expense-metrics";
import { EXPENSE_CATEGORIES, type Expense, type ExpenseCategory } from "@/lib/finance-service";
import { fmtDate, fmtMoneyCents, fmtPercent } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ChartLegend, MoneyChart, RankedBars, type Series } from "./finance-charts";
import {
  SERIES,
  filterExpenses,
  groupExpenses,
  sortExpenses,
  type ExpenseFilters,
  type MonthPoint,
  type StoreResult,
} from "./finance-model";

/** Shared row actions and display context passed down from the page. */
export interface ExpenseActions {
  canManage: boolean;
  busyId: string | null;
  showStore: boolean;
  storeName: (locationId: string) => string;
  onMarkPaid: (e: Expense) => void;
  onEdit: (e: Expense) => void;
  onDelete: (e: Expense) => void;
}

const STATUS_VARIANT: Record<ExpenseStatusView, "success" | "neutral" | "danger"> = {
  paid: "success",
  pending: "neutral",
  overdue: "danger",
};

export function StatusBadge({ status }: { status: ExpenseStatusView }) {
  const { t } = useTranslation("finance");
  return (
    <Badge variant={STATUS_VARIANT[status]} className="whitespace-nowrap text-[11px]">
      {t(`status.${status}`)}
    </Badge>
  );
}

const longDate = { year: "numeric", month: "short", day: "numeric" } as const;
const monthLabel = (month: string, lng: string) =>
  fmtDate(`${month}-01`, lng, { month: "short", year: "numeric" });

/* ───────────────────────────── Overview ───────────────────────────── */

export function TrendPanel({
  trend,
  className,
}: {
  trend: MonthPoint[];
  className?: string | undefined;
}) {
  const { t, i18n } = useTranslation("finance");
  const lng = i18n.language;
  const series: Series[] = [
    { key: "revenueCents", label: t("trend.revenue"), color: SERIES[0]! },
    { key: "cogsCents", label: t("trend.cogs"), color: SERIES[1]! },
    { key: "expensesCents", label: t("trend.expenses"), color: SERIES[2]! },
    { key: "resultCents", label: t("trend.result"), color: SERIES[3]!, kind: "line" },
  ];
  return (
    <Panel className={className ?? ""} title={t("trend.title")} subtitle={t("trend.subtitle")}>
      {trend.length === 0 ? (
        <EmptyState
          icon={<BarChart3 className="size-5" />}
          title={t("trend.emptyTitle")}
          body={t("trend.emptyBody")}
        />
      ) : (
        <>
          <MoneyChart
            data={trend.map((p) => ({ ...p }))}
            xKey="month"
            series={series}
            lng={lng}
            formatX={(m) => monthLabel(m, lng)}
            ariaLabel={t("trend.title")}
          />
          <ChartLegend series={series} />
          {trend.length === 1 && trend[0] && (
            <p className="mt-3 text-xs text-muted-foreground">
              {t("trend.singleMonth", { month: monthLabel(trend[0].month, lng) })}
            </p>
          )}
        </>
      )}
    </Panel>
  );
}

export function CategoryBreakdownPanel({ summary }: { summary: ExpenseSummary }) {
  const { t, i18n } = useTranslation("finance");
  const lng = i18n.language;
  const total = summary.totalCents;
  return (
    <Panel title={t("breakdown.title")} subtitle={t("breakdown.subtitle")}>
      {summary.byCategory.length === 0 ? (
        <EmptyState
          icon={<Receipt className="size-5" />}
          title={t("breakdown.emptyTitle")}
          body={t("breakdown.emptyBody")}
        />
      ) : (
        <RankedBars
          lng={lng}
          rows={summary.byCategory.map((c) => ({
            key: c.category,
            label: t(`categories.${c.category}`),
            cents: c.cents,
            share: total > 0 ? c.cents / total : 0,
            meta: total > 0 ? fmtPercent(c.cents / total, lng) : undefined,
          }))}
        />
      )}
    </Panel>
  );
}

export function BillListPanel({
  title,
  subtitle,
  empty,
  bills,
  today,
  actions,
}: {
  title: string;
  subtitle: string;
  empty: string;
  bills: Expense[];
  today: string;
  actions: ExpenseActions;
}) {
  const { t, i18n } = useTranslation("finance");
  const lng = i18n.language;
  return (
    <Panel title={title} subtitle={subtitle} bodyClassName="p-0">
      {bills.length === 0 ? (
        <p className="px-5 py-6 text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y">
          {bills.map((b) => (
            <li key={b.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{b.description}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {[
                    actions.showStore ? actions.storeName(b.locationId) : null,
                    t(`categories.${b.category}`),
                    b.supplierName || null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="tabular text-sm font-medium text-foreground">
                  {fmtMoneyCents(b.amountCents, lng)}
                </p>
                <p className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
                  {effectiveStatus(b, today) === "overdue" && <StatusBadge status="overdue" />}
                  {t("bills.due", { date: fmtDate(b.dueDate, lng, longDate) })}
                </p>
              </div>
              {actions.canManage && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={actions.busyId === b.id}
                  aria-busy={actions.busyId === b.id}
                  aria-label={t("bills.markPaidAria", { description: b.description })}
                  onClick={() => actions.onMarkPaid(b)}
                >
                  <CheckCircle2 />
                  <span className="hidden sm:inline">{t("bills.markPaid")}</span>
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/* ───────────────────────────── Expenses ───────────────────────────── */

type GroupView = "list" | "store" | "category";

export function ExpensesPanel({
  expenses,
  stores,
  today,
  actions,
  onCreate,
}: {
  expenses: Expense[];
  stores: { id: string; name: string }[];
  today: string;
  actions: ExpenseActions;
  onCreate?: (() => void) | undefined;
}) {
  const { t, i18n } = useTranslation("finance");
  const lng = i18n.language;
  const [filters, setFilters] = useState<ExpenseFilters>({
    status: "all",
    category: "all",
    locationId: "all",
    recurrence: "all",
    search: "",
  });
  const [viewChoice, setView] = useState<GroupView>("list");
  // "By store" only exists while several stores are shown.
  const view: GroupView = viewChoice === "store" && !actions.showStore ? "list" : viewChoice;
  const set = <K extends keyof ExpenseFilters>(k: K, v: ExpenseFilters[K]) =>
    setFilters((f) => ({ ...f, [k]: v }));

  const filtered = useMemo(
    () => sortExpenses(filterExpenses(expenses, filters, today), today),
    [expenses, filters, today],
  );
  const groups = useMemo(
    () => (view === "list" ? [] : groupExpenses(filtered, view, today)),
    [filtered, view, today],
  );
  const filtersActive =
    filters.status !== "all" ||
    filters.category !== "all" ||
    filters.locationId !== "all" ||
    filters.recurrence !== "all" ||
    filters.search.trim() !== "";
  const totalCents = filtered.filter((e) => !e.isSimulation).reduce((s, e) => s + e.amountCents, 0);
  // Show legacy "utilities" as a filter only when records still use it.
  const categories = EXPENSE_CATEGORIES.filter(
    (c) => c !== "utilities" || expenses.some((e) => e.category === "utilities"),
  );
  const selectClass = "h-9 rounded-md border bg-background px-2.5 text-xs text-foreground";
  const viewOptions: { value: GroupView; label: string }[] = [
    { value: "list", label: t("table.viewList") },
    ...(actions.showStore ? [{ value: "store" as const, label: t("table.viewByStore") }] : []),
    { value: "category", label: t("table.viewByCategory") },
  ];

  if (expenses.length === 0) {
    return (
      <Panel title={t("table.title")} subtitle={t("table.subtitle")}>
        <EmptyState
          icon={<Receipt className="size-5" />}
          title={t("table.emptyTitle")}
          body={t("table.emptyBody")}
          action={
            onCreate ? (
              <Button size="sm" onClick={onCreate}>
                {t("newExpense")}
              </Button>
            ) : undefined
          }
        />
      </Panel>
    );
  }

  return (
    <Panel
      title={t("table.title")}
      subtitle={t("table.subtitle")}
      action={
        <Segmented<GroupView>
          label={t("table.viewLabel")}
          value={view}
          onChange={setView}
          options={viewOptions}
        />
      }
    >
      <div className="flex flex-wrap items-center gap-2 pb-4">
        <Input
          aria-label={t("table.searchLabel")}
          placeholder={t("table.searchPlaceholder")}
          value={filters.search}
          onChange={(e) => set("search", e.target.value)}
          className="h-9 w-full text-xs sm:w-64"
        />
        <select
          aria-label={t("table.statusFilter")}
          value={filters.status}
          onChange={(e) => set("status", e.target.value as ExpenseFilters["status"])}
          className={selectClass}
        >
          <option value="all">{t("table.allStatuses")}</option>
          <option value="overdue">{t("status.overdue")}</option>
          <option value="pending">{t("status.pending")}</option>
          <option value="paid">{t("status.paid")}</option>
        </select>
        <select
          aria-label={t("table.categoryFilter")}
          value={filters.category}
          onChange={(e) => set("category", e.target.value as ExpenseCategory | "all")}
          className={selectClass}
        >
          <option value="all">{t("table.allCategories")}</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {t(`categories.${c}`)}
            </option>
          ))}
        </select>
        {actions.showStore && (
          <select
            aria-label={t("table.storeFilter")}
            value={filters.locationId}
            onChange={(e) => set("locationId", e.target.value)}
            className={selectClass}
          >
            <option value="all">{t("table.allStores")}</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        )}
        <select
          aria-label={t("table.recurrenceFilter")}
          value={filters.recurrence}
          onChange={(e) => set("recurrence", e.target.value as ExpenseFilters["recurrence"])}
          className={selectClass}
        >
          <option value="all">{t("table.allRecurrences")}</option>
          <option value="fixed">{t("recurrence.fixed")}</option>
          <option value="variable">{t("recurrence.variable")}</option>
          <option value="recurring">{t("recurrence.recurring")}</option>
        </select>
        {filtersActive && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              setFilters({
                status: "all",
                category: "all",
                locationId: "all",
                recurrence: "all",
                search: "",
              })
            }
          >
            {t("table.clearFilters")}
          </Button>
        )}
        <span className="ml-auto text-xs text-muted-foreground">
          {t("table.count", { count: filtered.length, total: fmtMoneyCents(totalCents, lng) })}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="rounded-md border px-4 py-8 text-center text-sm text-muted-foreground">
          {t("table.emptyFiltered")}
        </p>
      ) : view === "list" ? (
        <ExpenseTable expenses={filtered} today={today} actions={actions} />
      ) : (
        <GroupTable
          groups={groups}
          label={(key) => (view === "store" ? actions.storeName(key) : t(`categories.${key}`))}
        />
      )}
    </Panel>
  );
}

function ExpenseTable({
  expenses,
  today,
  actions,
}: {
  expenses: Expense[];
  today: string;
  actions: ExpenseActions;
}) {
  const { t, i18n } = useTranslation("finance");
  const lng = i18n.language;
  const th = "p-3 font-medium";
  return (
    <div className="max-h-[640px] overflow-auto rounded-md border">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 z-10 border-b bg-muted text-[11px] text-muted-foreground">
          <tr>
            <th className={th}>{t("table.description")}</th>
            {actions.showStore && <th className={th}>{t("table.store")}</th>}
            <th className={th}>{t("table.category")}</th>
            <th className={th}>{t("table.recurrence")}</th>
            <th className={th}>{t("table.dueDate")}</th>
            <th className={cn(th, "text-right")}>{t("table.amount")}</th>
            <th className={th}>{t("table.status")}</th>
            {actions.canManage && (
              <th className={cn(th, "text-right")}>
                <span className="sr-only">{t("table.actions")}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y">
          {expenses.map((exp) => {
            const status = effectiveStatus(exp, today);
            const busy = actions.busyId === exp.id;
            return (
              <tr key={exp.id} className="transition-colors hover:bg-muted/40">
                <td className="p-3">
                  <p className="font-medium leading-snug text-foreground">{exp.description}</p>
                  {exp.supplierName && (
                    <p className="text-[11px] text-muted-foreground">{exp.supplierName}</p>
                  )}
                </td>
                {actions.showStore && (
                  <td className="whitespace-nowrap p-3 text-muted-foreground">
                    {actions.storeName(exp.locationId)}
                  </td>
                )}
                <td className="p-3 text-muted-foreground">{t(`categories.${exp.category}`)}</td>
                <td className="p-3 text-muted-foreground">{t(`recurrence.${exp.recurrence}`)}</td>
                <td className="tabular whitespace-nowrap p-3 text-muted-foreground">
                  {fmtDate(exp.dueDate, lng, longDate)}
                </td>
                <td className="tabular whitespace-nowrap p-3 text-right font-medium text-foreground">
                  {fmtMoneyCents(exp.amountCents, lng)}
                </td>
                <td className="p-3">
                  <StatusBadge status={status} />
                </td>
                {actions.canManage && (
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-0.5">
                      {status !== "paid" && (
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={busy}
                          aria-busy={busy}
                          aria-label={t("bills.markPaidAria", { description: exp.description })}
                          title={t("bills.markPaid")}
                          onClick={() => actions.onMarkPaid(exp)}
                        >
                          <CheckCircle2 />
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={busy}
                        aria-label={t("table.edit", { description: exp.description })}
                        onClick={() => actions.onEdit(exp)}
                      >
                        <Edit2 />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        disabled={busy}
                        aria-label={t("table.delete", { description: exp.description })}
                        onClick={() => actions.onDelete(exp)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function GroupTable({
  groups,
  label,
}: {
  groups: ReturnType<typeof groupExpenses>;
  label: (key: string) => string;
}) {
  const { t, i18n } = useTranslation("finance");
  const lng = i18n.language;
  const max = Math.max(1, ...groups.map((g) => g.totalCents));
  const th = "p-3 font-medium";
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-left text-xs">
        <thead className="border-b bg-muted text-[11px] text-muted-foreground">
          <tr>
            <th className={th}>{t("table.groupName")}</th>
            <th className={cn(th, "text-right")}>{t("table.groupCount")}</th>
            <th className={cn(th, "text-right")}>{t("table.groupTotal")}</th>
            <th className={cn(th, "text-right")}>{t("table.groupOpen")}</th>
            <th className={cn(th, "text-right")}>{t("table.groupOverdue")}</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {groups.map((g) => (
            <tr key={g.key}>
              <td className="p-3">
                <p className="font-medium text-foreground">{label(g.key)}</p>
                <div
                  className="mt-1.5 h-1 w-full max-w-[220px] overflow-hidden rounded-full bg-muted"
                  aria-hidden
                >
                  <div
                    className="h-full rounded-full bg-chart-1"
                    style={{ width: `${(g.totalCents / max) * 100}%` }}
                  />
                </div>
              </td>
              <td className="tabular p-3 text-right text-muted-foreground">{g.count}</td>
              <td className="tabular whitespace-nowrap p-3 text-right font-medium text-foreground">
                {fmtMoneyCents(g.totalCents, lng)}
              </td>
              <td className="tabular whitespace-nowrap p-3 text-right text-muted-foreground">
                {fmtMoneyCents(g.openCents, lng)}
              </td>
              <td className="tabular whitespace-nowrap p-3 text-right">
                {g.overdueCents > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-foreground">
                    <span aria-hidden className="size-1.5 rounded-full bg-destructive" />
                    {fmtMoneyCents(g.overdueCents, lng)}
                  </span>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ───────────────────────────── P&L ───────────────────────────── */

function StatementRow({
  label,
  hint,
  value,
  emphasis = false,
  indent = false,
}: {
  label: ReactNode;
  hint?: ReactNode;
  value: string;
  emphasis?: boolean;
  indent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 py-2.5",
        emphasis && "border-t font-semibold",
        indent && "py-1.5 pl-5 text-xs",
      )}
    >
      <div className="min-w-0">
        <p className={cn(indent ? "text-muted-foreground" : "text-sm text-foreground")}>{label}</p>
        {hint && <p className="text-xs font-normal text-muted-foreground">{hint}</p>}
      </div>
      <span
        className={cn(
          "tabular shrink-0",
          indent ? "text-muted-foreground" : "text-sm text-foreground",
          emphasis && "text-[15px]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function PnlPanel({
  revenueCents,
  cogsCents,
  grossProfitCents,
  grossMargin,
  resultCents,
  summary,
}: {
  revenueCents: number;
  cogsCents: number;
  grossProfitCents: number;
  grossMargin: number | null;
  resultCents: number;
  summary: ExpenseSummary;
}) {
  const { t, i18n } = useTranslation("finance");
  const lng = i18n.language;
  const money = (c: number) => fmtMoneyCents(c, lng);
  const empty = revenueCents === 0 && cogsCents === 0 && summary.totalCents === 0;
  return (
    <Panel title={t("pnl.title")} subtitle={t("pnl.subtitle")}>
      {empty ? (
        <EmptyState
          icon={<BarChart3 className="size-5" />}
          title={t("pnl.emptyTitle")}
          body={t("pnl.emptyBody")}
        />
      ) : (
        <div className="mx-auto max-w-3xl">
          <StatementRow
            label={t("pnl.revenue")}
            hint={t("pnl.revenueHint")}
            value={money(revenueCents)}
          />
          <StatementRow label={t("pnl.cogs")} hint={t("pnl.cogsHint")} value={money(-cogsCents)} />
          <StatementRow
            emphasis
            label={t("pnl.grossProfit")}
            hint={
              grossMargin === null
                ? t("pnl.marginUnavailable")
                : t("pnl.grossMargin", { margin: fmtPercent(grossMargin, lng) })
            }
            value={money(grossProfitCents)}
          />
          <StatementRow label={t("pnl.expenses")} value={money(-summary.totalCents)} />
          <StatementRow indent label={t("pnl.personnel")} value={money(-summary.personnelCents)} />
          <StatementRow indent label={t("pnl.operating")} value={money(-summary.operatingCents)} />
          {summary.byCategory.map((c) => (
            <StatementRow
              key={c.category}
              indent
              label={<span className="pl-4">{t(`categories.${c.category}`)}</span>}
              value={money(-c.cents)}
            />
          ))}
          <StatementRow
            emphasis
            label={t("pnl.result")}
            hint={
              revenueCents > 0
                ? t("pnl.resultMargin", { margin: fmtPercent(resultCents / revenueCents, lng) })
                : t("pnl.marginUnavailable")
            }
            value={money(resultCents)}
          />
          <p className="mt-4 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">
            {t("pnl.purchasesNote")}
          </p>
        </div>
      )}
    </Panel>
  );
}

/* ───────────────────────────── Cash flow ───────────────────────────── */

export function CashflowSection({
  revenueCents,
  paidCents,
  last28RevenueCents,
  forecast,
}: {
  revenueCents: number;
  paidCents: number;
  last28RevenueCents: number;
  forecast: { weekStart: string; cents: number }[];
}) {
  const { t, i18n } = useTranslation("finance");
  const lng = i18n.language;
  const projected = forecast.reduce((s, w) => s + w.cents, 0);
  const series: Series[] = [{ key: "cents", label: t("cashflow.amount"), color: SERIES[0]! }];
  const projection = (
    <Badge variant="warning" className="text-[11px]">
      {t("cashflow.projectionBadge")}
    </Badge>
  );
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label={t("cashflow.recordedRevenue")}
          value={fmtMoneyCents(revenueCents, lng)}
          hint={t("cashflow.recordedRevenueHint")}
        />
        <StatTile
          label={t("cashflow.weeklyRevenue")}
          value={fmtMoneyCents(last28RevenueCents, lng)}
          hint={t("cashflow.weeklyRevenueHint", {
            avg: fmtMoneyCents(Math.round(last28RevenueCents / 4), lng),
          })}
        />
        <StatTile
          label={t("cashflow.paidOut")}
          value={fmtMoneyCents(paidCents, lng)}
          hint={t("cashflow.paidOutHint")}
        />
        <StatTile
          label={t("cashflow.projectedOut")}
          value={fmtMoneyCents(projected, lng)}
          hint={t("cashflow.projectedOutHint")}
          tone={projected > 0 ? "warning" : "neutral"}
          icon={<CalendarClock />}
        />
      </div>
      <Panel title={t("cashflow.title")} subtitle={t("cashflow.subtitle")} action={projection}>
        {projected === 0 ? (
          <EmptyState
            icon={<CalendarClock className="size-5" />}
            title={t("cashflow.emptyTitle")}
            body={t("cashflow.emptyBody")}
          />
        ) : (
          <>
            <MoneyChart
              data={forecast.map((w) => ({ ...w }))}
              xKey="weekStart"
              series={series}
              lng={lng}
              formatX={(d) => fmtDate(d, lng)}
              height={220}
              ariaLabel={t("cashflow.title")}
            />
            <div className="mt-4 overflow-x-auto rounded-md border">
              <table className="w-full text-left text-xs">
                <thead className="border-b bg-muted text-[11px] text-muted-foreground">
                  <tr>
                    <th className="p-3 font-medium">{t("cashflow.weekStart")}</th>
                    <th className="p-3 text-right font-medium">{t("cashflow.amount")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {forecast.map((w) => (
                    <tr key={w.weekStart}>
                      <td className="p-3 text-muted-foreground">
                        {t("cashflow.week", { date: fmtDate(w.weekStart, lng, longDate) })}
                      </td>
                      <td className="tabular p-3 text-right font-medium text-foreground">
                        {fmtMoneyCents(w.cents, lng)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{t("cashflow.overdueNote")}</p>
          </>
        )}
      </Panel>
    </div>
  );
}

/* ───────────────────────────── Stores ───────────────────────────── */

export function StoresPanel({ stores }: { stores: StoreResult[] }) {
  const { t, i18n } = useTranslation("finance");
  const lng = i18n.language;
  const money = (c: number) => fmtMoneyCents(c, lng);
  const withData = stores.filter((s) => s.hasData);
  const series: Series[] = [
    { key: "revenueCents", label: t("stores.revenue"), color: SERIES[0]! },
    { key: "cogsCents", label: t("stores.cogs"), color: SERIES[1]! },
    { key: "expensesCents", label: t("stores.expenses"), color: SERIES[2]! },
    { key: "resultCents", label: t("stores.result"), color: SERIES[3]!, kind: "line" },
  ];
  const th = "p-3 font-medium";
  return (
    <Panel title={t("stores.title")} subtitle={t("stores.subtitle")}>
      {withData.length === 0 ? (
        <EmptyState
          icon={<StoreIcon className="size-5" />}
          title={t("stores.emptyTitle")}
          body={t("stores.emptyBody")}
        />
      ) : (
        <>
          <MoneyChart
            data={stores.map((s) => ({
              locationName: s.locationName,
              revenueCents: s.revenueCents,
              cogsCents: s.cogsCents,
              expensesCents: s.expensesCents,
              resultCents: s.resultCents,
            }))}
            xKey="locationName"
            series={series}
            lng={lng}
            formatX={(v) => v}
            ariaLabel={t("stores.title")}
          />
          <ChartLegend series={series} />
          <div className="mt-5 overflow-x-auto rounded-md border">
            <table className="w-full text-left text-xs">
              <thead className="border-b bg-muted text-[11px] text-muted-foreground">
                <tr>
                  <th className={th}>{t("stores.store")}</th>
                  <th className={cn(th, "text-right")}>{t("stores.revenue")}</th>
                  <th className={cn(th, "text-right")}>{t("stores.cogs")}</th>
                  <th className={cn(th, "text-right")}>{t("stores.grossProfit")}</th>
                  <th className={cn(th, "text-right")}>{t("stores.grossMargin")}</th>
                  <th className={cn(th, "text-right")}>{t("stores.expenses")}</th>
                  <th className={cn(th, "text-right")}>{t("stores.personnel")}</th>
                  <th className={cn(th, "text-right")}>{t("stores.result")}</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {stores.map((s) => (
                  <tr key={s.locationId}>
                    <td className="p-3 font-medium text-foreground">
                      <span className="flex items-center gap-2">
                        {s.locationName}
                        {!s.hasData && (
                          <Badge variant="neutral" className="text-[11px]">
                            {t("stores.noData")}
                          </Badge>
                        )}
                      </span>
                    </td>
                    <td className="tabular whitespace-nowrap p-3 text-right">
                      {money(s.revenueCents)}
                    </td>
                    <td className="tabular whitespace-nowrap p-3 text-right text-muted-foreground">
                      {money(s.cogsCents)}
                    </td>
                    <td className="tabular whitespace-nowrap p-3 text-right">
                      {money(s.grossProfitCents)}
                    </td>
                    <td className="tabular whitespace-nowrap p-3 text-right text-muted-foreground">
                      {s.grossMargin === null ? "—" : fmtPercent(s.grossMargin, lng)}
                    </td>
                    <td className="tabular whitespace-nowrap p-3 text-right text-muted-foreground">
                      {money(s.expensesCents)}
                    </td>
                    <td className="tabular whitespace-nowrap p-3 text-right text-muted-foreground">
                      {money(s.personnelCents)}
                    </td>
                    <td className="tabular whitespace-nowrap p-3 text-right font-semibold text-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        {s.hasData && (
                          <span
                            aria-hidden
                            className={cn(
                              "size-1.5 rounded-full",
                              s.resultCents >= 0 ? "bg-success" : "bg-destructive",
                            )}
                          />
                        )}
                        {money(s.resultCents)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}
