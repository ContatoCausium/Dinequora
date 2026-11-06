import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  FileSpreadsheet,
  Download,
  FileText,
  Printer,
  Filter,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { Panel } from "@/components/app/page";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  generateFinancialReport,
  exportReportToCsv,
  exportReportToXmlSpreadsheet,
  triggerFileDownload,
  formatUsd,
  type FinancialReportType,
  type Expense,
  type ProductMarginMetric,
  type StoreFinancialComparison,
} from "@/lib/finance-service";

interface FinanceReportsProps {
  orgId: string;
  restaurantName: string;
  locations: Array<{ id: string; name: string }>;
  currentLocationId: string;
  expenses: Expense[];
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
  productMargins?: ProductMarginMetric[];
  storeComparisons?: StoreFinancialComparison[];
}

export function FinanceReports({
  restaurantName,
  locations,
  currentLocationId,
  expenses,
  orders,
  productMargins = [],
  storeComparisons = [],
}: FinanceReportsProps) {
  const { t } = useTranslation("finance");

  const [reportType, setReportType] = useState<FinancialReportType>("cash_flow");
  const [selectedLocation, setSelectedLocation] = useState<string>(currentLocationId || "all");
  const [selectedDataType, setSelectedDataType] = useState<
    "all" | "realized" | "projected" | "simulated"
  >("all");

  const locationName = useMemo(() => {
    if (selectedLocation === "all") return "All Locations (Consolidated)";
    return locations.find((l) => l.id === selectedLocation)?.name || "Current Location";
  }, [selectedLocation, locations]);

  const report = useMemo(() => {
    return generateFinancialReport({
      filters: {
        reportType,
        locationId: selectedLocation,
        dataType: selectedDataType,
      },
      restaurantName,
      locationName,
      expenses,
      orders,
      productMargins,
      storeComparisons,
    });
  }, [
    reportType,
    selectedLocation,
    selectedDataType,
    restaurantName,
    locationName,
    expenses,
    orders,
    productMargins,
    storeComparisons,
  ]);

  const handleExportCsv = () => {
    const csv = exportReportToCsv(report);
    triggerFileDownload(`${report.reportType}-${Date.now()}.csv`, csv, "text/csv;charset=utf-8;");
    toast.success(t("reports.exportedCsv", "CSV export generated"));
  };

  const handleExportXmlSpreadsheet = () => {
    const xml = exportReportToXmlSpreadsheet(report);
    triggerFileDownload(
      `${report.reportType}-${Date.now()}.xml`,
      xml,
      "application/vnd.ms-excel;charset=utf-8;",
    );
    toast.info(
      t("reports.exportedXmlNote", "Spreadsheet generated in Excel-compatible XML format"),
    );
  };

  const handlePrintPdf = () => {
    if (typeof window !== "undefined") {
      window.print();
    }
  };

  return (
    <div className="space-y-6">
      <Panel
        title={t("reports.title", "Financial Reports & Exports")}
        subtitle={t(
          "reports.subtitle",
          "Download clean operational and executive reports in CSV, Excel XML, or Print/PDF format",
        )}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleExportCsv} className="text-xs h-8">
              <Download className="mr-1.5 size-3.5" />
              {t("reports.exportCsv", "Export CSV")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleExportXmlSpreadsheet}
              className="text-xs h-8"
            >
              <FileSpreadsheet className="mr-1.5 size-3.5" />
              {t("reports.exportExcel", "Export Excel (XML)")}
            </Button>
            <Button size="sm" variant="default" onClick={handlePrintPdf} className="text-xs h-8">
              <Printer className="mr-1.5 size-3.5" />
              {t("reports.exportPdf", "Print / Save PDF")}
            </Button>
          </div>
        }
      >
        {/* Filters bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={reportType}
              onChange={(e) => setReportType(e.target.value as FinancialReportType)}
              className="h-8 rounded-md border bg-background px-2.5 text-xs text-foreground font-medium"
            >
              <option value="cash_flow">
                {t("reports.types.cash_flow", "Cash Flow Activity")}
              </option>
              <option value="revenue">{t("reports.types.revenue", "Revenue & Sales")}</option>
              <option value="expenses">{t("reports.types.expenses", "Operating Expenses")}</option>
              <option value="payables_receivables">
                {t("reports.types.payables", "Accounts Payable")}
              </option>
              <option value="cogs_margins">
                {t("reports.types.margins", "COGS & Product Margins")}
              </option>
              <option value="store_performance">
                {t("reports.types.performance", "Multi-Store Performance")}
              </option>
              <option value="monthly_trends">{t("reports.types.trends", "Monthly Trends")}</option>
            </select>

            <select
              value={selectedLocation}
              onChange={(e) => setSelectedLocation(e.target.value)}
              className="h-8 rounded-md border bg-background px-2.5 text-xs text-foreground"
            >
              <option value="all">{t("reports.allLocations", "All Locations")}</option>
              {locations.map((loc) => (
                <option key={loc.id} value={loc.id}>
                  {loc.name}
                </option>
              ))}
            </select>

            <select
              value={selectedDataType}
              onChange={(e) =>
                setSelectedDataType(
                  e.target.value as "all" | "realized" | "projected" | "simulated",
                )
              }
              className="h-8 rounded-md border bg-background px-2.5 text-xs text-foreground"
            >
              <option value="all">{t("reports.allData", "All Data Types")}</option>
              <option value="realized">{t("reports.onlyRealized", "Only Realized")}</option>
              <option value="projected">{t("reports.onlyProjected", "Only Projected")}</option>
              <option value="simulated">{t("reports.onlySimulated", "Only Simulated")}</option>
            </select>
          </div>

          <div className="text-xs text-muted-foreground">
            <span>
              {report.rows.length} {t("reports.recordsCount", "records found")}
            </span>
          </div>
        </div>

        {/* Executive Header Preview */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-4 pb-2">
          <div className="rounded-lg border bg-muted/10 p-3.5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("reports.periodTotalInflow", "Total Recorded Inflows")}
            </p>
            <p className="text-lg font-bold mt-1 text-emerald-600">
              +{formatUsd(report.totalInflowCents)}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{report.periodLabel}</p>
          </div>
          <div className="rounded-lg border bg-muted/10 p-3.5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
              {t("reports.periodTotalOutflow", "Total Recorded Outflows")}
            </p>
            <p className="text-lg font-bold mt-1 text-destructive">
              -{formatUsd(report.totalOutflowCents)}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">{report.locationName}</p>
          </div>
          <div className="rounded-lg border bg-primary/5 border-primary/20 p-3.5">
            <p className="text-[11px] font-medium uppercase tracking-wider text-primary">
              {t("reports.netBalance", "Net Operating Balance")}
            </p>
            <p className="text-lg font-bold mt-1 text-foreground">
              {formatUsd(report.netBalanceCents)}
            </p>
            <div className="flex items-center gap-2 mt-0.5 text-xs text-muted-foreground">
              <span>Realized: {report.realizedCount}</span>
              <span>•</span>
              <span>Sim: {report.simulatedCount}</span>
            </div>
          </div>
        </div>

        {/* Table Preview */}
        <div className="mt-4 overflow-x-auto rounded-md border">
          <table className="w-full text-left text-xs">
            <thead className="bg-muted/50 border-b text-muted-foreground uppercase text-[10px] tracking-wider">
              <tr>
                <th className="p-3">{t("reports.colDateOrKey", "Date / Key")}</th>
                <th className="p-3">{t("reports.colTitle", "Title / Item")}</th>
                <th className="p-3">{t("reports.colCategory", "Category / Details")}</th>
                <th className="p-3 text-right">{t("reports.colAmount", "Amount (USD)")}</th>
                <th className="p-3">{t("reports.colStatus", "Status")}</th>
                <th className="p-3">{t("reports.colNotes", "Notes")}</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {report.rows.map((row) => (
                <tr key={row.id} className="hover:bg-muted/30 transition-colors">
                  <td className="p-3 tabular font-medium text-muted-foreground">{row.dateOrKey}</td>
                  <td className="p-3 font-semibold text-foreground">{row.title}</td>
                  <td className="p-3 text-muted-foreground">{row.category}</td>
                  <td className="p-3 text-right tabular font-bold">
                    <span
                      className={
                        row.typeKind === "inflow"
                          ? "text-emerald-600"
                          : row.typeKind === "outflow"
                            ? "text-destructive"
                            : "text-foreground"
                      }
                    >
                      {row.formattedAmount}
                    </span>
                  </td>
                  <td className="p-3">
                    <Badge variant="outline" className="text-[10px]">
                      {row.statusBadge}
                    </Badge>
                  </td>
                  <td className="p-3 text-muted-foreground text-[11px]">{row.notes || "-"}</td>
                </tr>
              ))}
              {report.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    {t("reports.emptyRecords", "No financial records match the selected criteria.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}
