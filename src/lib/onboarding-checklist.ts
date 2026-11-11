/** Onboarding status derived from persisted data only — never from clicks. */
export type StepState = "done" | "todo" | "skipped";
export interface ChecklistInput {
  logoUrl?: string | undefined;
  brandEdited: boolean; // previous_brand is set only when an owner saved branding
  locations: {
    address?: string | undefined;
    hours?: Record<string, unknown> | undefined;
    taxRatePpm?: number | null | undefined; // null = sales-tax rate not configured (0025)
  }[];
  memberCount: number;
  pendingInvites: number;
  persistedStep: number; // furthest step the owner confirmed (optional steps can be skipped)
}
export const REQUIRED_STEPS = [0, 2] as const; // branding, stores
export const OPTIONAL_STEPS = [1, 3] as const; // dashboard preview, team

/**
 * A store counts as configured when it has an address, opening hours and an explicit sales-tax
 * rate (0 is explicit; null is "not configured" and the POS refuses to sell). No default rate is
 * ever assumed: the required "stores" step of the onboarding stays open until the owner sets one.
 */
export function storeConfigured(l: ChecklistInput["locations"][number]) {
  return (
    Boolean(l.address?.trim()) &&
    Object.values(l.hours ?? {}).some((h) => h != null) &&
    l.taxRatePpm != null
  );
}

export function onboardingChecklist(i: ChecklistInput): StepState[] {
  const brand = i.brandEdited || Boolean(i.logoUrl);
  const stores = i.locations.some(storeConfigured);
  const team = i.memberCount > 1 || i.pendingInvites > 0;
  const passed = (n: number) => i.persistedStep > n;
  const opt = (done: boolean, n: number): StepState =>
    done ? "done" : passed(n) ? "skipped" : "todo";
  const required = brand && stores;
  return [
    brand ? "done" : "todo",
    opt(passed(1), 1),
    stores ? "done" : "todo",
    opt(team, 3),
    required && passed(3) ? "done" : "todo",
  ];
}

/** The step the owner can advance from, and whether advancing is allowed now. */
export function canAdvance(states: StepState[], step: number): boolean {
  if ((REQUIRED_STEPS as readonly number[]).includes(step)) return states[step] === "done";
  if (step === 4) return states[0] === "done" && states[2] === "done";
  return true; // optional: may continue or skip
}
