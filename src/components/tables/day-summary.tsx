import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { History } from "lucide-react";

import { ClosedChecksDialog } from "@/components/tables/check-history";
import { Button } from "@/components/ui/button";

import { fmtMoneyCents, fmtNumber } from "@/lib/format";
import { fetchDiningDaySummary } from "@/lib/operational.functions";

/**
 * The store's day so far on the floor: checks closed, what was received and the tips, by the server of
 * each table. Tips are owed to the staff (never revenue), so this is where a manager sees them.
 */
export function DaySummaryPanel({ orgId, storeId }: { orgId: string; storeId: string }) {
  const { t, i18n } = useTranslation("tables");
  const money = (c: number) => fmtMoneyCents(c, i18n.language);
  const [listOpen, setListOpen] = useState(false);
  const q = useQuery({
    queryKey: ["dining-day", orgId, storeId],
    queryFn: () => fetchDiningDaySummary({ data: { orgId, locationId: storeId } }),
    refetchInterval: 60_000,
  });
  if (!q.data) return null;
  const d = q.data;
  return (
    <section aria-label={t("day.label")} className="surface px-4 py-3 text-[13px]">
      <p className="flex flex-wrap gap-x-4 gap-y-1">
        <span className="font-semibold">{t("day.title")}</span>
        <span>
          {t("day.closed", {
            count: d.checksClosed,
            formatted: fmtNumber(d.checksClosed, i18n.language),
          })}
        </span>
        <span>{t("day.received", { amount: money(d.receivedCents) })}</span>
        <span>{t("day.tips", { amount: money(d.tipsCents) })}</span>
        {d.checksClosed > 0 && (
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-[13px]"
            onClick={() => setListOpen(true)}
          >
            <History aria-hidden />
            {t("history.closedOpen")}
          </Button>
        )}
      </p>
      {d.byMethod.length > 0 && (
        <ul
          aria-label={t("day.byMethodLabel")}
          className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground"
        >
          {d.byMethod.map((m) => (
            <li key={m.method}>
              {m.tipsCents > 0
                ? t("day.methodWithTips", {
                    method: t(`pay.methods.${m.method}`, { defaultValue: m.method }),
                    amount: money(m.amountCents),
                    tips: money(m.tipsCents),
                  })
                : t("day.method", {
                    method: t(`pay.methods.${m.method}`, { defaultValue: m.method }),
                    amount: money(m.amountCents),
                  })}
            </li>
          ))}
        </ul>
      )}
      {d.byServer.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground">
          {d.byServer.map((s) => (
            <li key={s.serverId}>
              {t("day.serverTips", {
                name: s.name ?? t("check.serverUnknown"),
                amount: money(s.tipsCents),
              })}
            </li>
          ))}
        </ul>
      )}
      <ClosedChecksDialog
        orgId={orgId}
        storeId={storeId}
        open={listOpen}
        onClose={() => setListOpen(false)}
      />
    </section>
  );
}
