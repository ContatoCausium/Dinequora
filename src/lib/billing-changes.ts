/**
 * Plan and billing-period changes of a live subscription (rules approved by the owner of Dinequora,
 * 2026-11-28). Pure: no secrets, no network; shared by the server code, the page and the tests.
 *
 * - Longer period on the same plan (monthly -> 6 months -> yearly): no implementation fee; starts
 *   now, the unused days of the period already paid are credited.
 * - Bigger plan (more locations, e.g. Starter -> Growth): starts now, with credit, plus only the
 *   DIFFERENCE of the implementation fee (what the bigger plan costs minus what was already paid).
 * - Smaller plan or shorter period: at the end of the paid period, never refunded midway.
 * - Bigger plan with a shorter period at once: through support (two opposite rules).
 * - Buying again after a cancellation: the implementation already paid counts, so the same plan
 *   charges no implementation again.
 */
import { PERIOD_MONTHS, isBillingPeriod, type BillingPeriod } from "@/lib/billing-periods";

export type ChangeKind = "same" | "now" | "at_period_end" | "contact_support";

/** A plan's size is its location limit; a period's length its months. */
export function classifyChange(
  current: { storeLimit: number; period: BillingPeriod },
  next: { storeLimit: number; period: BillingPeriod },
): ChangeKind {
  const plan = Math.sign(next.storeLimit - current.storeLimit);
  const period = Math.sign(PERIOD_MONTHS[next.period] - PERIOD_MONTHS[current.period]);
  if (plan === 0 && period === 0) return "same";
  if (plan >= 0 && period >= 0) return "now";
  if (plan <= 0 && period <= 0) return "at_period_end";
  return "contact_support";
}

/** The implementation still owed for a plan, given what this organization already paid. */
export function implementationDueCents(planFeeCents: number, alreadyPaidCents: number): number {
  return Math.max(0, planFeeCents - Math.max(0, alreadyPaidCents));
}

/** dinequora_<plan>_<monthly|semiannual|annual|implementation> -> its parts (null when not ours). */
export function parseLookupKey(
  key: string | null | undefined,
): { planId: string; kind: BillingPeriod | "implementation" } | null {
  const m = /^dinequora_([a-z0-9]+)_(monthly|semiannual|annual|implementation)$/.exec(key ?? "");
  if (!m) return null;
  const kind = m[2]!;
  return {
    planId: m[1]!,
    kind: kind === "implementation" || !isBillingPeriod(kind) ? "implementation" : kind,
  };
}
