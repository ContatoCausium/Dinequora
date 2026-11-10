import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Download, FileSpreadsheet, Printer } from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/app/page";
import { StatTile } from "@/components/app/stat-tile";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fmtDate, fmtMoneyCents, fmtPercent } from "@/lib/format";
import {
  DEFAULT_REPORT_TEXT,
  exportReportToCsv,
  exportReportToXmlSpreadsheet,
  generateFinancialReport,
  triggerFileDownload,
  type Expense,
  type FinancialReportType,
  type ReportFormatters,
  type ReportTextKey,
} from "@/lib/finance-service";
import {
  ledgerForLocation,
  monthlyTrend,
  type LedgerEntry,
  type StoreRef,
  type StoreResult,
} from "./finance-model";

type DataType = "all" | "realized" | "projected" | "simulated";

const REPORT_TYPES: { value: FinancialReportType; label: string }[] = [
  { value: "cash_flow", label: "cash_flow" },
  { value: "revenue", label: "revenue" },
  { value: "expenses", label: "expenses" },
  { value: "payables_receivables", label: "payables" },
  { value: "cogs_margins", label: "margins" },
  { value: "store_performance", label: "performance" },
  { value: "monthly_trends", label: "trends" },
];

interface FinanceReportsProps {
  restaurantName: string;
  locations: StoreRef[];
  currentLocationId: string;
  /** Every readable expense, with the effective status (pending past due ⇒ overdue). */
  expenses: Expense[];
  /** Every readable ledger row (finance_entries). */
  entries: LedgerEntry[];
  orders: Array<{
    id: string;
    totalCents: number;
    discountCents?: number;
    taxCents?: number;
    status: string;
    isSimulated?: boolean;
    createdAt: string;
    locationId?: string;
  }>;
  stores: StoreResult[];
  currentMonth: string;
  /** Store zone used to place each sale in its local month. */
  timeZone?: string | undefined;
}

