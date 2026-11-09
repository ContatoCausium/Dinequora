import type { Permission } from "./permissions";

/**
 * Which permissions open each module (any of). Shared by the sidebar, the command palette and the
 * route guard so they can never disagree. Data is still protected server-side (RLS + RPC asserts).
 */
export const ROUTE_PERMISSIONS: { prefix: string; any: readonly Permission[] }[] = [
  { prefix: "/pos", any: ["pos.view"] },
  { prefix: "/orders", any: ["orders.view"] },
  { prefix: "/kds", any: ["kds.view"] },
  { prefix: "/menu", any: ["menu.view"] },
  {
    prefix: "/inventory",
    any: ["inventory.view", "purchases.view", "recipes.view", "suppliers.view"],
  },
  { prefix: "/finance", any: ["finance.view", "expenses.view"] },
  { prefix: "/reports", any: ["reports.view"] },
  { prefix: "/intelligence", any: ["dashboard.financials", "finance.view"] },
  { prefix: "/team", any: ["team.view"] },
  { prefix: "/settings/branding", any: ["settings.branding"] },
  { prefix: "/settings/billing", any: ["settings.billing"] },
];

/** Required permissions for a path; null = open to every member (overview, stores). */
export function requiredFor(path: string): readonly Permission[] | null {
  return (
    ROUTE_PERMISSIONS.find((r) => path === r.prefix || path.startsWith(r.prefix + "/"))?.any ?? null
  );
}
