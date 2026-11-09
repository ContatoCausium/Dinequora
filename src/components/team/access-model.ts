/**
 * Pure helpers for the Team & Permissions center. The DATABASE is the authority (set_member_access,
 * save_permission_profile, RLS); these only drive what the UI previews and which values it submits.
 */
import {
  PERMISSION_CATALOG,
  PERMISSION_MODULES,
  STANDARD_ACTIONS,
  effectivePermissions,
  roleCeiling,
  roleDefaults,
  type Permission,
  type PermissionModule,
} from "@/lib/permissions";
import type { OrgRole } from "@/lib/access-rules";

export type MatrixColumn = (typeof STANDARD_ACTIONS)[number] | "other";
export const MATRIX_COLUMNS: readonly MatrixColumn[] = [...STANDARD_ACTIONS, "other"];

export type MatrixRow = {
  module: PermissionModule;
  /** Permission per standard column, or null when the module has no such action. */
  cells: Record<(typeof STANDARD_ACTIONS)[number], Permission | null>;
  /** Module-specific actions (sell, refund, receive…) shown as labelled toggles. */
  other: Permission[];
};

const isStandard = (a: string): a is (typeof STANDARD_ACTIONS)[number] =>
  (STANDARD_ACTIONS as readonly string[]).includes(a);

export function matrixRows(): MatrixRow[] {
  return PERMISSION_MODULES.map((m) => {
    const cells = { view: null, create: null, edit: null, delete: null, approve: null } as Record<
      (typeof STANDARD_ACTIONS)[number],
      Permission | null
    >;
    const other: Permission[] = [];
    for (const a of m.actions as readonly string[]) {
      const p = `${m.module}.${a}` as Permission;
      if (isStandard(a)) cells[a] = p;
      else other.push(p);
    }
    return { module: m.module, cells, other };
  });
}

export const permissionAction = (p: string) => p.slice(p.indexOf(".") + 1);
export const permissionModule = (p: string) => p.slice(0, p.indexOf("."));

const sortByCatalog = (ps: Iterable<string>): Permission[] => {
  const s = new Set(ps);
  return PERMISSION_CATALOG.filter((p) => s.has(p));
};

/** What a member inherits before individual adjustments: profile or tier defaults, capped by ceiling. */
export function inheritedPermissions(
  role: OrgRole,
  profilePermissions: readonly string[] | null,
): Permission[] {
  return effectivePermissions({ role, profilePermissions, extra: [], revoked: [] });
}

/**
 * Individual adjustments that turn the inherited set into the desired one.
 * Anything outside the tier ceiling is dropped (the server would ignore/refuse it).
 */
export function computeAdjustments(
  role: OrgRole,
  profilePermissions: readonly string[] | null,
  desired: Iterable<string>,
): { extra: Permission[]; revoked: Permission[] } {
  if (role === "owner") return { extra: [], revoked: [] };
  const ceiling = new Set<string>(roleCeiling(role));
  const base = new Set<string>(inheritedPermissions(role, profilePermissions));
  const want = new Set([...desired].filter((p) => ceiling.has(p)));
  return {
    extra: sortByCatalog([...want].filter((p) => !base.has(p))),
    revoked: sortByCatalog([...base].filter((p) => !want.has(p))),
  };
}

export type CellState = "inherited" | "off" | "added" | "removed" | "unavailable";

/** Visual state of one toggle in the member matrix. */
export function cellState(
  perm: Permission,
  role: OrgRole,
  inherited: ReadonlySet<string>,
  desired: ReadonlySet<string>,
): CellState {
  if (role === "owner") return "inherited";
  if (!(roleCeiling(role) as string[]).includes(perm)) return "unavailable";
  const on = desired.has(perm);
  if (inherited.has(perm)) return on ? "inherited" : "removed";
  return on ? "added" : "off";
}

/** Toggles one permission in a desired set, never past the tier ceiling. Returns a new set. */
export function togglePermission(
  role: OrgRole,
  desired: ReadonlySet<string>,
  perm: Permission,
): Set<string> {
  const next = new Set(desired);
  if (role === "owner" || !(roleCeiling(role) as string[]).includes(perm)) return next;
  if (next.has(perm)) next.delete(perm);
  else next.add(perm);
  return next;
}

