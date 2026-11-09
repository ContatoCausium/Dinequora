/**
 * Organization, membership and invitation data access.
 * Kept separate from auth so business data and identity can move independently.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { ORGANIZATIONS, type Location, type Organization } from "@/lib/tenants";
import type { LocationLifecycle, WeeklyHours } from "@/lib/access-rules";

export type OrgRole = "owner" | "manager" | "staff";
export type OrgStatus = "trial" | "active" | "suspended";
export type Membership = {
  org: Organization;
  role: OrgRole;
  dbId: string;
  memberId: string;
  status: OrgStatus;
  suspendedReason: string | null;
  storeLimit: number;
};

type DbLocation = {
  id: string;
  slug: string;
  name: string;
  address: string | null;
  phone: string | null;
  timezone: string;
  status: LocationLifecycle;
  hours: WeeklyHours;
  is_verified: boolean;
};
type Row = {
  role: OrgRole;
  id: string;
  member_location_access: { location_id: string }[];
  organizations: {
    id: string;
    slug: string;
    name: string;
    brand_primary: string;
    brand_accent: string;
    status: OrgStatus;
    suspended_reason: string | null;
    store_limit: number;
    plan: Organization["plan"];
    is_demo: boolean;
    logo_url: string | null;
    previous_brand: Organization["previousBrand"];
    onboarding_step: number;
    locations: DbLocation[];
  } | null;
};

const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

export async function fetchMemberships(userId: string): Promise<Membership[]> {
  const { data, error } = await supabase
    .from("organization_members")
    .select(
      "id, role, member_location_access(location_id), organizations(id, slug, name, brand_primary, brand_accent, status, suspended_reason, store_limit, plan, is_demo, logo_url, previous_brand, onboarding_step, locations(id, slug, name, address, phone, timezone, status, hours, is_verified))",
    )
    .eq("user_id", userId);
  if (error) throw error;
  return ((data ?? []) as unknown as Row[]).flatMap((r) => {
    const o = r.organizations;
    if (!o) return [];
    const known = ORGANIZATIONS.find((t) => t.id === o.slug);
    const dbLocs = [...o.locations].sort((a, b) => a.slug.localeCompare(b.slug));
    const locations: Location[] = dbLocs.map((l, i) => ({
      id: l.slug,
      dbId: l.id,
      name: l.name,
      status: l.is_verified ? "verified" : "placeholder",
      lifecycle: l.status,
      address: l.address ?? undefined,
      phone: l.phone ?? undefined,
      hours: l.hours ?? {},
      timezone: l.timezone,
      demoScale:
        known?.locations.find((k) => k.id === l.slug)?.demoScale ?? Math.max(0.3, 0.6 - i * 0.1),
    }));
    const base: Organization = {
      ...(known ?? { categories: [], topItems: [] }),
      id: o.slug,
      name: o.name,
      initials: initialsOf(o.name),
      brand: { primary: o.brand_primary, accent: o.brand_accent },
      logoUrl: resolveLogo(o.logo_url, o.previous_brand, known?.logoUrl),
      previousBrand: o.previous_brand ?? undefined,
      onboardingStep: o.onboarding_step,
      plan: o.plan,
      subscription: "trial",
      fictional: o.is_demo,
      categories: known?.categories ?? [],
      topItems: known?.topItems ?? [],
      locations,
    };
    // Only owners are org-wide; managers and staff see assigned stores (mirrors can_access_location).
    const allowed = new Set(r.member_location_access.map((a) => a.location_id));
    const org =
      r.role === "owner"
        ? base
        : { ...base, locations: base.locations.filter((l) => l.dbId && allowed.has(l.dbId)) };
    return [
      {
        org,
        role: r.role,
        dbId: o.id,
        memberId: r.id,
        status: o.status,
        suspendedReason: o.suspended_reason,
        storeLimit: o.store_limit,
      },
    ];
  });
}

/** Maps backend error codes to stable keys the UI translates. */
export function rpcErrorCode(message: string): string {
  const codes = [
    "store_limit",
    "org_suspended",
    "subscription_inactive",
    "forbidden",
    "last_owner",
    "invalid_timezone",
    "invalid_name",
    "address_required",
    "invalid_location",
    "invalid_email",
    "email_mismatch",
    "permission_denied",
    "permission_exceeds_own",
    "invalid_permission",
    "invalid_profile",
    "profile_tier_mismatch",
    "profile_tier_in_use",
    "profile_in_use",
    "last_owner",
    "not_member",
  ];
  return codes.find((c) => message.includes(c)) ?? "unknown";
}

