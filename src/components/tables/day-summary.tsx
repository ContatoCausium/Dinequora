import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { fmtMoneyCents, fmtNumber } from "@/lib/format";
import { fetchDiningDaySummary } from "@/lib/operational.functions";

/**
 * The store's day so far on the floor: checks closed, what was received and the tips, by the server of
 * each table. Tips are owed to the staff (never revenue), so this is where a manager sees them.
 */
export function DaySummaryPanel({ orgId, storeId }: { orgId: string; storeId: string }) {
  const { t, i18n } = useTranslation("tables");
  const money = (c: number) => fmtMoneyCents(c, i18n.language);
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
      </p>
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
    </section>
  );
}