/** Granted/removed between two permission sets (catalog order). */
export function diffPermissions(
  before: Iterable<string>,
  after: Iterable<string>,
): { granted: Permission[]; removed: Permission[] } {
  const b = new Set(before);
  const a = new Set(after);
  return {
    granted: sortByCatalog([...a].filter((p) => !b.has(p))),
    removed: sortByCatalog([...b].filter((p) => !a.has(p))),
  };
}

/** Permissions a manager would hand out beyond their own (server raises permission_exceeds_own). */
export function exceedingOwn(desired: Iterable<string>, mine: ReadonlySet<string>): Permission[] {
  return sortByCatalog([...desired].filter((p) => !mine.has(p)));
}

/** Caps a profile's permissions to the tier ceiling (used when a profile's tier changes). */
export function capToTier(role: OrgRole, perms: Iterable<string>): Permission[] {
  const ceiling = new Set<string>(roleCeiling(role));
  return sortByCatalog([...perms].filter((p) => ceiling.has(p)));
}

export const tierDefaults = (role: OrgRole): Permission[] => roleDefaults(role);

export const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

// ---------------------------------------------------------------- errors & activity labels
export const KNOWN_ERRORS = [
  "forbidden",
  "permission_denied",
  "permission_exceeds_own",
  "invalid_permission",
  "invalid_profile",
  "profile_tier_mismatch",
  "profile_tier_in_use",
  "profile_in_use",
  "last_owner",
  "invalid_location",
  "invalid_email",
  "invalid_name",
  "not_member",
  "org_suspended",
  "subscription_inactive",
] as const;
export type KnownError = (typeof KNOWN_ERRORS)[number] | "unknown";

/** Maps an RPC error (code message or raw Postgres message) to a translatable code. */
export function errorCode(e: unknown): KnownError {
  const msg =
    e instanceof Error
      ? e.message
      : typeof e === "object" && e && "message" in e
        ? String((e as { message: unknown }).message)
        : "";
  return KNOWN_ERRORS.find((c) => msg.includes(c)) ?? "unknown";
}

/** Audit actions with a translated label under `activity.actions.<module>.<verb>`. */
export const KNOWN_AUDIT_ACTIONS = [
  "member.added",
  "member.removed",
  "member.role_changed",
  "member.access_changed",
  "member.locations_changed",
  "invitation.created",
  "invitation.revoked",
  "invitation.accepted",
  "permission_profile.saved",
  "permission_profile.archived",
  "ownership.transferred",
  "orders.created",
  "orders.status_changed",
  "orders.cancelled",
  "orders.item_ready",
  "pos.finalized",
  "inventory.moved",
  "inventory.saved",
  "purchase.received",
  "purchase.cancelled",
  "purchase.saved",
  "menu.saved",
  "menu.archived",
  "expense.saved",
  "recipe.saved",
  "supplier.saved",
  "location.created",
  "location.updated",
  "location.status_changed",
  "location.managers_changed",
  "organization.created",
  "organization.brand_updated",
  "organization.onboarding_progress",
  "organization.test_classified",
] as const;

export const isKnownAuditAction = (a: string) =>
  (KNOWN_AUDIT_ACTIONS as readonly string[]).includes(a);

/** Readable fallback for an unmapped key: "orders.item_ready" → "Orders: item ready". */
export function humanizeAction(action: string): string {
  const parts = action
    .split(/[.:/]/)
    .map((s) => s.replace(/[_-]+/g, " ").trim())
    .filter(Boolean);
  if (!parts.length) return "—";
  const [head, ...rest] = parts;
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return rest.length ? `${cap(head!)}: ${rest.join(" ")}` : cap(head!);
}

/** Audit actions whose target column holds a member's user id. */
export const targetIsUser = (action: string) =>
  action.startsWith("member.") || action === "ownership.transferred";
/** Audit actions whose target is safe to show as-is (e-mail or store name). */
export const targetIsReadable = (action: string) =>
  action.startsWith("invitation.") ||
  action === "location.updated" ||
  action === "location.created" ||
  action === "location.status_changed";

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
