import { useTranslation } from "react-i18next";
import { CircleAlert } from "lucide-react";

/**
 * Shown on the kitchen board when more open tickets exist than the board can hold (5,000). The
 * board keeps the OLDEST open tickets (they have waited longest); the notice says how many newer
 * ones are off the screen. Counts are for all stations; with a station filter it also says how
 * many of the tickets on the board belong to that station.
 */
export function KitchenCapNotice({
  openLoaded,
  openTotal,
  truncated,
  stationShown,
}: {
  openLoaded: number;
  openTotal: number;
  truncated: boolean;
  /** Open tickets of the selected station among those on the board; omit for "all stations". */
  stationShown?: number | undefined;
}) {
  const { t } = useTranslation("kds");
  const hidden = openTotal - openLoaded;
  if (!truncated || hidden <= 0) return null;
  return (
    <div
      role="alert"
      className="surface flex items-start gap-2 border-warning/40 px-4 py-2.5 text-sm"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
      <div className="space-y-0.5">
        <p className="font-medium">{t("capNotice.title")}</p>
        <p className="text-muted-foreground">
          {t("capNotice.body", { count: hidden, shown: openLoaded, total: openTotal })}
        </p>
        {stationShown !== undefined && (
          <p className="text-muted-foreground">{t("capNotice.station", { count: stationShown })}</p>
        )}
      </div>
    </div>
  );
}
