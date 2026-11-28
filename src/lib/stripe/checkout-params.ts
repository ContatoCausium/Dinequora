import type { BillingPeriod } from "@/lib/billing-periods";

/** Stripe Checkout request and price lookup keys (pure; shared by the server code and the tests). */
export const subscriptionLookupKey = (planId: string, period: BillingPeriod) =>
  `dinequora_${planId}_${period}`;
export const monthlyLookupKey = (planId: string) => subscriptionLookupKey(planId, "monthly");
export const implementationLookupKey = (planId: string) => `dinequora_${planId}_implementation`;

/** The Checkout Session request (pure, tested). */
export function buildCheckoutParams(input: {
  orgId: string;
  planId: string;
  period: BillingPeriod;
  subscriptionPriceId: string;
  implementationPriceId: string | null;
  customerId: string | null;
  email: string | null;
  origin: string;
}) {
  const metadata = { org_id: input.orgId, plan_id: input.planId, billing_period: input.period };
  const lineItems: { price: string; quantity: number }[] = [
    { price: input.subscriptionPriceId, quantity: 1 },
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
