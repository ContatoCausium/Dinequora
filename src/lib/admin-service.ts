/**
 * Platform Control Center data access. Every call is authorized server-side by
 * `is_platform_admin()` inside security-definer database functions and audited.
 * Nothing here grants restaurant (organization) membership implicitly.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { OrgStatus } from "@/lib/org-service";
import { requestErrorKind } from "@/lib/request-error";

export type PlanId = "starter" | "growth" | "enterprise";
export type PlatformOrg = {
  id: string;
  name: string;
  slug: string;
  status: OrgStatus;
  plan: PlanId;
  store_limit: number;
  store_count: number;
  member_count: number;
  owner_count: number;
  is_demo: boolean;
  created_at: string;
};
export type PlatformAudit = {
  id: string;
  org_id: string | null;
  org_name: string | null;
  actor_id: string | null;
  action: string;
  target: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};
export type PlatformRole = "platform_admin" | "support";
export type PlatformAdmin = {
  user_id: string;
  email: string;
  role: PlatformRole;
};

const code = (msg: string) =>
  [
    "forbidden",
    "reason_required",
    "verification_required",
    "user_not_found",
    "last_admin",
    "not_found",
  ].find((c) => msg.includes(c)) ?? "unknown";

/** Names come from the generated schema, so a renamed/removed SQL function fails type-checking. */
type RpcName = keyof Database["public"]["Functions"];

async function call<T>(fn: RpcName, args: Record<string, unknown> = {}): Promise<T> {
  // Args are validated server-side by the security-definer function; the dynamic
  // name prevents per-call arg inference, so this is the single typed boundary.
  const { data, error } = await supabase.rpc(fn, args as never);
  if (error)
    throw new Error(
      code(error.message) === "unknown" ? requestErrorKind(error) : code(error.message),
    );
  return data as T;
}

export const isPlatformAdmin = async () => {
  try {
    return Boolean(await call<boolean>("is_platform_admin"));
  } catch {
    return false;
  }
};

export const listOrganizations = () => call<PlatformOrg[]>("admin_list_organizations");
export const listPlatformAudit = (limit = 100) =>
  call<PlatformAudit[]>("admin_list_audit", { _limit: limit });
export const listPlatformAdmins = () => call<PlatformAdmin[]>("admin_list_platform_admins");

export const updateOrganization = (
  orgId: string,
  patch: { status?: OrgStatus; plan?: PlanId; storeLimit?: number },
  reason: string,
) =>
  call<void>("admin_update_organization", {
    _org_id: orgId,
    _status: patch.status ?? null,
    _plan: patch.plan ?? null,
    _store_limit: patch.storeLimit ?? null,
    _reason: reason,
  });

export const assignOwner = (orgId: string, email: string, verificationNote: string) =>
  call<void>("admin_assign_owner", {
    _org_id: orgId,
    _email: email,
    _verification_note: verificationNote,
  });

/**
 * Concede ou revoga um papel de plataforma ('platform_admin' | 'support').
 * Impede revogação no cliente se for o último administrador remanescente.
 */
export const setPlatformRole = async (
  email: string,
  role: PlatformAdmin["role"],
  grant: boolean,
  reason: string,
) => {
  if (reason.trim().length < 3) {
    throw new Error("reason_required");
  }
  if (!grant && role === "platform_admin") {
    const current = await listPlatformAdmins();
    const adminCount = current.filter((a) => a.role === "platform_admin").length;
    const targetIsAdmin = current.some(
      (a) => a.email.toLowerCase() === email.trim().toLowerCase() && a.role === "platform_admin",
    );
    if (targetIsAdmin && adminCount <= 1) {
      throw new Error("last_admin");
    }
  }
  return call<void>("admin_set_platform_role", {
    _email: email,
    _role: role,
    _grant: grant,
    _reason: reason,
  });
};

/* ── Audit log filtering ── */
export type AuditFilterOptions = {
  orgId?: string | "all" | "platform_only";
  action?: string | "all";
  searchQuery?: string;
  startDate?: string | null;
  endDate?: string | null;
};

export function filterAuditLogs(
  logs: PlatformAudit[],
  options: AuditFilterOptions,
): PlatformAudit[] {
  const query = options.searchQuery?.trim().toLowerCase() ?? "";
  return logs.filter((log) => {
    if (options.orgId === "platform_only" && log.org_id !== null) return false;
    if (
      options.orgId &&
      options.orgId !== "all" &&
      options.orgId !== "platform_only" &&
      log.org_id !== options.orgId
    )
      return false;
    if (options.action && options.action !== "all" && log.action !== options.action) return false;
    if (options.startDate && new Date(log.created_at) < new Date(options.startDate)) return false;
    if (options.endDate) {
      const end = new Date(options.endDate);
      end.setHours(23, 59, 59, 999);
      if (new Date(log.created_at) > end) return false;
    }
    if (query) {
      const matchAction = log.action.toLowerCase().includes(query);
      const matchTarget = (log.target ?? "").toLowerCase().includes(query);
      const matchOrg = (log.org_name ?? "").toLowerCase().includes(query);
      const metaStr = JSON.stringify(log.metadata ?? {}).toLowerCase();
      const matchMeta = metaStr.includes(query);
      if (!matchAction && !matchTarget && !matchOrg && !matchMeta) return false;
    }
    return true;
  });
}

