import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Database } from "@/integrations/supabase/types";
import type { SupabaseClient } from "@supabase/supabase-js";
import { stripeKeyMode, stripeRequest, StripeApiError } from "./stripe/stripe-api";

/**
 * Stripe Billing for the Dinequora subscription (docs/billing-and-entitlements.md).
 *
 * - Checkout: the owner picks a plan; the server creates a Stripe Checkout Session (monthly price +
 *   the one-time implementation fee on the first invoice) and the browser is only redirected. The
 *   browser never reports success: the subscription changes only through the signed webhook.
 * - Portal: the owner manages card, invoices and cancellation in Stripe's billing portal.
 *
 * Prices live in Stripe under lookup keys (scripts/stripe/setup-catalog.mjs), the same amounts as
 * billing_plans (0047). Off until the server has STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET; live
 * keys are refused unless STRIPE_LIVE_ENABLED is exactly "true".
 */
export const monthlyLookupKey = (planId: string) => `dinequora_${planId}_monthly`;
export const implementationLookupKey = (planId: string) => `dinequora_${planId}_implementation`;

export type BillingMode = "off" | "test" | "live";

/** Whether checkout can run, from the server environment only. */
export function billingMode(env: Record<string, string | undefined>): BillingMode {
  const mode = stripeKeyMode(env["STRIPE_SECRET_KEY"]);
  if (!mode || !env["STRIPE_WEBHOOK_SECRET"]) return "off";
  if (mode === "live" && env["STRIPE_LIVE_ENABLED"] !== "true") return "off";
  return mode;
}

/** The Checkout Session request (pure, tested). */
export function buildCheckoutParams(input: {
  orgId: string;
  planId: string;
  monthlyPriceId: string;
  implementationPriceId: string | null;
  customerId: string | null;
  email: string | null;
  origin: string;
}) {
  const metadata = { org_id: input.orgId, plan_id: input.planId };
  const lineItems: { price: string; quantity: number }[] = [
    { price: input.monthlyPriceId, quantity: 1 },
  ];
  if (input.implementationPriceId)
    lineItems.push({ price: input.implementationPriceId, quantity: 1 });
  return {
    mode: "subscription",
    line_items: lineItems,
    client_reference_id: input.orgId,
    metadata,
    subscription_data: { metadata },
    ...(input.customerId
      ? { customer: input.customerId }
      : input.email
        ? { customer_email: input.email }
        : {}),
    billing_address_collection: "auto",
    success_url: `${input.origin}/settings/billing?checkout=success`,
    cancel_url: `${input.origin}/settings/billing?checkout=canceled`,
  };
}

type OwnerContext = {
  orgDbId: string;
  sub: {
    plan_id: string;
    status: string;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
  } | null;
};

/** Owner of the organization, read as the signed-in user (RLS + is_org_owner). */
async function requireOwner(
  client: SupabaseClient<Database>,
  orgId: string,
): Promise<OwnerContext> {
  if (!z.string().uuid().safeParse(orgId).success) throw new Error("forbidden");
  const owner = await client.rpc("is_org_owner", { _org_id: orgId });
  if (owner.error || owner.data !== true) throw new Error("owner_only");
  const { data, error } = await client
    .from("subscriptions")
    .select("plan_id, status, stripe_customer_id, stripe_subscription_id")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error("billing_unavailable");
  return { orgDbId: orgId, sub: data };
}

/** Same origin as the request: Stripe sends the owner back to the app they came from. */
function requestOrigin(): string {
  return new URL(getRequest().url).origin;
}

export const getBillingMode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ mode: BillingMode }> => ({ mode: billingMode(process.env) }));

export type CheckoutResult =
  | { status: "redirect"; url: string }
  | { status: "not_configured" | "already_subscribed" | "plan_unavailable" | "unavailable" };

export const startCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ orgId: z.string().min(1), planId: z.string().min(1).max(40) }))
  .handler(async ({ data, context }): Promise<CheckoutResult> => {
    if (billingMode(process.env) === "off") return { status: "not_configured" };
    const key = process.env["STRIPE_SECRET_KEY"]!;
    const c = context.supabase;
    const { orgDbId, sub } = await requireOwner(c, data.orgId);
    // A live Stripe subscription is changed in the portal, never by a second checkout.
    if (sub?.stripe_subscription_id && !["canceled", "incomplete_expired"].includes(sub.status))
      return { status: "already_subscribed" };

    const plan = await c
      .from("billing_plans")
      .select(
        "id, monthly_price_cents, implementation_fee_cents, implementation_fee_is_minimum, active",
      )
      .eq("id", data.planId)
      .maybeSingle();
    // Contract plans (no monthly price, or an implementation fee "from") go through sales.
    if (
      plan.error ||
      !plan.data ||
      plan.data.active === false ||
      plan.data.monthly_price_cents == null ||
      plan.data.implementation_fee_is_minimum
    )
      return { status: "plan_unavailable" };

    try {
      const wanted = [monthlyLookupKey(data.planId)];
      if (plan.data.implementation_fee_cents > 0) wanted.push(implementationLookupKey(data.planId));
      const prices = await stripeRequest<{
        data: { id: string; lookup_key: string | null; unit_amount: number | null }[];
      }>(key, "GET", "/v1/prices", { active: true, lookup_keys: wanted, limit: 10 });
      const byKey = new Map(prices.data.map((p) => [p.lookup_key, p]));
      const monthly = byKey.get(monthlyLookupKey(data.planId));
      const impl = byKey.get(implementationLookupKey(data.planId)) ?? null;
      // Stripe's price must be the plan's price: never charge an amount the app does not show.
      if (!monthly || monthly.unit_amount !== plan.data.monthly_price_cents)
        return { status: "plan_unavailable" };
      if (
        plan.data.implementation_fee_cents > 0 &&
        (!impl || impl.unit_amount !== plan.data.implementation_fee_cents)
      )
        return { status: "plan_unavailable" };

      const { data: user } = await c.auth.getUser();
      const session = await stripeRequest<{ url: string | null }>(
        key,
        "POST",
        "/v1/checkout/sessions",
        buildCheckoutParams({
          orgId: orgDbId,
          planId: data.planId,
          monthlyPriceId: monthly.id,
          implementationPriceId: plan.data.implementation_fee_cents > 0 ? impl!.id : null,
          customerId: sub?.stripe_customer_id ?? null,
          email: user.user?.email ?? null,
          origin: requestOrigin(),
        }),
      );
      if (!session.url) return { status: "unavailable" };
      return { status: "redirect", url: session.url };
    } catch (e) {
      if (e instanceof StripeApiError) return { status: "unavailable" };
      throw e;
    }
  });

export type PortalResult =
  | { status: "redirect"; url: string }
  | { status: "not_configured" | "no_customer" | "unavailable" };

export const openBillingPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ orgId: z.string().min(1) }))
  .handler(async ({ data, context }): Promise<PortalResult> => {
    if (billingMode(process.env) === "off") return { status: "not_configured" };
    const { sub } = await requireOwner(context.supabase, data.orgId);
    if (!sub?.stripe_customer_id) return { status: "no_customer" };
    try {
      const session = await stripeRequest<{ url: string }>(
        process.env["STRIPE_SECRET_KEY"]!,
        "POST",
        "/v1/billing_portal/sessions",
        { customer: sub.stripe_customer_id, return_url: `${requestOrigin()}/settings/billing` },
      );
      return { status: "redirect", url: session.url };
    } catch (e) {
      if (e instanceof StripeApiError) return { status: "unavailable" };
      throw e;
    }
  });
