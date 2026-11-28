import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { STRIPE_IN_BUILD } from "./stripe/build-flags";
import { BILLING_PERIODS, type BillingPeriod } from "./billing-periods";
import type { BillingMode, CheckoutResult, PortalResult } from "./stripe/billing-server";

/**
 * Stripe Billing for the Dinequora subscription (docs/billing-and-entitlements.md).
 *
 * - Checkout: the owner picks a plan and a billing period (monthly, 6 months or yearly, 0048); the
 *   server creates a Stripe Checkout Session (the period's price +
 *   the one-time implementation fee on the first invoice) and the browser is only redirected. The
 *   browser never reports success: the subscription changes only through the signed webhook.
 * - Portal: the owner manages card, invoices and cancellation in Stripe's billing portal.
 *
 * The Stripe logic lives in ./stripe/billing-server.ts and is loaded only in builds that include
 * Stripe (never the client preview). Off until the server has the Stripe secret key and the webhook
 * signing secret; live keys stay off unless STRIPE_LIVE_ENABLED is exactly "true".
 */
export type { BillingMode, CheckoutResult, PortalResult };

/** Same origin as the request: Stripe sends the owner back to the app they came from. */
const requestOrigin = () => new URL(getRequest().url).origin;

export const getBillingMode = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<{ mode: BillingMode }> =>
    STRIPE_IN_BUILD
      ? { mode: (await import("./stripe/billing-server")).billingMode(process.env) }
      : { mode: "off" },
  );

export const startCheckout = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      orgId: z.string().min(1),
      planId: z.string().min(1).max(40),
      period: z.enum(BILLING_PERIODS as [BillingPeriod, ...BillingPeriod[]]).default("monthly"),
    }),
  )
  .handler(async ({ data, context }): Promise<CheckoutResult> =>
    STRIPE_IN_BUILD
      ? (await import("./stripe/billing-server")).startCheckoutForOwner(
          context.supabase,
          data,
          requestOrigin(),
        )
      : { status: "not_configured" },
  );

export const openBillingPortal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ orgId: z.string().min(1) }))
  .handler(async ({ data, context }): Promise<PortalResult> =>
    STRIPE_IN_BUILD
      ? (await import("./stripe/billing-server")).openPortalForOwner(
          context.supabase,
          data,
          requestOrigin(),
        )
      : { status: "not_configured" },
  );
