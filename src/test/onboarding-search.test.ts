import { describe, expect, it } from "vitest";
import { onboardingSearch } from "@/lib/onboarding-search";
describe("explicit workspace creation", () => {
  it("accepts numeric direct-link flags without a blank page", () => {
    expect(onboardingSearch.parse({ create: 1 }).create).toBe("1");
  });
  it("does not opt in when the flag is absent", () => {
    expect(onboardingSearch.parse({}).create).toBeUndefined();
  });
});
