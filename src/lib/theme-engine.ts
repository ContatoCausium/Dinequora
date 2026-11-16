import { contrast, ensureContrast, hexToHsl, hsl, readableOn } from "./color";

/**
 * Tenant theme generator. Pure and deterministic: given brand colors it produces
 * the full semantic token set for light or dark mode. Extracted colors are never
 * used blindly for surfaces — neutrals are derived and accent colors are
 * contrast-corrected for text and controls.
 */
export type ThemeTokens = {
  primary: string;
  primaryForeground: string;
  primarySoft: string;
  secondary: string;
  secondaryForeground: string;
  accent: string;
  accentForeground: string;
  background: string;
  foreground: string;
  card: string;
  cardForeground: string;
  muted: string;
  mutedForeground: string;
  border: string;
  input: string;
  focusRing: string;
  chart1: string;
  chart2: string;
  chart3: string;
  chart4: string;
  chart5: string;
  chart6: string;
  sidebarBackground: string;
  sidebarForeground: string;
  sidebarActive: string;
  sidebarActiveForeground: string;
  semanticSuccess: string;
  semanticWarning: string;
  semanticDanger: string;
  semanticInfo: string;
};

export type BrandColors = { primary: string; accent: string };

export const FALLBACK_BRAND: BrandColors = { primary: "#b5452a", accent: "#e2a23b" };

/**
 * "Ember & Sand" design system (approved 2026-11-16). Neutrals are a fixed warm sand scale, so every
 * workspace keeps the same calm surfaces and measured contrast whatever its brand: the brand drives
 * the primary action, its soft tint, focus ring, active navigation and the first chart series.
 * Status colors are reserved (never chart series) and green only ever means success.
 * Values are the hex form of the oklch tokens documented in src/styles.css.
 */
const SAND = {
  light: {
    background: "#fcfbf9", // oklch(0.988 0.003 75)
    card: "#ffffff",
    foreground: "#1d1713", // 0.21 — 17.7:1 on card
    subtle: "#f2f0ec", // 0.955 — secondary/muted surfaces
    mutedForeground: "#68625d", // 0.50 — 6.0:1 on card
    border: "#e5e2df", // 0.915 — decorative borders
    input: "#96918d", // 0.66 — control borders, 3.1:1 (WCAG 1.4.11)
    sidebar: "#f8f6f4", // 0.975
    sidebarForeground: "#4d4642", // 0.40
  },
  dark: {
    background: "#0f0d0b", // oklch(0.16 0.006 60)
    card: "#181513", // 0.20
    foreground: "#f3f1f0",
    subtle: "#24211f", // 0.25
    mutedForeground: "#a8a3a0", // 0.72
    border: "#302d2b", // 0.30
    input: "#6d6864", // 0.52 — control borders, 3.3:1 on card
    sidebar: "#14110f", // 0.18
    sidebarForeground: "#d0cdca",
  },
} as const;

/** Reserved status colors (icon + label always accompany them). */
const STATUS = {
  light: { success: "#187c49", warning: "#945a00", danger: "#be2132", info: "#386695" },
  dark: { success: "#57bc80", warning: "#f2af48", danger: "#f3625d", info: "#79a9db" },
} as const;

/**
 * Categorical chart order after the brand (slot 1), validated for color-vision deficiency and
 * contrast with Ember first (light: #c2512e,#3f6fb5,#1a9a8a,#b47c0c,#9b4f96; dark: #d9653c,…).
 * `chart6` is the previous-period / comparison gray, never a series.
 */
const SERIES = {
  light: ["#3f6fb5", "#1a9a8a", "#b47c0c", "#9b4f96"],
  dark: ["#6a7fdc", "#13a58a", "#c08a1a", "#b168a8"],
} as const;
const PREVIOUS_PERIOD = { light: "#a9a39e", dark: "#76706c" } as const;

/** OKLab ΔE ×100 between two hex colors (the metric of the data-viz palette validator). */
export function deltaE(a: string, b: string): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lab = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => lin(parseInt(hex.slice(i, i + 2), 16))) as [
      number,
      number,
      number,
    ];
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * bl);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * bl);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * bl);
    return [
      0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
      1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
      0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
    ];
  };
  const [x, y] = [lab(a), lab(b)];
  return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!) * 100;
}

/** Below this OKLab ΔE two marks are hard to tell apart even with full color vision. */
export const SERIES_MIN_DELTA_E = 15;

/**
 * Orders the validated series after the tenant's brand (slot 1). Charts read neighbouring slots
 * together, so slots 2 and 3 must be distinguishable from the brand (ΔE ≥ 15): a series that is
 * too close moves later in the order. Every color appears exactly once — nothing is ever repeated.
 */
function seriesAfterBrand(primary: string, palette: readonly string[]): string[] {
  const far = (c: string, others: string[]) =>
    others.every((o) => deltaE(c, o) >= SERIES_MIN_DELTA_E);
  const remaining = [...palette];
  const ordered: string[] = [];
  for (const slot of [0, 1]) {
    const neighbours = slot === 0 ? [primary] : [primary, ordered[0]!];
    const i = remaining.findIndex((c) => far(c, neighbours));
    ordered.push(remaining.splice(i === -1 ? 0 : i, 1)[0]!);
  }
  return [...ordered, ...remaining];
}

