import { describe, expect, it } from "vitest";
import { canAdvance, onboardingChecklist, type ChecklistInput } from "@/lib/onboarding-checklist";

const base: ChecklistInput = {
  brandEdited: false,
  locations: [{ address: "", hours: {}, taxRatePpm: null }],
  memberCount: 1,
  pendingInvites: 0,
  persistedStep: 0,
};
const hours = { mon: { open: "11:00", close: "22:00" } };

describe("onboarding checklist", () => {
  it("does not complete branding just because the step was opened", () => {
    const s = onboardingChecklist(base);
    expect(s[0]).toBe("todo");
    expect(canAdvance(s, 0)).toBe(false);
  });
  it("completes branding once a logo is saved", () => {
    expect(onboardingChecklist({ ...base, logoUrl: "data:x" })[0]).toBe("done");
  });
  it("requires a store with address, hours and an explicit sales-tax rate", () => {
    const store = (l: ChecklistInput["locations"][number]) =>
      onboardingChecklist({ ...base, locations: [{ ...base.locations[0], ...l }] })[2];
    expect(store({ address: "1 Main St", taxRatePpm: 62500 })).toBe("todo"); // no hours
    expect(store({ address: "1 Main St", hours })).toBe("todo"); // rate not configured
    expect(store({ address: "1 Main St", hours, taxRatePpm: undefined })).toBe("todo");
    expect(store({ hours, taxRatePpm: 62500 })).toBe("todo"); // no address
    expect(store({ address: "1 Main St", hours, taxRatePpm: 62500 })).toBe("done");
    expect(store({ address: "1 Main St", hours, taxRatePpm: 0 })).toBe("done"); // explicit 0%
  });
  it("cannot advance from the stores step while the only store has no rate", () => {
    const s = onboardingChecklist({
      ...base,
      logoUrl: "x",
      persistedStep: 2,
      locations: [{ address: "1 Main St", hours, taxRatePpm: null }],
    });
    expect(s[2]).toBe("todo");
    expect(canAdvance(s, 2)).toBe(false);
  });
  it("lets optional team step be skipped and marks it skipped, not done", () => {
    const s = onboardingChecklist({ ...base, persistedStep: 4 });
    expect(canAdvance(s, 3)).toBe(true);
    expect(s[3]).toBe("skipped");
  });
  it("cannot finish without both required steps", () => {
    const s = onboardingChecklist({ ...base, logoUrl: "x", persistedStep: 4 });
    expect(canAdvance(s, 4)).toBe(false);
  });
});
