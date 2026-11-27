import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  contrastReport,
  deltaE,
  FALLBACK_BRAND,
  SERIES_MIN_DELTA_E,
  generateTheme,
  themeToCssVars,
  type BrandColors,
} from "@/lib/theme-engine";
import { contrast, hexToHsl } from "@/lib/color";

/**
 * "Ember & Sand" design system (approved 2026-11-16): the engine is the source of truth for tokens
 * (it re-applies them at runtime, also for white-label tenants); src/styles.css carries the same
 * values for the first paint. These checks keep both in step and keep contrast measurable.
 */
const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const MODES = ["light", "dark"] as const;
const TENANTS: BrandColors[] = [
  FALLBACK_BRAND,
  { primary: "#2563eb", accent: "#f59e0b" }, // blue
  { primary: "#16a34a", accent: "#0ea5e9" }, // green brand (still never "success" semantics)
  { primary: "#7c3aed", accent: "#22c55e" }, // violet
  { primary: "#e11d48", accent: "#fb923c" }, // rose
  { primary: "#0f172a", accent: "#38bdf8" }, // navy, near black
  { primary: "#f59e0b", accent: "#2563eb" }, // amber, light brand
];

function cssBlock(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start, css.indexOf("}", start));
  return Object.fromEntries(
    [...body.matchAll(/(--[a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]),
  );
}

describe("tokens: styles.css first paint equals the engine's default theme", () => {
  const css = read("src/styles.css");
  it.each(MODES)("%s", (mode) => {
    const block = cssBlock(css, mode === "light" ? ":root" : ".dark");
    const vars = themeToCssVars(generateTheme(FALLBACK_BRAND, mode));
    for (const [k, v] of Object.entries(vars))
      expect(block[k]?.toLowerCase(), k).toBe(v.toLowerCase());
  });
});

describe("contrast holds for the default brand and for tenant brands", () => {
  for (const brand of TENANTS)
    for (const mode of MODES)
      it(`${brand.primary} ${mode}`, () => {
        const t = generateTheme(brand, mode);
        for (const c of contrastReport(t)) expect(c.ratio, c.key).toBeGreaterThanOrEqual(c.target);
        // Control borders (inputs, selects, checkboxes) reach 3:1 (WCAG 1.4.11).
        expect(contrast(t.input, t.card)).toBeGreaterThanOrEqual(3);
        // The previous-period series (comparison columns) is a meaningful graphic: 3:1 on the card.
        expect(contrast(t.chart6, t.card)).toBeGreaterThanOrEqual(3);
        // Status inks are readable on the card surface.
        for (const s of [t.semanticSuccess, t.semanticDanger, t.semanticInfo])
          expect(contrast(s, t.card)).toBeGreaterThanOrEqual(mode === "light" ? 4.5 : 3);
      });
});

describe("chart palette", () => {
  // The demo dataset's own brand (#b4532a) is included: it once made a series repeat.
  const BRANDS = [...TENANTS, { primary: "#b4532a", accent: "#f2a43a" }];
  it("slot 1 is the brand; its neighbours (slots 2, 3) are distinguishable from it", () => {
    for (const brand of BRANDS)
      for (const mode of MODES) {
        const t = generateTheme(brand, mode);
        expect(t.chart1).toBe(t.primary);
        for (const c of [t.chart2, t.chart3])
          expect(deltaE(c, t.primary), `${brand.primary} ${mode} ${c}`).toBeGreaterThanOrEqual(
            SERIES_MIN_DELTA_E,
          );
        expect(deltaE(t.chart2, t.chart3)).toBeGreaterThanOrEqual(SERIES_MIN_DELTA_E);
      }
  });
  it("never repeats a series color, whatever the brand", () => {
    for (const brand of BRANDS)
      for (const mode of MODES) {
        const t = generateTheme(brand, mode);
        const series = [t.chart1, t.chart2, t.chart3, t.chart4, t.chart5];
        expect(new Set(series).size, `${brand.primary} ${mode}`).toBe(5);
      }
  });
  it("the default order is the validated Ember & Sand palette; chart-6 is the comparison gray", () => {
    const l = generateTheme(FALLBACK_BRAND, "light");
    expect([l.chart2, l.chart3, l.chart4, l.chart5]).toEqual([
      "#3f6fb5",
      "#1a9a8a",
      "#b47c0c",
      "#9b4f96",
    ]);
    expect(hexToHsl(l.chart6).s).toBeLessThan(0.1);
  });
});

describe("identity", () => {
  it("success stays green-only semantics and differs from the brand; errors are crimson", () => {
    const t = generateTheme(FALLBACK_BRAND, "light");
    expect(t.semanticSuccess).not.toBe(t.primary);
    expect(t.semanticDanger).not.toBe(t.primary);
    expect(hexToHsl(t.semanticSuccess).h).toBeGreaterThan(120);
  });
  it("the Dinequora mark is Ember (fixed), the favicon too; no green brand color remains", () => {
    expect(read("src/components/app/brand-mark.tsx")).toContain("var(--dinequora-ember, #b5452a)");
    expect(read("public/favicon.svg")).not.toMatch(/#10B981/i);
    expect(read("src/components/app/brand-mark.tsx")).not.toMatch(/#10B981/i);
  });
  it("Geist is self-hosted (no Google Fonts request) and its OFL license ships with it", () => {
    expect(read("src/routes/__root.tsx")).not.toContain("fonts.googleapis.com");
    for (const f of ["geist-latin", "geist-latin-ext", "geist-mono-latin", "geist-mono-latin-ext"])
      expect(fs.existsSync(path.join(root, `public/fonts/geist/${f}.woff2`)), f).toBe(true);
    expect(read("public/fonts/geist/OFL.txt")).toContain("SIL Open Font License");
  });
});
