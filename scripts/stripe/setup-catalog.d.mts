export const API_VERSION: string;
export type PriceKind = "monthly" | "semiannual" | "annual" | "implementation";
export const PLANS: {
  id: string;
  name: string;
  monthly: number;
  semiannual: number;
  annual: number;
  implementation: number;
}[];
export const RECURRING: Record<
  "monthly" | "semiannual" | "annual",
  { interval: "month" | "year"; interval_count: number }
>;
export const PRICE_KINDS: PriceKind[];
export const WEBHOOK_EVENTS: string[];
export function lookupKeys(planId: string): Record<PriceKind, string>;
export function productName(plan: { name: string }, kind: PriceKind): string;
