/**
 * Billing periods of the subscription (migration 0048; the website's pricing in
 * website/src/config/pricing.ts): monthly, every 6 months (8% off) or yearly (15% off), the longer
 * periods paid upfront. The amounts live in billing_plans; this module only names the periods and
 * picks the right column. Shared by the browser and the server (no secrets, no network).
 */
export type BillingPeriod = "monthly" | "semiannual" | "annual";
export const BILLING_PERIODS: readonly BillingPeriod[] = ["monthly", "semiannual", "annual"];
export const PERIOD_MONTHS: Record<BillingPeriod, number> = {
  monthly: 1,
  semiannual: 6,
  annual: 12,
};

export function isBillingPeriod(v: unknown): v is BillingPeriod {
  return typeof v === "string" && (BILLING_PERIODS as readonly string[]).includes(v);
}

type PlanPrices = {
  monthly_price_cents: number | null;
  semiannual_price_cents?: number | null;
  annual_price_cents?: number | null;
};

/** What the plan charges for one period, in cents; null = the period is not offered. */
export function periodPriceCents(plan: PlanPrices, period: BillingPeriod): number | null {
  if (period === "semiannual") return plan.semiannual_price_cents ?? null;
  if (period === "annual") return plan.annual_price_cents ?? null;
  return plan.monthly_price_cents;
}

/** Savings of a period against paying monthly for the same months, in cents (0 when none). */
export function periodSavingsCents(plan: PlanPrices, period: BillingPeriod): number {
  const charge = periodPriceCents(plan, period);
  if (charge == null || plan.monthly_price_cents == null) return 0;
  return Math.max(0, plan.monthly_price_cents * PERIOD_MONTHS[period] - charge);
}

/** Stripe's recurring interval of a price → our period (null when it is not one we sell). */
export function periodFromRecurring(
  interval: unknown,
  intervalCount: unknown,
): BillingPeriod | null {
  const n = typeof intervalCount === "number" ? intervalCount : 1;
  if (interval === "month" && n === 1) return "monthly";
  if (interval === "month" && n === 6) return "semiannual";
  if (interval === "year" && n === 1) return "annual";
  return null;
}
