import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { stripeKeyMode, stripeRequest, StripeApiError } from "./stripe-api";
import { periodPriceCents, type BillingPeriod } from "@/lib/billing-periods";
import { classifyChange, implementationDueCents, parseLookupKey } from "@/lib/billing-changes";
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

export type ChangePreview = {
  planId: string;
  period: BillingPeriod;
  /** Price of the new plan for one period. */
  newPriceCents: number;
} & (
  | {
      kind: "now";
      /** Charged today: new period + implementation difference - credit for unused time. */
      amountDueCents: number;
      creditCents: number;
      implementationCents: number;
    }
  | { kind: "at_period_end"; effectiveAt: string | null }
);

export type ChangeResult =
  | ({ status: "preview" } & ChangePreview)
  | { status: "changed" }
  | { status: "scheduled"; effectiveAt: string | null }
  | {
      status:
        | "not_configured"
        | "no_subscription"
        | "same"
        | "contact_support"
        | "plan_unavailable"
        | "too_many_locations"
        | "fix_payment_first"
        | "payment_failed"
        | "unavailable";
    };

export type PendingChange = {
  planId: string;
  period: BillingPeriod;
  effectiveAt: string;
} | null;

type Sub = {
  plan_id: string;
  status: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
};

type Price = { id: string; lookup_key: string | null; unit_amount: number | null; product: string };

