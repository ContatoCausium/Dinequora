import type { OrgRole } from "./access-rules";

/**
 * Permission catalog — mirrors public.permission_catalog() (migrations 0018, 0020).
 * The DATABASE is the authority (has_permission / RLS / RPC asserts); this module only drives UI
 * (what to show, previews in the permission matrix). A test checks both stay in sync.
 */
export const PERMISSION_MODULES = [
  { module: "dashboard", actions: ["view", "financials"] },
  { module: "pos", actions: ["view", "sell", "discount"] },
  { module: "orders", actions: ["view", "update", "refund"] },
  { module: "kds", actions: ["view", "operate"] },
  { module: "menu", actions: ["view", "create", "edit", "delete"] },
  { module: "inventory", actions: ["view", "create", "edit", "adjust", "transfer", "costs"] },
  { module: "recipes", actions: ["view", "edit"] },
  { module: "purchases", actions: ["view", "create", "approve", "receive", "cancel"] },
  { module: "suppliers", actions: ["view", "edit"] },
  { module: "finance", actions: ["view"] },
  { module: "expenses", actions: ["view", "create", "edit", "delete", "pay"] },
  { module: "reports", actions: ["view", "export"] },
  { module: "team", actions: ["view", "invite", "manage", "activity"] },
  { module: "settings", actions: ["locations", "branding", "billing"] },
] as const;

export type PermissionModule = (typeof PERMISSION_MODULES)[number]["module"];
export type Permission = {
  [
    M in (typeof PERMISSION_MODULES)[number] as M["module"]
  ]: `${M["module"]}.${M["actions"][number]}`;
}[PermissionModule];

export const PERMISSION_CATALOG: readonly Permission[] = PERMISSION_MODULES.flatMap((m) =>
  m.actions.map((a) => `${m.module}.${a}` as Permission),
);

/** Columns of the matrix; module-specific operations (sell, refund, receive…) go in "special". */
export const STANDARD_ACTIONS = ["view", "create", "edit", "delete", "approve"] as const;
export const ACTION_COLUMN: Record<string, (typeof STANDARD_ACTIONS)[number] | "special"> = {
  view: "view",
  create: "create",
  edit: "edit",
  delete: "delete",
  approve: "approve",
};

const isTierLimited = (p: Permission, role: OrgRole) => {
  if (role === "owner") return false;
  if (role === "manager") return p === "settings.branding" || p === "settings.billing";
  return p.startsWith("team.") || p.startsWith("settings.");
};

/** Highest set a tier may ever hold (mirrors public.role_ceiling). */
export function roleCeiling(role: OrgRole): Permission[] {
  return PERMISSION_CATALOG.filter((p) => !isTierLimited(p, role));
}

/** Capabilities of members without a profile (mirrors public.role_default_permissions). */
export function roleDefaults(role: OrgRole): Permission[] {
  if (role === "owner") return [...PERMISSION_CATALOG];
  if (role === "manager") return roleCeiling("manager").filter((p) => p !== "suppliers.edit");
  return [
    "dashboard.view",
    "pos.view",
    "pos.sell",
    "pos.discount",
    "orders.view",
    "orders.update",
    "kds.view",
    "kds.operate",
    "menu.view",
    "inventory.view",
    "recipes.view",
    "suppliers.view",
  ];
}

/** Effective permissions (mirrors public.member_permissions). */
export function effectivePermissions(input: {
  role: OrgRole;
  profilePermissions: readonly string[] | null;
  extra: readonly string[];
  revoked: readonly string[];
}): Permission[] {
  if (input.role === "owner") return [...PERMISSION_CATALOG];
  const ceiling = new Set<string>(roleCeiling(input.role));
  const base = input.profilePermissions ?? roleDefaults(input.role);
  const revoked = new Set(input.revoked);
  const out = new Set<Permission>();
  for (const p of [...base, ...input.extra]) {
    if (ceiling.has(p) && !revoked.has(p)) out.add(p as Permission);
  }
  return PERMISSION_CATALOG.filter((p) => out.has(p));
}

export const isPermission = (v: string): v is Permission =>
  (PERMISSION_CATALOG as readonly string[]).includes(v);

/** Error raised by assert_permission / RPC enforcement (message "permission_denied"). */
export const isPermissionDenied = (e: unknown) =>
  e instanceof Error && /permission_denied|permission_exceeds_own/.test(e.message);
