import { describe, expect, it } from "vitest";
import {
  attentionReasons,
  computeOverview,
  type OrgInsight,
  type PlanDef,
} from "@/lib/platform-metrics";

const plans: PlanDef[] = [
  {
    id: "starter",
    name: "Starter",
    price_per_location_cents: 8900,
    currency: "usd",
    default_store_limit: 1,
    trial_store_limit: 1,
    trial_days: 14,
    is_placeholder_pricing: true,
  },
];
const base: OrgInsight = {
  id: "x",
  name: "X",
  status: "active",
  plan: "starter",
  is_demo: false,
  created_at: "2026-10-01T00:00:00Z",
  store_count: 2,
  active_store_count: 2,
  store_limit: 3,
  has_override: false,
  member_count: 1,
  owner_count: 1,
  owner_email: null,
  pending_invites: 0,
  brand_customized: false,
  sub_status: "active",
  trial_ends_at: null,
  billed_locations: 2,
  billing_connected: false,
  last_activity: null,
};
const NOW = Date.parse("2026-10-23T00:00:00Z");

describe("platform overview", () => {
  it("never reports actual revenue or subscriptions while billing is not connected", () => {
    const o = computeOverview([base], plans, NOW);
    expect(o.actualMrrCents).toBeNull();
    expect(o.actualArrCents).toBeNull();
    expect(o.activeSubscriptions).toBeNull();
  });

  it("excludes demo organizations from customer counts and projections", () => {
    const o = computeOverview([{ ...base, is_demo: true }], plans, NOW);
    expect(o.customers).toBe(0);
    expect(o.demos).toBe(1);
    expect(o.projectedMrrCents).toBe(0);
    expect(o.locations).toBe(0);
  });

  it("counts actual MRR only from provider-synced active subscriptions", () => {
    const o = computeOverview(
      [
        { ...base, billing_connected: true },
        { ...base, id: "y" },
      ],
      plans,
      NOW,
    );
    expect(o.actualMrrCents).toBe(2 * 8900);
    expect(o.actualArrCents).toBe(2 * 8900 * 12);
    expect(o.activeSubscriptions).toBe(1);
  });

  it("flags an expired trial and an unowned customer organization", () => {
    expect(
      attentionReasons(
        { ...base, owner_count: 0, sub_status: "trialing", trial_ends_at: "2026-10-20T00:00:00Z" },
        NOW,
      ),
    ).toEqual(["no_owner", "trial_expired"]);
  });

  it("does not flag missing owners on demo organizations", () => {
    expect(attentionReasons({ ...base, is_demo: true, owner_count: 0 }, NOW)).toEqual([]);
  });
});
