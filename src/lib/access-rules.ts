/**
 * Client-side mirror of the backend authorization rules.
 * The database (security-definer RPCs + RLS) is the source of truth; these helpers only decide
 * what the UI offers so people never see buttons the backend would refuse.
 */
export type OrgRole = "owner" | "manager" | "staff";
export type LocationLifecycle = "active" | "inactive" | "placeholder";
export type DayKey = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type WeeklyHours = Partial<Record<DayKey, { open: string; close: string } | null>>;
export const DAYS: DayKey[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** Stores that count toward the plan limit (inactive ones are free). */
export function countBillableStores(statuses: LocationLifecycle[]): number {
  return statuses.filter((s) => s !== "inactive").length;
}

export function canAddStore(
  role: OrgRole,
  billable: number,
  limit: number,
  suspended: boolean,
): boolean {
  return role === "owner" && !suspended && billable < limit;
}

export type MemberLite = { role: OrgRole; locationIds: string[] };

/** Owners manage anyone; managers manage staff whose stores all sit inside the manager's own stores. */
export function canManageMember(me: MemberLite, target: MemberLite): boolean {
  if (me.role === "owner") return true;
  if (me.role !== "manager" || target.role !== "staff") return false;
  return target.locationIds.every((id) => me.locationIds.includes(id));
}

/** Roles a caller may hand out through invitations. */
export function invitableRoles(role: OrgRole): OrgRole[] {
  if (role === "owner") return ["staff", "manager", "owner"];
  if (role === "manager") return ["staff"];
  return [];
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Validates a week of opening hours. Overnight (close < open) is allowed; equal times are not. */
export function validateHours(h: WeeklyHours): string[] {
  return Object.entries(h)
    .filter(([d, v]) => {
      if (!DAYS.includes(d as DayKey)) return true;
      if (v === null) return false;
      if (!v || typeof v !== "object" || Object.keys(v).length !== 2) return true;
      return (
        typeof v.open !== "string" ||
        typeof v.close !== "string" ||
        !TIME.test(v.open) ||
        !TIME.test(v.close) ||
        v.open === v.close
      );
    })
    .map(([d]) => d);
}

/** A non-owner can invite only into stores they are assigned to; with none, inviting is impossible. */
export function canInviteWithScope(roles: OrgRole[], scope: string[]): boolean {
  if (roles.length === 0) return false;
  return roles.includes("owner") || scope.length > 0;
}

/** An invitation past its expiry can no longer be accepted and must not be shown as pending. */
export function isInviteExpired(expiresAt: string | Date, now: Date = new Date()): boolean {
  return new Date(expiresAt).getTime() < now.getTime();
}
