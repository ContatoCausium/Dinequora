/** Stripe Checkout request and price lookup keys (pure; shared by the server code and the tests). */
export const monthlyLookupKey = (planId: string) => `dinequora_${planId}_monthly`;
export const implementationLookupKey = (planId: string) => `dinequora_${planId}_implementation`;

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
