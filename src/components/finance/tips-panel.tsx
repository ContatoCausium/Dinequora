import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Download, HandCoins } from "lucide-react";

import { Panel, Segmented } from "@/components/app/page";
import { EmptyState, Skeleton } from "@/components/app/states";
import { downloadCsv } from "@/components/app/charts";
import { Button } from "@/components/ui/button";
import { fmtMoneyCents, fmtNumber } from "@/lib/format";
import { fetchTipsByServer } from "@/lib/operational.functions";

type Days = "7" | "14" | "30";

/**
 * Tips recorded on dining room checks per server (0046, read under the member's RLS), for payroll and tip
 * reporting: cash and non-cash tips apart, with a CSV. Tips belong to the staff and are never revenue.
 */
export function TipsPanel({
  orgId,
  locationId,
  storeName,
}: {
  orgId: string;
  locationId: string;
  storeName: (dbId: string) => string;
}) {
  const { t, i18n } = useTranslation("finance");
  const lng = i18n.language;
  const money = (c: number) => fmtMoneyCents(c, lng);
  const [days, setDays] = useState<Days>("14");
  const q = useQuery({
    queryKey: ["tips-by-server", orgId, locationId, days],
    queryFn: () => fetchTipsByServer({ data: { orgId, locationId, days: Number(days) } }),
    staleTime: 60_000,
  });
  const rows = (q.data ?? []).slice().sort((a, b) => b.tipsCents - a.tipsCents);
  const name = (r: { serverName: string | null }) => r.serverName ?? t("tips.unknownServer");

  return (
    <Panel
      title={t("tips.title")}
      subtitle={t("tips.subtitle")}
      action={
        <div className="flex items-center gap-2">
          <Segmented<Days>
            label={t("tips.daysLabel")}
            value={days}
            onChange={setDays}
            options={(["7", "14", "30"] as const).map((d) => ({
              value: d,
              label: t("tips.days", { count: Number(d) }),
            }))}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(
                `tips-${days}d.csv`,
                [
                  t("tips.cols.server"),
                  t("tips.cols.store"),
                  t("tips.cols.tenders"),
                  t("tips.cols.tips"),
                  t("tips.cols.cash"),
                  t("tips.cols.nonCash"),
                  t("tips.cols.paid"),
                ],
                rows.map((r) => [
                  name(r),
                  storeName(r.locationId),
                  r.tenders,
                  (r.tipsCents / 100).toFixed(2),
                  (r.cashTipsCents / 100).toFixed(2),
                  ((r.tipsCents - r.cashTipsCents) / 100).toFixed(2),
                  (r.paidCents / 100).toFixed(2),
                ]),
              )
            }
          >
            <Download aria-hidden />
            {t("tips.csv")}
          </Button>
        </div>
      }
    >
      {q.isPending ? (
        <Skeleton className="h-28" />
      ) : q.isError ? (
        <p role="alert" className="text-sm text-destructive">
          {t("tips.loadFailed")}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<HandCoins className="size-5" strokeWidth={1.75} />}
          title={t("tips.emptyTitle")}
          body={t("tips.emptyBody")}
        />
      ) : (
        <div className="space-y-3">
          <div
            className="overflow-x-auto rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            tabIndex={0}
            role="region"
            aria-label={t("tips.tableLabel")}
          >
            <table className="data-table">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th scope="col" className="pb-2 font-medium">
                    {t("tips.cols.server")}
                  </th>
                  <th scope="col" className="pb-2 font-medium">
                    {t("tips.cols.store")}
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    {t("tips.cols.tenders")}
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    {t("tips.cols.tips")}
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    {t("tips.cols.cash")}
                  </th>
                  <th scope="col" className="pb-2 text-right font-medium">
                    {t("tips.cols.nonCash")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => (
                  <tr key={`${r.serverId}-${r.locationId}`}>
                    <td className="py-2.5 font-medium">{name(r)}</td>
                    <td className="py-2.5">{storeName(r.locationId)}</td>
                    <td className="tabular py-2.5 text-right">{fmtNumber(r.tenders, lng)}</td>
                    <td className="tabular py-2.5 text-right font-semibold">
                      {money(r.tipsCents)}
                    </td>
                    <td className="tabular py-2.5 text-right">{money(r.cashTipsCents)}</td>
                    <td className="tabular py-2.5 text-right">
                      {money(r.tipsCents - r.cashTipsCents)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">{t("tips.note")}</p>
        </div>
      )}
    </Panel>
  );
}
