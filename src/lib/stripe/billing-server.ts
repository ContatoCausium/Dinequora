import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { stripeKeyMode, stripeRequest, StripeApiError } from "./stripe-api";
import { periodPriceCents, type BillingPeriod } from "@/lib/billing-periods";
import {
  buildCheckoutParams,
  implementationLookupKey,
  subscriptionLookupKey,
} from "./checkout-params";

/**
 * Server-only Stripe Billing logic (reads the STRIPE_* Worker secrets). Loaded by
 * src/lib/billing.functions.ts only in builds that include Stripe (build-flags.ts): the client
 * preview bundle never contains it.
 */
export type BillingMode = "off" | "test" | "live";

/** Whether checkout can run, from the server environment only. */
export function billingMode(env: Record<string, string | undefined>): BillingMode {
  const mode = stripeKeyMode(env["STRIPE_SECRET_KEY"]);
  if (!mode || !env["STRIPE_WEBHOOK_SECRET"]) return "off";
  if (mode === "live" && env["STRIPE_LIVE_ENABLED"] !== "true") return "off";
  return mode;
}

export type CheckoutResult =
  | { status: "redirect"; url: string }
  | { status: "not_configured" | "already_subscribed" | "plan_unavailable" | "unavailable" };

export type PortalResult =
  | { status: "redirect"; url: string }
  | { status: "not_configured" | "no_customer" | "unavailable" };

type Sub = {
  plan_id: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

/** Owner of the organization, read as the signed-in user (RLS + is_org_owner). */
async function requireOwner(client: SupabaseClient<Database>, orgId: string): Promise<Sub | null> {
  if (!z.string().uuid().safeParse(orgId).success) throw new Error("forbidden");
  const owner = await client.rpc("is_org_owner", { _org_id: orgId });
  if (owner.error || owner.data !== true) throw new Error("owner_only");
  const { data, error } = await client
    .from("subscriptions")
    .select("plan_id, status, stripe_customer_id, stripe_subscription_id")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error("billing_unavailable");
  return data;
}

export async function startCheckoutForOwner(
  client: SupabaseClient<Database>,
  input: { orgId: string; planId: string; period?: BillingPeriod },
  origin: string,
  env: Record<string, string | undefined> = process.env,
): Promise<CheckoutResult> {
  const period: BillingPeriod = input.period ?? "monthly";
  if (billingMode(env) === "off") return { status: "not_configured" };
  const key = env["STRIPE_SECRET_KEY"]!;
  const sub = await requireOwner(client, input.orgId);
  // A live Stripe subscription is changed in the portal, never by a second checkout.
  if (sub?.stripe_subscription_id && !["canceled", "incomplete_expired"].includes(sub.status))
    return { status: "already_subscribed" };

  const plan = await client
    .from("billing_plans")
    .select(
      "id, monthly_price_cents, semiannual_price_cents, annual_price_cents, implementation_fee_cents, implementation_fee_is_minimum, active",
    )
    .eq("id", input.planId)
    .maybeSingle();
  // Contract plans (no monthly price, or an implementation fee "from") go through sales, and a
  // period the plan does not offer (no price for it) cannot be bought.
  const charge = plan.data ? periodPriceCents(plan.data, period) : null;
  if (
    plan.error ||
    !plan.data ||
    plan.data.active === false ||
    plan.data.monthly_price_cents == null ||
    charge == null ||
    plan.data.implementation_fee_is_minimum
  )
    return { status: "plan_unavailable" };
  const fee = plan.data.implementation_fee_cents;

  try {
    const wanted = [subscriptionLookupKey(input.planId, period)];
    if (fee > 0) wanted.push(implementationLookupKey(input.planId));
    const prices = await stripeRequest<{
      data: { id: string; lookup_key: string | null; unit_amount: number | null }[];
    }>(key, "GET", "/v1/prices", { active: true, lookup_keys: wanted, limit: 10 });
    const byKey = new Map(prices.data.map((p) => [p.lookup_key, p]));
    const recurring = byKey.get(subscriptionLookupKey(input.planId, period));
    const impl = byKey.get(implementationLookupKey(input.planId));
    // Stripe's price must be the plan's price: never charge an amount the app does not show.
    if (!recurring || recurring.unit_amount !== charge) return { status: "plan_unavailable" };
    if (fee > 0 && (!impl || impl.unit_amount !== fee)) return { status: "plan_unavailable" };

    const { data: user } = await client.auth.getUser();
    const session = await stripeRequest<{ url: string | null }>(
      key,
      "POST",
      "/v1/checkout/sessions",
      buildCheckoutParams({
        orgId: input.orgId,
        planId: input.planId,
        period,
        subscriptionPriceId: recurring.id,
        implementationPriceId: fee > 0 && impl ? impl.id : null,
        customerId: sub?.stripe_customer_id ?? null,
        email: user.user?.email ?? null,
        origin,
      }),
    );
    return session.url ? { status: "redirect", url: session.url } : { status: "unavailable" };
  } catch (e) {
    if (e instanceof StripeApiError) return { status: "unavailable" };
    throw e;
  }
}

export async function openPortalForOwner(
  client: SupabaseClient<Database>,
  input: { orgId: string },
  origin: string,
  env: Record<string, string | undefined> = process.env,
): Promise<PortalResult> {
  if (billingMode(env) === "off") return { status: "not_configured" };
  const sub = await requireOwner(client, input.orgId);
  if (!sub?.stripe_customer_id) return { status: "no_customer" };
  try {
    const session = await stripeRequest<{ url: string }>(
      env["STRIPE_SECRET_KEY"]!,
      "POST",
      "/v1/billing_portal/sessions",
      { customer: sub.stripe_customer_id, return_url: `${origin}/settings/billing` },
    );
    return { status: "redirect", url: session.url };
  } catch (e) {
    if (e instanceof StripeApiError) return { status: "unavailable" };
    throw e;
  }
}
