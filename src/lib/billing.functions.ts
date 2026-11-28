import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { STRIPE_IN_BUILD } from "./stripe/build-flags";
import { BILLING_PERIODS, type BillingPeriod } from "./billing-periods";
import type {
  BillingMode,
  ChangeResult,
  CheckoutResult,
  PendingChange,
  PortalResult,
} from "./stripe/billing-server";

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
export type { BillingMode, ChangeResult, CheckoutResult, PendingChange, PortalResult };

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

const periodSchema = z.enum(BILLING_PERIODS as [BillingPeriod, ...BillingPeriod[]]);

/**
 * Change the plan or billing period of a live subscription (src/lib/billing-changes.ts): bigger
 * plan or longer period now, with credit and only the implementation difference; smaller plan or
 * shorter period at the end of the paid period. `confirm: false` only previews.
 */
export const changePlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    z.object({
      orgId: z.string().min(1),
      planId: z.string().min(1).max(40),
      period: periodSchema,
      confirm: z.boolean(),
    }),
  )
  .handler(async ({ data, context }): Promise<ChangeResult> =>
    STRIPE_IN_BUILD
      ? (await import("./stripe/billing-server")).changePlanForOwner(context.supabase, data)
      : { status: "not_configured" },
  );

/** The change waiting for the end of the paid period, if any. */
export const getPendingChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ orgId: z.string().min(1) }))
  .handler(async ({ data, context }): Promise<PendingChange> =>
    STRIPE_IN_BUILD
      ? (await import("./stripe/billing-server")).pendingChangeForOwner(context.supabase, data)
      : null,
  );

export const cancelPendingChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(z.object({ orgId: z.string().min(1) }))
  .handler(
    async ({
      data,
      context,
    }): Promise<{ status: "canceled" | "none" | "not_configured" | "unavailable" }> =>
      STRIPE_IN_BUILD
        ? (await import("./stripe/billing-server")).cancelPendingChangeForOwner(
            context.supabase,
            data,
          )
        : { status: "not_configured" },
  );