type Plan = {
  id: string;
  monthly_price_cents: number | null;
  semiannual_price_cents: number | null;
  annual_price_cents: number | null;
  implementation_fee_cents: number;
  implementation_fee_is_minimum: boolean;
  default_store_limit: number;
  active: boolean;
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

const PLAN_COLUMNS =
  "id, monthly_price_cents, semiannual_price_cents, annual_price_cents, implementation_fee_cents, implementation_fee_is_minimum, default_store_limit, active";

/** A self-serve plan and the price of the period; null when it cannot be bought online. */
async function loadPlan(
  client: SupabaseClient<Database>,
  planId: string,
  period: BillingPeriod,
): Promise<{ plan: Plan; charge: number } | null> {
  const { data, error } = await client
    .from("billing_plans")
    .select(PLAN_COLUMNS)
    .eq("id", planId)
    .maybeSingle();
  // Contract plans (no monthly price, or an implementation fee "from") go through sales, and a
  // period the plan does not offer (no price for it) cannot be bought.
  const plan = data as Plan | null;
  const charge = plan ? periodPriceCents(plan, period) : null;
  if (
    error ||
    !plan ||
    plan.active === false ||
    plan.monthly_price_cents == null ||
    charge == null ||
    plan.implementation_fee_is_minimum
  )
    return null;
  return { plan, charge };
}

async function loadPrices(key: string, lookupKeys: string[]): Promise<Map<string, Price>> {
  const prices = await stripeRequest<{ data: Price[] }>(key, "GET", "/v1/prices", {
    active: true,
    lookup_keys: lookupKeys,
    limit: 20,
  });
  return new Map(prices.data.filter((p) => p.lookup_key).map((p) => [p.lookup_key!, p]));
}

/** Implementation products of every self-serve plan (to recognise what was already paid). */
async function implementationProducts(
  client: SupabaseClient<Database>,
  key: string,
): Promise<{ products: Set<string>; prices: Map<string, Price> }> {
  const { data } = await client.from("billing_plans").select("id").eq("active", true);
  const keys = (data ?? []).map((p) => implementationLookupKey(p.id));
  const prices = keys.length ? await loadPrices(key, keys) : new Map<string, Price>();
  return { products: new Set([...prices.values()].map((p) => p.product)), prices };
}

type InvoiceLine = {
  amount: number;
  pricing?: { price_details?: { product?: string } } | null;
  price?: { product?: string } | null;
};

/** Implementation already paid by this customer: paid invoice lines on an implementation product. */
async function implementationPaidCents(
  key: string,
  customerId: string | null,
  products: Set<string>,
): Promise<number> {
  if (!customerId || products.size === 0) return 0;
  const invoices = await stripeRequest<{ data: { lines: { data: InvoiceLine[] } }[] }>(
    key,
    "GET",
    "/v1/invoices",
    { customer: customerId, status: "paid", limit: 100 },
  );
  let paid = 0;
  for (const inv of invoices.data)
    for (const line of inv.lines.data) {
      const product = line.pricing?.price_details?.product ?? line.price?.product;
      if (product && products.has(product)) paid += line.amount;
    }
  return paid;
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
  // A live Stripe subscription is changed with changePlanForOwner, never by a second checkout.
  if (sub?.stripe_subscription_id && !["canceled", "incomplete_expired"].includes(sub.status))
    return { status: "already_subscribed" };

  const loaded = await loadPlan(client, input.planId, period);
  if (!loaded) return { status: "plan_unavailable" };
  const { plan, charge } = loaded;
  const fee = plan.implementation_fee_cents;

  try {
    const prices = await loadPrices(key, [
      subscriptionLookupKey(input.planId, period),
      implementationLookupKey(input.planId),
    ]);
    const recurring = prices.get(subscriptionLookupKey(input.planId, period));
    const impl = prices.get(implementationLookupKey(input.planId));
    // Stripe's price must be the plan's price: never charge an amount the app does not show.
    if (!recurring || recurring.unit_amount !== charge) return { status: "plan_unavailable" };
    if (fee > 0 && (!impl || impl.unit_amount !== fee)) return { status: "plan_unavailable" };

    // Bought again after a cancellation: the implementation already paid counts.
    const customerId = sub?.stripe_customer_id ?? null;
    const paid = customerId
      ? await implementationPaidCents(
          key,
          customerId,
          (await implementationProducts(client, key)).products,
        )
      : 0;
    const due = implementationDueCents(fee, paid);

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
        implementation:
          !impl || due <= 0
            ? null
            : due === fee
              ? { price: impl.id }
              : { product: impl.product, amountCents: due },
        customerId,
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

type StripeSub = {
  id: string;
  status: string;
  customer: string;
  schedule: string | null;
  items: {
    data: {
      id: string;
      current_period_end?: number;
      price: { id: string; lookup_key: string | null };
    }[];
  };
};

type Schedule = {
  id: string;
  phases: {
    start_date: number;
    end_date: number | null;
    items: { price: string | { id: string } }[];
  }[];
};

const iso = (unix: number | null | undefined) =>
  typeof unix === "number" ? new Date(unix * 1000).toISOString() : null;

async function releaseSchedule(key: string, scheduleId: string | null) {
  if (scheduleId)
    await stripeRequest(key, "POST", `/v1/subscription_schedules/${scheduleId}/release`);
}

/**
 * Changes the plan and/or billing period of a live subscription (rules in billing-changes.ts).
 * `confirm: false` only previews (nothing changes); `confirm: true` applies:
 * - now: price swapped today, unused time credited, implementation difference added, charged at
 *   once (refused, and nothing changed, when the card is declined);
 * - at_period_end: a subscription schedule switches the price at the end of the paid period.
 */
export async function changePlanForOwner(
  client: SupabaseClient<Database>,
  input: { orgId: string; planId: string; period: BillingPeriod; confirm: boolean },
  env: Record<string, string | undefined> = process.env,
): Promise<ChangeResult> {
  if (billingMode(env) === "off") return { status: "not_configured" };
  const key = env["STRIPE_SECRET_KEY"]!;
  const row = await requireOwner(client, input.orgId);
  if (!row?.stripe_subscription_id || ["canceled", "incomplete_expired"].includes(row.status))
    return { status: "no_subscription" };

  const target = await loadPlan(client, input.planId, input.period);
  if (!target) return { status: "plan_unavailable" };

  try {
    const sub = await stripeRequest<StripeSub>(
      key,
      "GET",
      `/v1/subscriptions/${row.stripe_subscription_id}`,
    );
    if (sub.status === "past_due" || sub.status === "unpaid" || sub.status === "incomplete")
      return { status: "fix_payment_first" };
    if (sub.status !== "active" && sub.status !== "trialing") return { status: "no_subscription" };
    const item = sub.items.data[0];
    const current = parseLookupKey(item?.price.lookup_key);
    if (!item || !current || current.kind === "implementation") return { status: "unavailable" };
    const currentPlan = await client
      .from("billing_plans")
      .select("default_store_limit, implementation_fee_cents")
      .eq("id", current.planId)
      .maybeSingle();
    if (currentPlan.error || !currentPlan.data) return { status: "unavailable" };

    const kind = classifyChange(
      { storeLimit: currentPlan.data.default_store_limit, period: current.kind },
      { storeLimit: target.plan.default_store_limit, period: input.period },
    );
    if (kind === "same") return { status: "same" };
    if (kind === "contact_support") return { status: "contact_support" };

    // A smaller plan must fit the locations in use (inactive ones are free).
    if (target.plan.default_store_limit < currentPlan.data.default_store_limit) {
      const { data: stores } = await client
        .from("locations")
        .select("status")
        .eq("org_id", input.orgId);
      const inUse = (stores ?? []).filter((s) => s.status !== "inactive").length;
      if (inUse > target.plan.default_store_limit) return { status: "too_many_locations" };
    }

    const prices = await loadPrices(key, [subscriptionLookupKey(input.planId, input.period)]);
    const price = prices.get(subscriptionLookupKey(input.planId, input.period));
    if (!price || price.unit_amount !== target.charge) return { status: "plan_unavailable" };
    const metadata = {
      org_id: input.orgId,
      plan_id: input.planId,
      billing_period: input.period,
    };
    const base = { planId: input.planId, period: input.period, newPriceCents: target.charge };

    if (kind === "at_period_end") {
      const effectiveAt = iso(item.current_period_end);
      if (!input.confirm) return { status: "preview", kind: "at_period_end", effectiveAt, ...base };
      await releaseSchedule(key, sub.schedule);
      const schedule = await stripeRequest<Schedule>(key, "POST", "/v1/subscription_schedules", {
        from_subscription: sub.id,
      });
      const now = schedule.phases[0]!;
      const nowPrice =
        typeof now.items[0]!.price === "string" ? now.items[0]!.price : now.items[0]!.price.id;
      await stripeRequest(key, "POST", `/v1/subscription_schedules/${schedule.id}`, {
        end_behavior: "release",
        phases: [
          {
            items: [{ price: nowPrice }],
            start_date: now.start_date,
            end_date: now.end_date,
            metadata: {
              org_id: input.orgId,
              plan_id: current.planId,
              billing_period: current.kind,
            },
          },
          { items: [{ price: price.id }], iterations: 1, metadata },
        ],
      });
      return { status: "scheduled", effectiveAt };
    }

    // Now: a bigger plan owes only the difference of the implementation fee.
    let implementation: { product: string; amountCents: number } | null = null;
    if (target.plan.default_store_limit > currentPlan.data.default_store_limit) {
      const impl = await implementationProducts(client, key);
      const implPrice = impl.prices.get(implementationLookupKey(input.planId));
      const due = implementationDueCents(
        target.plan.implementation_fee_cents,
        await implementationPaidCents(key, sub.customer, impl.products),
      );
      if (due > 0) {
        if (!implPrice) return { status: "plan_unavailable" };
        implementation = { product: implPrice.product, amountCents: due };
      }
    }
    const invoiceItems = implementation
      ? [
          {
            price_data: {
              currency: "usd",
              product: implementation.product,
              unit_amount: implementation.amountCents,
            },
          },
        ]
      : [];

    if (!input.confirm) {
      const preview = await stripeRequest<{
        amount_due: number;
        lines: { data: { amount: number }[] };
      }>(key, "POST", "/v1/invoices/create_preview", {
        customer: sub.customer,
        subscription: sub.id,
        subscription_details: {
          items: [{ id: item.id, price: price.id }],
          proration_behavior: "always_invoice",
        },
        invoice_items: invoiceItems,
      });
      return {
        status: "preview",
        kind: "now",
        ...base,
        amountDueCents: preview.amount_due,
        creditCents: -preview.lines.data
          .filter((l) => l.amount < 0)
          .reduce((sum, l) => sum + l.amount, 0),
        implementationCents: implementation?.amountCents ?? 0,
      };
    }

    // A pending change at period end is replaced by this one.
    await releaseSchedule(key, sub.schedule);
    try {
      await stripeRequest(key, "POST", `/v1/subscriptions/${sub.id}`, {
        items: [{ id: item.id, price: price.id }],
        proration_behavior: "always_invoice",
        payment_behavior: "error_if_incomplete",
        add_invoice_items: invoiceItems,
        metadata,
      });
    } catch (e) {
      if (e instanceof StripeApiError && e.status === 402) return { status: "payment_failed" };
      throw e;
    }
    return { status: "changed" };
  } catch (e) {
    if (e instanceof StripeApiError) return { status: "unavailable" };
    throw e;
  }
}

/** The change waiting for the end of the paid period, if any (from the subscription schedule). */
export async function pendingChangeForOwner(
  client: SupabaseClient<Database>,
  input: { orgId: string },
  env: Record<string, string | undefined> = process.env,
): Promise<PendingChange> {
  if (billingMode(env) === "off") return null;
  const key = env["STRIPE_SECRET_KEY"]!;
  const row = await requireOwner(client, input.orgId);
  if (!row?.stripe_subscription_id) return null;
  try {
    const sub = await stripeRequest<StripeSub>(
      key,
      "GET",
      `/v1/subscriptions/${row.stripe_subscription_id}`,
    );
    if (!sub.schedule) return null;
    const schedule = await stripeRequest<Schedule>(
      key,
      "GET",
      `/v1/subscription_schedules/${sub.schedule}`,
    );
    const now = Date.now() / 1000;
    const next = schedule.phases.find((p) => p.start_date > now);
    const priceRef = next?.items[0]?.price;
    if (!next || !priceRef) return null;
    const price = await stripeRequest<{ lookup_key: string | null }>(
      key,
      "GET",
      `/v1/prices/${typeof priceRef === "string" ? priceRef : priceRef.id}`,
    );
    const parsed = parseLookupKey(price.lookup_key);
    if (!parsed || parsed.kind === "implementation") return null;
    return { planId: parsed.planId, period: parsed.kind, effectiveAt: iso(next.start_date)! };
  } catch (e) {
    if (e instanceof StripeApiError) return null;
    throw e;
  }
}

export async function cancelPendingChangeForOwner(
  client: SupabaseClient<Database>,
  input: { orgId: string },
  env: Record<string, string | undefined> = process.env,
): Promise<{ status: "canceled" | "none" | "not_configured" | "unavailable" }> {
  if (billingMode(env) === "off") return { status: "not_configured" };
  const key = env["STRIPE_SECRET_KEY"]!;
  const row = await requireOwner(client, input.orgId);
  if (!row?.stripe_subscription_id) return { status: "none" };
  try {
    const sub = await stripeRequest<StripeSub>(
      key,
      "GET",
      `/v1/subscriptions/${row.stripe_subscription_id}`,
    );
    if (!sub.schedule) return { status: "none" };
    await releaseSchedule(key, sub.schedule);
    return { status: "canceled" };
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