/** Names come from the generated schema, so a renamed/removed SQL function fails type-checking. */
type RpcName = keyof Database["public"]["Functions"];

async function rpc(fn: RpcName, args: Record<string, unknown>) {
  // Args are validated server-side by the security-definer function; the dynamic
  // name prevents per-call arg inference, so this is the single typed boundary.
  const { data, error } = await supabase.rpc(fn, args as never);
  if (error) throw new Error(rpcErrorCode(error.message));
  return data as unknown;
}

export const createLocation = (
  orgDbId: string,
  v: { name: string; address: string; timezone: string; phone: string },
) =>
  rpc("create_location", {
    _org_id: orgDbId,
    _name: v.name,
    _address: v.address,
    _timezone: v.timezone,
    _phone: v.phone,
  }) as Promise<string>;
export const updateLocation = (
  id: string,
  v: { name: string; address: string; phone: string; timezone: string; hours: WeeklyHours },
) =>
  rpc("update_location", {
    _id: id,
    _name: v.name,
    _address: v.address,
    _phone: v.phone,
    _timezone: v.timezone,
    _hours: v.hours,
  });
export const setLocationStatus = (id: string, status: "active" | "inactive") =>
  rpc("set_location_status", { _id: id, _status: status });
/** Saves details and (owners only) store managers in one backend transaction: all-or-nothing. */
export const saveLocationWithManagers = (
  id: string,
  v: { name: string; address: string; phone: string; timezone: string; hours: WeeklyHours },
  memberIds: string[] | null,
) =>
  rpc("save_location_with_managers", {
    _id: id,
    _name: v.name,
    _address: v.address,
    _phone: v.phone,
    _timezone: v.timezone,
    _hours: v.hours,
    _member_ids: memberIds as string[],
  });
export const setLocationManagers = (id: string, memberIds: string[]) =>
  rpc("set_location_managers", { _location_id: id, _member_ids: memberIds });
export const setMemberRole = (memberId: string, role: OrgRole) =>
  rpc("set_member_role", { _member_id: memberId, _role: role });
export const setMemberLocations = (memberId: string, locationIds: string[]) =>
  rpc("set_member_locations", { _member_id: memberId, _location_ids: locationIds });
export const removeMember = (memberId: string) => rpc("remove_member", { _member_id: memberId });

export async function createOrganization(name: string, brandPrimary: string, locationName: string) {
  const { data, error } = await supabase.rpc("create_organization", {
    _name: name,
    _brand_primary: brandPrimary,
    _location_name: locationName,
  });
  if (error) throw new Error(error.message.includes("org_limit") ? "org_limit" : "unknown");
  return data as string;
}

export async function createInvitation(
  orgDbId: string,
  email: string,
  role: OrgRole,
  locationIds: string[] = [],
  profileId: string | null = null,
) {
  const { data, error } = await supabase.rpc("create_invitation", {
    _org_id: orgDbId,
    _email: email,
    _role: role,
    _location_ids: locationIds,
    ...(profileId ? { _profile_id: profileId } : {}),
  });
  if (error) throw error;
  return `${window.location.origin}/invite/${data as string}`;
}

export async function revokeInvitation(id: string) {
  const { error } = await supabase.rpc("revoke_invitation", { _id: id });
  if (error) throw error;
}

