import { useQuery } from "@tanstack/react-query";
import { fetchAllOrders } from "./recorded-data";
import { buildReport } from "./report-metrics";
import { previousWindow, type ComparablePeriod } from "./period-compare";

type Ledger = Parameters<typeof buildReport>[0]["ledger"];

/**
 * The report of the previous window, for comparisons only. It is a separate, read-only query that
 * starts after the current period has loaded, so the current numbers (and any truncation notice)
 * are exactly what they were. When the read was cut short by the history cap the previous window
 * would be incomplete, so the result is null and no comparison is shown.
 */
export function usePreviousPeriodReport(input: {
  orgId: string;
  locationId: string;
  period: ComparablePeriod;
  timeZone: string | undefined;
  ledger: Ledger | undefined;
  enabled: boolean;
}) {
  const { orgId, locationId, period, timeZone, ledger, enabled } = input;
  return useQuery({
    queryKey: ["previous-period", orgId, locationId, period, timeZone],
    enabled: enabled && !!ledger,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const win = previousWindow(period);
      const read = await fetchAllOrders(orgId, locationId, win.since);
      if (read.truncated) return null;
      const endMs = Date.parse(win.end);
      return buildReport({
        orders: read.orders.filter((o) => Date.parse(o.createdAt) < endMs),
        ledger: (ledger ?? []).filter((e) => Date.parse(e.created_at) < endMs),
        since: win.since,
        days: win.days,
        timeZone,
        now: win.now,
      });
    },
  });
}