export type { OrgInsight, PlanDef } from "@/lib/platform-metrics";
import type { OrgInsight, PlanDef } from "@/lib/platform-metrics";
const num = (v: unknown) => Number(v ?? 0);
export const listOrgInsights = async () =>
  (await call<OrgInsight[]>("admin_org_insights")).map((o) => ({
    ...o,
    store_count: num(o.store_count),
    active_store_count: num(o.active_store_count),
    store_limit: num(o.store_limit),
    member_count: num(o.member_count),
    owner_count: num(o.owner_count),
    pending_invites: num(o.pending_invites),
  }));

export async function listPlans(): Promise<PlanDef[]> {
  const { data, error } = await supabase
    .from("billing_plans")
    .select(
      "id,name,price_per_location_cents,currency,default_store_limit,trial_store_limit,trial_days,is_placeholder_pricing",
    )
    .order("price_per_location_cents");
  if (error) throw new Error(requestErrorKind(error));
  return data as PlanDef[];
}

/* ── Plan management (Phase 2.2) ── */

export type PlanFeature = { key: string; starter: boolean; growth: boolean; enterprise: boolean };
export type PlanChangeEntry = {
  id: string;
  planId: PlanId;
  field: string;
  oldValue: string;
  newValue: string;
  reason: string;
  status: "draft" | "published";
  actorEmail: string;
  createdAt: string;
};

export type FullPlanDef = {
  id: PlanId;
  name: string;
  description: string;
  priceMonthlyUsd: number;
  priceAnnualUsd: number;
  maxLocations: number;
  maxEmployees: number;
  trialDays: number;
  trialStoreLimit: number;
  isActive: boolean;
  isPlaceholder: boolean;
  features: string[];
  limits: Record<string, number>;
};

export type PlanImpactSummary = {
  planId: PlanId;
  affectedOrgs: number;
  affectedLocations: number;
  details: string[];
};

const PLAN_FEATURES: PlanFeature[] = [
  { key: "basicDashboard", starter: true, growth: true, enterprise: true },
  { key: "locationManagement", starter: true, growth: true, enterprise: true },
  { key: "teamManagement", starter: true, growth: true, enterprise: true },
  { key: "brandCustomization", starter: false, growth: true, enterprise: true },
  { key: "advancedAnalytics", starter: false, growth: true, enterprise: true },
  { key: "multiLocation", starter: false, growth: true, enterprise: true },
  { key: "apiAccess", starter: false, growth: false, enterprise: true },
  { key: "prioritySupport", starter: false, growth: false, enterprise: true },
  { key: "customIntegrations", starter: false, growth: false, enterprise: true },
  { key: "whiteLabel", starter: false, growth: false, enterprise: true },
  { key: "dedicatedManager", starter: false, growth: false, enterprise: true },
  { key: "slaGuarantee", starter: false, growth: false, enterprise: true },
];

const DEFAULT_PLANS: FullPlanDef[] = [
  {
    id: "starter",
    name: "Starter",
    description: "Essential tools for a single location",
    priceMonthlyUsd: 29,
    priceAnnualUsd: 290,
    maxLocations: 1,
    maxEmployees: 10,
    trialDays: 14,
    trialStoreLimit: 1,
    isActive: true,
    isPlaceholder: true,
    features: ["basicDashboard", "locationManagement", "teamManagement"],
    limits: { orders_per_month: 500, menu_items: 100 },
  },
  {
    id: "growth",
    name: "Growth",
    description: "Scale to multiple locations with advanced features",
    priceMonthlyUsd: 79,
    priceAnnualUsd: 790,
    maxLocations: 5,
    maxEmployees: 50,
    trialDays: 14,
    trialStoreLimit: 2,
    isActive: true,
    isPlaceholder: true,
    features: [
      "basicDashboard",
      "locationManagement",
      "teamManagement",
      "brandCustomization",
      "advancedAnalytics",
      "multiLocation",
    ],
    limits: { orders_per_month: 5000, menu_items: 500 },
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "Unlimited scale with dedicated support and SLA",
    priceMonthlyUsd: 199,
    priceAnnualUsd: 1990,
    maxLocations: 999,
    maxEmployees: 9999,
    trialDays: 30,
    trialStoreLimit: 5,
    isActive: true,
    isPlaceholder: true,
    features: PLAN_FEATURES.map((f) => f.key),
    limits: { orders_per_month: -1, menu_items: -1 },
  },
];

const planDrafts: Map<PlanId, Partial<FullPlanDef>> = new Map();
let planChangeHistory: PlanChangeEntry[] = [];
const planActiveState: Map<PlanId, boolean> = new Map([
  ["starter", true],
  ["growth", true],
  ["enterprise", true],
]);

