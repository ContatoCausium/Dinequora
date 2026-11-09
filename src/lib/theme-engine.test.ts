import { describe, expect, it } from "vitest";
import { contrastReport, generateTheme } from "./theme-engine";

describe("theme engine", () => {
  it("keeps all reported contrast pairs readable for varied logo palettes", () => {
    for (const brand of [
      { primary: "#d6414a", accent: "#f2c540" },
      { primary: "#16707a", accent: "#e04a97" },
      { primary: "#f6e768", accent: "#81d3fe" },
    ]) {
      for (const mode of ["light", "dark"] as const) {
        for (const check of contrastReport(generateTheme(brand, mode))) {
          expect(check.ratio, `${mode}: ${check.key}`).toBeGreaterThanOrEqual(check.target);
        }
      }
    }
  });
  it("keeps primary buttons at WCAG AA contrast in both modes, even for light brand colors", () => {
    for (const mode of ["light", "dark"] as const) {
      const theme = generateTheme({ primary: "#f5e663", accent: "#7fd3ff" }, mode);
      const button = contrastReport(theme).find((r) => r.key === "primaryButton")!;
      expect(button.ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("keeps body text at WCAG AA contrast", () => {
    const theme = generateTheme({ primary: "#d63c46", accent: "#f2a43a" }, "light");
    expect(contrastReport(theme).find((r) => r.key === "bodyText")!.ratio).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});
