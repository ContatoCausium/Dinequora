import { useQuery } from "@tanstack/react-query";
import { fetchNavCounts } from "@/lib/operational.functions";
import {
  EMPTY_NAV_COUNTS,
  NAV_COUNT_PERMISSIONS,
  NAV_COUNTS_REFRESH_MS,
  type NavCounts,
} from "@/lib/nav-counts";
import { useWorkspace } from "./workspace-context";
import { usePresentationMode } from "./use-presentation-mode";

/** Query key of the sidebar counters (one entry per organization and store scope). */
export const navCountsKey = (orgId: string, locationId: string) =>
  ["nav-counts", orgId, locationId] as const;

/**
 * Sidebar counters, refreshed every 30 s while the navigation is on screen and the tab is visible
 * (React Query pauses the interval in background tabs and refreshes on focus). One request returns
 * all three numbers; nothing is polled when the member can see none of the modules, during focus
 * mode, in presentation mode (illustrative screens) or for a suspended organization.
 *
 * Fails closed: a counter is null — and shows nothing — when it is not permitted (checked here and
 * again on the server), still loading, or when the latest refresh failed. Never a made-up zero.
 */
export function useNavCounts(enabled: boolean): NavCounts {
  const { org, locationId, canAny, orgStatus } = useWorkspace();
  const { active: presentation } = usePresentationMode();
  const allowed = {
    openOrders: canAny(NAV_COUNT_PERMISSIONS.openOrders),
    lateTickets: canAny(NAV_COUNT_PERMISSIONS.lateTickets),
    lowStock: canAny(NAV_COUNT_PERMISSIONS.lowStock),
  };
  const active =
    enabled &&
    !presentation &&
    orgStatus !== "suspended" &&
    (allowed.openOrders || allowed.lateTickets || allowed.lowStock);
  const query = useQuery({
    queryKey: navCountsKey(org.id, locationId),
    queryFn: () => fetchNavCounts({ data: { orgId: org.id, locationId } }),
    enabled: active,
    refetchInterval: NAV_COUNTS_REFRESH_MS,
    refetchIntervalInBackground: false,
    staleTime: NAV_COUNTS_REFRESH_MS - 5_000,
    retry: 1,
  });
  if (!active || !query.data || query.isError) return EMPTY_NAV_COUNTS;
  return {
    openOrders: allowed.openOrders ? query.data.openOrders : null,
    lateTickets: allowed.lateTickets ? query.data.lateTickets : null,
    lowStock: allowed.lowStock ? query.data.lowStock : null,
  };
}
