export const API_VERSION: string;
export const PLANS: { id: string; name: string; monthly: number; implementation: number }[];
export const WEBHOOK_EVENTS: string[];
export function lookupKeys(planId: string): { monthly: string; implementation: string };
export function productName(plan: { name: string }, kind: "monthly" | "implementation"): string;