export function FinanceReports({
  restaurantName,
  locations,
  currentLocationId,
  expenses,
  entries,
  orders,
  stores,
  currentMonth,
  timeZone,
}: FinanceReportsProps) {
  const { t, i18n } = useTranslation("finance");
  const lng = i18n.language;

  const [reportType, setReportType] = useState<FinancialReportType>("cash_flow");
  const [selectedLocation, setSelectedLocation] = useState<string>(currentLocationId || "all");
  const [selectedDataType, setSelectedDataType] = useState<DataType>("all");

  const locationName =
    selectedLocation === "all"
      ? t("reports.allLocationsConsolidated")
      : (locations.find((l) => l.id === selectedLocation)?.name ?? "");

  const report = useMemo(() => {
    const scopedExpenses =
      selectedLocation === "all"
        ? expenses
        : expenses.filter((e) => e.locationId === selectedLocation);
    const scopedEntries = ledgerForLocation(entries, locations, selectedLocation);
    const slugByDbId = new Map(locations.map((l) => [l.dbId, l]));
    const storeName = (id: string) => locations.find((l) => l.id === id)?.name ?? id;
    const formatters: ReportFormatters = {
      text: (key: ReportTextKey, vars) =>
        t(`reports.text.${key}`, { defaultValue: DEFAULT_REPORT_TEXT[key], ...vars }),
      money: (cents) => fmtMoneyCents(cents, lng),
      percent: (ratio) => fmtPercent(ratio, lng),
      category: (c) => t(`categories.${c}`, { defaultValue: c }),
      status: (s) => t(`status.${s}`, { defaultValue: s }),
    };
    return generateFinancialReport({
      filters: { reportType, locationId: selectedLocation, dataType: selectedDataType },
      restaurantName,
      locationName,
      expenses: scopedExpenses,
      orders:
        selectedLocation === "all"
          ? orders
          : orders.filter((o) => o.locationId === selectedLocation),
      ledger: scopedEntries.map((e) => ({
        id: e.id,
        createdAt: e.created_at,
        kind: e.kind,
        amountCents: e.amount_cents,
        locationName: slugByDbId.get(e.location_id)?.name ?? locationName,
      })),
      stores:
        selectedLocation === "all"
          ? stores
          : stores.filter((s) => s.locationId === selectedLocation),
      monthlyTrend: monthlyTrend(scopedEntries, scopedExpenses, currentMonth, timeZone),
      storeName,
      formatters,
    });
  }, [
    reportType,
    selectedLocation,
    selectedDataType,
    restaurantName,
    locationName,
    expenses,
    entries,
    orders,
    stores,
    locations,
    currentMonth,
    timeZone,
    lng,
    t,
  ]);

  const handleExportCsv = () => {
    const csv = exportReportToCsv(report);
    triggerFileDownload(`${report.reportType}-${Date.now()}.csv`, csv, "text/csv;charset=utf-8;");
    toast.success(t("reports.exportedCsv"));
  };

  const handleExportXmlSpreadsheet = () => {
    const xml = exportReportToXmlSpreadsheet(report);
    triggerFileDownload(
      `${report.reportType}-${Date.now()}.xml`,
      xml,
      "application/vnd.ms-excel;charset=utf-8;",
    );
    toast.success(t("reports.exportedXmlNote"));
  };

  const handlePrintPdf = () => {
    if (typeof window !== "undefined") window.print();
  };

  const selectClass = "h-9 rounded-md border bg-background px-2.5 text-xs text-foreground";

  return (
    <Panel
      title={t("reports.title")}
      subtitle={t("reports.subtitle")}
      action={
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={handleExportCsv}>
            <Download />
            {t("reports.exportCsv")}
          </Button>
          <Button size="sm" variant="outline" onClick={handleExportXmlSpreadsheet}>
            <FileSpreadsheet />
            {t("reports.exportExcel")}
          </Button>
          <Button size="sm" variant="outline" onClick={handlePrintPdf}>
            <Printer />
            {t("reports.exportPdf")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={t("reports.reportType")}
            value={reportType}
            onChange={(e) => setReportType(e.target.value as FinancialReportType)}
            className={`${selectClass} font-medium`}
          >
            {REPORT_TYPES.map((r) => (
              <option key={r.value} value={r.value}>
                {t(`reports.types.${r.label}`)}
              </option>
            ))}
          </select>
          {locations.length > 1 && (
            <select
              aria-label={t("reports.locationFilter")}
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className={selectClass}
            >
              <option value="all">{t("reports.allLocations")}</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>
          )}
          <select
            aria-label={t("reports.dataFilter")}
            value={selectedDataType}
            onChange={(e) => setSelectedDataType(e.target.value as DataType)}
            className={selectClass}
          >
            <option value="all">{t("reports.allData")}</option>
            <option value="realized">{t("reports.onlyRealized")}</option>
            <option value="projected">{t("reports.onlyProjected")}</option>
            <option value="simulated">{t("reports.onlySimulated")}</option>
          </select>
        </div>
        <span className="text-xs text-muted-foreground">
          {t("reports.recordsCount", { count: report.rows.length })}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 pt-4 sm:grid-cols-3">
        <StatTile
          label={t("reports.periodTotalInflow")}
          value={fmtMoneyCents(report.totalInflowCents, lng)}
          hint={report.periodLabel}
        />
        <StatTile
          label={t("reports.periodTotalOutflow")}
          value={fmtMoneyCents(report.totalOutflowCents, lng)}
          hint={report.locationName}
        />
        <StatTile
          label={t("reports.netBalance")}
          value={fmtMoneyCents(report.netBalanceCents, lng)}
          hint={t("reports.breakdownCounts", {
            realized: report.realizedCount,
            projected: report.projectedCount,
            simulated: report.simulatedCount,
          })}
        />
      </div>

      <div className="mt-4 max-h-[560px] overflow-auto rounded-md border">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 border-b bg-muted text-[11px] text-muted-foreground">
            <tr>
              <th className="p-3 font-medium">{t("reports.colDateOrKey")}</th>
              <th className="p-3 font-medium">{t("reports.colTitle")}</th>
              {selectedLocation === "all" && (
                <th className="p-3 font-medium">{t("reports.colStore")}</th>
              )}
              <th className="p-3 font-medium">{t("reports.colCategory")}</th>
              <th className="p-3 text-right font-medium">{t("reports.colAmount")}</th>
              <th className="p-3 font-medium">{t("reports.colStatus")}</th>
              <th className="p-3 font-medium">{t("reports.colNotes")}</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {report.rows.map((row) => (
              <tr key={row.id} className="transition-colors hover:bg-muted/40">
                <td className="tabular whitespace-nowrap p-3 text-muted-foreground">
                  {row.isoDate
                    ? fmtDate(row.isoDate, lng, { year: "numeric", month: "short", day: "numeric" })
                    : reportType === "monthly_trends"
                      ? fmtDate(`${row.dateOrKey}-01`, lng, { year: "numeric", month: "long" })
                      : "—"}
                </td>
                <td className="p-3 font-medium text-foreground">{row.title}</td>
                {selectedLocation === "all" && (
                  <td className="p-3 text-muted-foreground">{row.locationName}</td>
                )}
                <td className="p-3 text-muted-foreground">
                  {reportType === "monthly_trends"
                    ? fmtDate(`${row.category}-01`, lng, { year: "numeric", month: "long" })
                    : row.category}
                </td>
                <td className="tabular whitespace-nowrap p-3 text-right font-medium text-foreground">
                  {row.typeKind === "outflow"
                    ? fmtMoneyCents(-row.amountCents, lng)
                    : fmtMoneyCents(row.amountCents, lng)}
                </td>
                <td className="p-3">
                  <Badge variant="neutral" className="text-[11px]">
                    {row.statusBadge}
                  </Badge>
                </td>
                <td className="p-3 text-[11px] text-muted-foreground">{row.notes || "—"}</td>
              </tr>
            ))}
            {report.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="p-8 text-center text-muted-foreground">
                  {t("reports.emptyRecords")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