export type InvitationInfo = {
  org_name: string;
  org_slug: string;
  brand_primary: string;
  email: string;
  role: OrgRole;
  status: "pending" | "accepted" | "expired" | "revoked";
};
export async function getInvitation(token: string): Promise<InvitationInfo | null> {
  const { data, error } = await supabase.rpc("get_invitation", { _token: token });
  if (error) throw error;
  return ((data ?? []) as InvitationInfo[])[0] ?? null;
}

export async function acceptInvitation(token: string) {
  const { error } = await supabase.rpc("accept_invitation", { _token: token });
  if (error)
    throw new Error(
      error.message.includes("email_mismatch") ? "email_mismatch" : "invalid_invitation",
    );
}

export async function fetchTeam(orgDbId: string) {
  const [members, invites] = await Promise.all([
    supabase
      .from("organization_members")
      .select(
        "id, role, user_id, created_at, profile_id, extra_permissions, revoked_permissions, member_location_access(location_id)",
      )
      .eq("org_id", orgDbId)
      .order("created_at"),
    supabase
      .from("invitations")
      .select(
        "id, email, role, location_ids, profile_id, expires_at, accepted_at, revoked_at, created_at",
      )
      .eq("org_id", orgDbId)
      .is("accepted_at", null)
      .is("revoked_at", null)
      .order("created_at", { ascending: false }),
  ]);
  if (members.error) throw members.error;
  const ids = (members.data ?? []).map((m) => m.user_id);
  const profiles = ids.length
    ? ((await supabase.from("profiles").select("id, full_name").in("id", ids)).data ?? [])
    : [];
  return {
    members: (members.data ?? []).map((m) => ({
      ...m,
      location_ids: (m.member_location_access ?? []).map((a) => a.location_id),
      full_name: profiles.find((p) => p.id === m.user_id)?.full_name ?? null,
    })),
    invites: invites.data ?? [],
  };
}

export type AuditEntry = {
  id: string;
  action: string;
  target: string | null;
  actor_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  location_id: string | null;
  result: "success" | "denied" | "error";
};
/** Members with team.activity only (enforced by RLS); returns [] for everyone else. */
export async function fetchOrgAudit(
  orgDbId: string,
  limit = 20,
  filters: {
    actorId?: string | undefined;
    locationDbId?: string | undefined;
    result?: AuditEntry["result"] | undefined;
  } = {},
): Promise<AuditEntry[]> {
  let q = supabase
    .from("audit_logs")
    .select("id, action, target, actor_id, metadata, created_at, location_id, result")
    .eq("org_id", orgDbId)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (filters.actorId) q = q.eq("actor_id", filters.actorId);
  if (filters.locationDbId) q = q.eq("location_id", filters.locationDbId);
  if (filters.result) q = q.eq("result", filters.result);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as AuditEntry[];
}

export async function transferOwnership(orgDbId: string, newOwnerUserId: string) {
  const { error } = await supabase.rpc("transfer_ownership", {
    _org_id: orgDbId,
    _new_owner: newOwnerUserId,
  });
  if (error) throw new Error(rpcErrorCode(error.message));
}

export type BillingSummary = {
  subscription: {
    plan_id: string;
    status: string;
    billed_locations: number;
    trial_ends_at: string | null;
    current_period_end: string | null;
    grace_ends_at: string | null;
    cancel_at_period_end: boolean;
    stripe_subscription_id: string | null;
  } | null;
  plans: {
    id: string;
    name: string;
    price_per_location_cents: number;
    default_store_limit: number;
    trial_days: number;
    is_placeholder_pricing: boolean;
  }[];
  events: {
    id: string;
    kind: string;
    amount_cents: number | null;
    status: string | null;
    description: string | null;
    occurred_at: string;
  }[];
};
/** Owners only (RLS); others get an empty summary. */
export async function fetchBilling(orgDbId: string): Promise<BillingSummary> {
  const [s, p, e] = await Promise.all([
    supabase
      .from("subscriptions")
      .select(
        "plan_id, status, billed_locations, trial_ends_at, current_period_end, grace_ends_at, cancel_at_period_end, stripe_subscription_id",
      )
      .eq("org_id", orgDbId)
      .maybeSingle(),
    supabase
      .from("billing_plans")
      .select(
        "id, name, price_per_location_cents, default_store_limit, trial_days, is_placeholder_pricing",
      )
      .order("price_per_location_cents"),
    supabase
      .from("billing_events")
      .select("id, kind, amount_cents, status, description, occurred_at")
      .eq("org_id", orgDbId)
      .order("occurred_at", { ascending: false })
      .limit(24),
  ]);
  return { subscription: s.data ?? null, plans: p.data ?? [], events: e.data ?? [] };
}