export function getPlanFeatures(): PlanFeature[] {
  return [...PLAN_FEATURES];
}

export async function listFullPlans(): Promise<FullPlanDef[]> {
  const dbPlans = await listPlans();
  return DEFAULT_PLANS.map((dp) => {
    const db = dbPlans.find((p) => p.id === dp.id);
    const draft = planDrafts.get(dp.id);
    const active = planActiveState.get(dp.id) ?? dp.isActive;
    return {
      ...dp,
      ...(db
        ? {
            priceMonthlyUsd: db.price_per_location_cents / 100,
            maxLocations: db.default_store_limit,
            trialDays: db.trial_days,
            trialStoreLimit: db.trial_store_limit,
            isPlaceholder: db.is_placeholder_pricing,
          }
        : {}),
      isActive: active,
      ...(draft ?? {}),
    };
  });
}

export function savePlanDraft(
  planId: PlanId,
  changes: Partial<FullPlanDef>,
  reason: string,
  actorEmail: string,
): PlanChangeEntry[] {
  if (reason.trim().length < 3) throw new Error("reason_required");
  const existing = planDrafts.get(planId) ?? {};
  const merged = { ...existing, ...changes };
  planDrafts.set(planId, merged);

  const entries: PlanChangeEntry[] = Object.entries(changes).map(([field, newValue]) => ({
    id: `pch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    planId,
    field,
    oldValue: String(
      (DEFAULT_PLANS.find((p) => p.id === planId) as Record<string, unknown> | undefined)?.[
        field
      ] ?? "",
    ),
    newValue: String(newValue),
    reason,
    status: "draft" as const,
    actorEmail,
    createdAt: new Date().toISOString(),
  }));
  planChangeHistory = [...entries, ...planChangeHistory];
  return entries;
}

export function publishPlanDraft(
  planId: PlanId,
  reason: string,
  actorEmail: string,
): PlanChangeEntry[] {
  if (reason.trim().length < 3) throw new Error("reason_required");
  const draft = planDrafts.get(planId);
  if (!draft || Object.keys(draft).length === 0) throw new Error("not_found");
  const published = planChangeHistory
    .filter((e) => e.planId === planId && e.status === "draft")
    .map((e) => ({ ...e, status: "published" as const }));
  planChangeHistory = planChangeHistory.map((e) => {
    if (e.planId === planId && e.status === "draft") return { ...e, status: "published" as const };
    return e;
  });
  return published;
}

export function discardPlanDraft(planId: PlanId): void {
  planDrafts.delete(planId);
  planChangeHistory = planChangeHistory.filter(
    (e) => !(e.planId === planId && e.status === "draft"),
  );
}

export function togglePlanActive(
  planId: PlanId,
  active: boolean,
  reason: string,
  actorEmail: string,
): PlanChangeEntry {
  if (reason.trim().length < 3) throw new Error("reason_required");
  planActiveState.set(planId, active);
  const entry: PlanChangeEntry = {
    id: `pch-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    planId,
    field: "isActive",
    oldValue: String(!active),
    newValue: String(active),
    reason,
    status: "published",
    actorEmail,
    createdAt: new Date().toISOString(),
  };
  planChangeHistory = [entry, ...planChangeHistory];
  return entry;
}

export function getPlanChangeHistory(planId?: PlanId): PlanChangeEntry[] {
  if (planId) return planChangeHistory.filter((e) => e.planId === planId);
  return [...planChangeHistory];
}

export function hasPlanDraft(planId: PlanId): boolean {
  const d = planDrafts.get(planId);
  return !!d && Object.keys(d).length > 0;
}

export async function simulatePlanImpact(
  planId: PlanId,
  changes: Partial<FullPlanDef>,
): Promise<PlanImpactSummary> {
  const orgs = await listOrganizations();
  const affected = orgs.filter((o) => o.plan === planId && !o.is_demo);
  const details: string[] = [];
  if (changes.maxLocations !== undefined) {
    const overLimit = affected.filter((o) => o.store_count > (changes.maxLocations ?? 999));
    if (overLimit.length > 0)
      details.push(`${overLimit.length} org(s) would exceed new location limit`);
  }
  if (changes.priceMonthlyUsd !== undefined) {
    details.push(
      `Price change affects ${affected.length} active subscription(s) (simulation only)`,
    );
  }
  if (changes.maxEmployees !== undefined) {
    details.push(`Employee limit change affects ${affected.length} org(s)`);
  }
  return {
    planId,
    affectedOrgs: affected.length,
    affectedLocations: affected.reduce((s, o) => s + o.store_count, 0),
    details,
  };
}

/** Round-trip latency to the backend authorization check (integration health). */
export async function pingBackend() {
  const t0 = performance.now();
  const ok = await call<boolean>("is_platform_admin");
  if (!ok) throw new Error("forbidden");
  return { ok: true, ms: Math.round(performance.now() - t0) };
}
