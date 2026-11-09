import { describe, expect, it } from "vitest";
import { resolveLogo } from "@/lib/org-service";

describe("resolveLogo", () => {
  it("uses the stored logo when present", () => {
    expect(resolveLogo("data:image/png;base64,x", null, "sample.png")).toBe(
      "data:image/png;base64,x",
    );
  });
  it("falls back to the sample logo only when branding was never edited", () => {
    expect(resolveLogo(null, null, "sample.png")).toBe("sample.png");
  });
  it("does not restore the sample logo after the owner removed the logo", () => {
    expect(
      resolveLogo(null, { primary: "#000000", accent: "#ffffff" }, "sample.png"),
    ).toBeUndefined();
  });
});
