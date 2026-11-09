/**
 * Pure Control Center metrics. Demo organizations never count toward customer
 * figures, and revenue is only "actual" when real billing is connected.
 */
export type OrgInsight = {
  id: string;
  name: string;
  status: "trial" | "active" | "suspended";
  plan: string;
  is_demo: boolean;
  created_at: string;
  store_count: number;
  active_store_count: number;
  store_limit: number;
  has_override: boolean;
  member_count: number;
  owner_count: number;
  owner_email: string | null;
  pending_invites: number;
  brand_customized: boolean;
  sub_status: string | null;
  trial_ends_at: string | null;
  billed_locations: number | null;
  billing_connected: boolean;
  last_activity: string | null;
};
export type PlanDef = {
  id: string;
  name: string;
  price_per_location_cents: number;
  currency: string;
  default_store_limit: number;
  trial_store_limit: number;
  trial_days: number;
  is_placeholder_pricing: boolean;
};

export type AttentionReason =
  "suspended" | "no_owner" | "trial_expired" | "trial_ending" | "over_limit" | "past_due";

const DAY = 86_400_000;

export function attentionReasons(o: OrgInsight, now: number): AttentionReason[] {
  const r: AttentionReason[] = [];
  if (o.status === "suspended") r.push("suspended");
  if (!o.is_demo && o.owner_count === 0) r.push("no_owner");
  if (o.sub_status === "trialing" && o.trial_ends_at) {
    const left = new Date(o.trial_ends_at).getTime() - now;
    if (left < 0) r.push("trial_expired");
    else if (left <= 3 * DAY) r.push("trial_ending");
  }
  if (o.active_store_count > o.store_limit) r.push("over_limit");
  if (o.sub_status === "past_due" || o.sub_status === "unpaid") r.push("past_due");
  return r;
}

export function onboardingSteps(o: OrgInsight) {
  return [
    { key: "workspace", done: true },
    { key: "owner", done: o.owner_count > 0 },
    { key: "store", done: o.store_count > 0 },
    { key: "branding", done: o.brand_customized },
    { key: "team", done: o.member_count > 1 || o.pending_invites > 0 },
    { key: "billing", done: o.billing_connected },
  ] as const;
}

export function computeOverview(orgs: OrgInsight[], plans: PlanDef[], now = Date.now()) {
  const customers = orgs.filter((o) => !o.is_demo);
  const demos = orgs.filter((o) => o.is_demo);
  const price = new Map(plans.map((p) => [p.id, p.price_per_location_cents]));
  const billingConnected = customers.some((o) => o.billing_connected);

  // Paying = a real subscription synced from the billing provider. Nothing else counts.
  const paying = customers.filter((o) => o.billing_connected && o.sub_status === "active");
  const actualMrrCents = billingConnected
    ? paying.reduce((a, o) => a + (o.billed_locations ?? 0) * (price.get(o.plan) ?? 0), 0)
    : null;
  // Projection at list prices for customers that would be billed today (never shown as revenue).
  const projectedMrrCents = customers
    .filter(
      (o) => o.status !== "suspended" && o.sub_status !== "trialing" && o.sub_status !== "canceled",
    )
    .reduce((a, o) => a + Math.max(o.active_store_count, 1) * (price.get(o.plan) ?? 0), 0);

  const trialing = customers.filter((o) => o.sub_status === "trialing");
  const expired = trialing.filter(
    (o) => o.trial_ends_at && new Date(o.trial_ends_at).getTime() < now,
  ).length;
  const converted = paying.length;
  const decided = converted + expired;

  return {
    customers: customers.length,
    demos: demos.length,
    active: customers.filter((o) => o.status === "active").length,
    trial: customers.filter((o) => o.status === "trial").length,
    suspended: customers.filter((o) => o.status === "suspended").length,
    locations: customers.reduce((a, o) => a + o.store_count, 0),
    demoLocations: demos.reduce((a, o) => a + o.store_count, 0),
    activeSubscriptions: billingConnected ? paying.length : null,
    billingConnected,
    actualMrrCents,
    actualArrCents: actualMrrCents === null ? null : actualMrrCents * 12,
    projectedMrrCents,
    isProjectionEstimate: true,
    placeholderPricing: plans.some((p) => p.is_placeholder_pricing),
    distribution: plans.map((p) => ({
      plan: p.id,
      customers: customers.filter((o) => o.plan === p.id).length,
      demos: demos.filter((o) => o.plan === p.id).length,
      active: customers.filter((o) => o.plan === p.id && o.status === "active").length,
      trial: customers.filter((o) => o.plan === p.id && o.status === "trial").length,
    })),
    trials: {
      active: trialing.length - expired,
      expired,
      converted,
      rate: decided ? converted / decided : null,
    },
    attention: orgs
      .map((o) => ({ org: o, reasons: attentionReasons(o, now) }))
      .filter((x) => x.reasons.length > 0),
  };
}