export const createTestRestaurant = (
  name: string,
  companyName: string,
  companyAddress: string,
  locationName: string,
) =>
  rpc("create_test_restaurant", {
    _name: name,
    _company_name: companyName,
    _company_address: companyAddress,
    _location_name: locationName,
  }) as Promise<string>;
export const saveOrganizationBrand = (
  orgId: string,
  brand: { primary: string; accent: string; logoUrl?: string | undefined },
) =>
  rpc("save_org_brand", {
    _org_id: orgId,
    _primary: brand.primary,
    _accent: brand.accent,
    _logo: brand.logoUrl ?? null,
  });
export const setOnboardingStep = (orgId: string, step: number) =>
  rpc("set_onboarding_step", { _org_id: orgId, _step: step });

/** The bundled sample logo only applies to an organization whose branding was never edited;
 * once an owner saves or removes a logo, the stored value is authoritative (null = no logo). */
export function resolveLogo(
  stored: string | null,
  previousBrand: unknown,
  bundled: string | undefined,
): string | undefined {
  if (stored) return stored;
  return previousBrand == null ? bundled : undefined;
}

// ---------------------------------------------------------------- permissions (migration 0018)
export type PermissionProfile = {
  id: string;
  org_id: string | null;
  key: string;
  name: string;
  description: string;
  tier: "manager" | "staff";
  permissions: string[];
  is_system: boolean;
  archived_at: string | null;
};

/** Effective permissions of the signed-in user in this organization (owner = full catalog). */
export async function fetchMyPermissions(orgDbId: string): Promise<string[]> {
  const { data, error } = await supabase.rpc("my_permissions", { _org_id: orgDbId });
  if (error) throw new Error(rpcErrorCode(error.message));
  return data ?? [];
}

/** System templates plus profiles owned by this organization (RLS: members only). */
export async function fetchPermissionProfiles(orgDbId: string): Promise<PermissionProfile[]> {
  const { data, error } = await supabase
    .from("permission_profiles")
    .select("id, org_id, key, name, description, tier, permissions, is_system, archived_at")
    .or(`org_id.is.null,org_id.eq.${orgDbId}`)
    .is("archived_at", null)
    .order("is_system", { ascending: false })
    .order("name");
  if (error) throw new Error(rpcErrorCode(error.message));
  return (data ?? []).flatMap((p) => (p.tier === "owner" ? [] : [{ ...p, tier: p.tier }]));
}

export const savePermissionProfile = (
  orgDbId: string,
  v: {
    id: string | null;
    name: string;
    description: string;
    tier: "manager" | "staff";
    permissions: string[];
  },
) =>
  rpc("save_permission_profile", {
    _org_id: orgDbId,
    _id: v.id,
    _name: v.name,
    _description: v.description,
    _tier: v.tier,
    _permissions: v.permissions,
  }) as Promise<string>;

export const archivePermissionProfile = (id: string) =>
  rpc("archive_permission_profile", { _id: id });

/** Tier + profile + individual adjustments + stores in one audited call. */
export const setMemberAccess = (
  memberId: string,
  v: {
    role: OrgRole;
    profileId: string | null;
    extra: string[];
    revoked: string[];
    locationIds: string[];
  },
) =>
  rpc("set_member_access", {
    _member_id: memberId,
    _role: v.role,
    _profile_id: v.profileId,
    _extra: v.extra,
    _revoked: v.revoked,
    _location_ids: v.locationIds,
  });
