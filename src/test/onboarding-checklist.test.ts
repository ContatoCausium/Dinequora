import { describe, expect, it } from "vitest";
import { canAdvance, onboardingChecklist } from "@/lib/onboarding-checklist";

const base = {
  brandEdited: false,
  locations: [{ address: "", hours: {} }],
  memberCount: 1,
  pendingInvites: 0,
  persistedStep: 0,
};

describe("onboarding checklist", () => {
  it("does not complete branding just because the step was opened", () => {
    const s = onboardingChecklist(base);
    expect(s[0]).toBe("todo");
    expect(canAdvance(s, 0)).toBe(false);
  });
  it("completes branding once a logo is saved", () => {
    expect(onboardingChecklist({ ...base, logoUrl: "data:x" })[0]).toBe("done");
  });
  it("requires a store with address and hours", () => {
    expect(
      onboardingChecklist({ ...base, locations: [{ address: "1 Main St", hours: {} }] })[2],
    ).toBe("todo");
    expect(
      onboardingChecklist({
        ...base,
        locations: [{ address: "1 Main St", hours: { mon: { open: "11:00", close: "22:00" } } }],
      })[2],
    ).toBe("done");
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