export function generateTheme(brand: BrandColors, mode: "light" | "dark"): ThemeTokens {
  const p = hexToHsl(brand.primary);
  const a = hexToHsl(brand.accent);

  if (mode === "light") {
    const n = SAND.light;
    const primary = ensureContrast(brand.primary, n.card, 4.5);
    const primarySoft = hsl(p.h, Math.min(p.s, 0.7), 0.965);
    const accent = hsl(a.h, Math.min(a.s, 0.75), 0.93);
    const [s2, s3, s4, s5] = seriesAfterBrand(primary, SERIES.light);
    return {
      primary,
      primaryForeground: readableOn(primary),
      primarySoft,
      secondary: n.subtle,
      secondaryForeground: n.foreground,
      accent,
      accentForeground: ensureContrast(hsl(a.h, Math.max(a.s, 0.5), 0.3), accent, 4.5),
      background: n.background,
      foreground: n.foreground,
      card: n.card,
      cardForeground: n.foreground,
      muted: n.subtle,
      mutedForeground: ensureContrast(n.mutedForeground, n.background, 4.5),
      border: n.border,
      input: n.input,
      focusRing: primary,
      chart1: primary,
      chart2: s2!,
      chart3: s3!,
      chart4: s4!,
      chart5: s5!,
      chart6: PREVIOUS_PERIOD.light,
      sidebarBackground: n.sidebar,
      sidebarForeground: n.sidebarForeground,
      // Active navigation sits on a raised card surface (border + shadow in the shell); its ink is
      // the regular foreground and the icon takes the brand color.
      sidebarActive: n.card,
      sidebarActiveForeground: n.foreground,
      semanticSuccess: STATUS.light.success,
      semanticWarning: STATUS.light.warning,
      semanticDanger: STATUS.light.danger,
      semanticInfo: STATUS.light.info,
    };
  }

  const n = SAND.dark;
  const primary = ensureContrast(
    hsl(p.h, Math.min(p.s, 0.75), Math.max(p.l, 0.6)),
    n.background,
    5,
  );
  const accent = hsl(a.h, Math.min(a.s, 0.45), 0.18);
  const [s2, s3, s4, s5] = seriesAfterBrand(primary, SERIES.dark);
  return {
    primary,
    primaryForeground: readableOn(primary),
    primarySoft: hsl(p.h, Math.min(p.s, 0.5), 0.17),
    secondary: n.subtle,
    secondaryForeground: n.foreground,
    accent,
    accentForeground: ensureContrast(hsl(a.h, Math.min(a.s, 0.8), 0.78), accent, 4.5),
    background: n.background,
    foreground: n.foreground,
    card: n.card,
    cardForeground: n.foreground,
    muted: n.subtle,
    mutedForeground: ensureContrast(n.mutedForeground, n.background, 4.5),
    border: n.border,
    input: n.input,
    focusRing: primary,
    chart1: primary,
    chart2: s2!,
    chart3: s3!,
    chart4: s4!,
    chart5: s5!,
    chart6: PREVIOUS_PERIOD.dark,
    sidebarBackground: n.sidebar,
    sidebarForeground: n.sidebarForeground,
    sidebarActive: n.subtle,
    sidebarActiveForeground: n.foreground,
    semanticSuccess: STATUS.dark.success,
    semanticWarning: STATUS.dark.warning,
    semanticDanger: STATUS.dark.danger,
    semanticInfo: STATUS.dark.info,
  };
}

const VAR_MAP: Record<keyof ThemeTokens, string[]> = {
  primary: ["--primary", "--sidebar-primary"],
  primaryForeground: ["--primary-foreground", "--sidebar-primary-foreground"],
  primarySoft: ["--primary-soft"],
  secondary: ["--secondary"],
  secondaryForeground: ["--secondary-foreground"],
  accent: ["--accent"],
  accentForeground: ["--accent-foreground"],
  background: ["--background"],
  foreground: ["--foreground"],
  card: ["--card", "--popover"],
  cardForeground: ["--card-foreground", "--popover-foreground"],
  muted: ["--muted"],
  mutedForeground: ["--muted-foreground"],
  border: ["--border", "--sidebar-border"],
  input: ["--input"],
  focusRing: ["--ring", "--sidebar-ring"],
  chart1: ["--chart-1"],
  chart2: ["--chart-2"],
  chart3: ["--chart-3"],
  chart4: ["--chart-4"],
  chart5: ["--chart-5"],
  chart6: ["--chart-6"],
  sidebarBackground: ["--sidebar"],
  sidebarForeground: ["--sidebar-foreground"],
  sidebarActive: ["--sidebar-accent"],
  sidebarActiveForeground: ["--sidebar-accent-foreground"],
  semanticSuccess: ["--success"],
  semanticWarning: ["--warning"],
  semanticDanger: ["--destructive"],
  semanticInfo: ["--info"],
};

export function themeToCssVars(t: ThemeTokens): Record<string, string> {
  const out: Record<string, string> = {};
  (Object.keys(VAR_MAP) as (keyof ThemeTokens)[]).forEach((k) => {
    VAR_MAP[k].forEach((v) => (out[v] = t[k]));
  });
  out["--destructive-foreground"] = readableOn(t.semanticDanger);
  return out;
}

export type ContrastCheck = {
  key: string;
  fg: string;
  bg: string;
  ratio: number;
  pass: boolean;
  target: number;
};

export function contrastReport(t: ThemeTokens): ContrastCheck[] {
  const rows: [string, string, string, number][] = [
    ["bodyText", t.foreground, t.background, 4.5],
    ["mutedText", t.mutedForeground, t.background, 4.5],
    ["primaryButton", t.primaryForeground, t.primary, 4.5],
    ["accentChip", t.accentForeground, t.accent, 4.5],
    ["sidebarActive", t.sidebarActiveForeground, t.sidebarActive, 4.5],
    ["focusRing", t.focusRing, t.background, 3],
  ];
  return rows.map(([key, fg, bg, target]) => {
    const ratio = contrast(fg, bg);
    return { key, fg, bg, ratio, pass: ratio >= target, target };
  });
}
