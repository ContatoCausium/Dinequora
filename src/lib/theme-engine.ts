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
};

export type BrandColors = { primary: string; accent: string };

export const FALLBACK_BRAND: BrandColors = { primary: "#b5452a", accent: "#e2a23b" };

export function generateTheme(brand: BrandColors, mode: "light" | "dark"): ThemeTokens {
  const p = hexToHsl(brand.primary);
  const a = hexToHsl(brand.accent);
  const ns = Math.min(p.s, 0.14) * 0.5; // neutral saturation: a whisper of the brand hue

  if (mode === "light") {
    const background = hsl(p.h, ns, 0.985);
    const card = "#ffffff";
    const foreground = hsl(p.h, ns + 0.05, 0.11);
    const primary = ensureContrast(brand.primary, "#ffffff", 4.5);
    const accentFg = ensureContrast(hsl(a.h, Math.max(a.s, 0.5), 0.3), hsl(a.h, 0.7, 0.94), 4.5);
    return {
      primary,
      primaryForeground: readableOn(primary),
      primarySoft: hsl(p.h, Math.min(p.s, 0.7), 0.95),
      secondary: hsl(p.h, ns, 0.955),
      secondaryForeground: foreground,
      accent: hsl(a.h, Math.min(a.s, 0.75), 0.93),
      accentForeground: accentFg,
      background,
      foreground,
      card,
      cardForeground: foreground,
      muted: hsl(p.h, ns, 0.955),
      mutedForeground: ensureContrast(hsl(p.h, ns + 0.04, 0.45), background, 4.6),
      border: hsl(p.h, ns + 0.04, 0.905),
      input: hsl(p.h, ns + 0.04, 0.88),
      focusRing: primary,
      chart1: primary,
      chart2: ensureContrast(brand.accent, "#ffffff", 2.2),
      chart3: hsl(p.h + 200, 0.25, 0.42),
      chart4: hsl(p.h + 150, 0.35, 0.45),
      chart5: hsl(a.h + 40, 0.3, 0.6),
      chart6: hsl(p.h, 0.08, 0.7),
      sidebarBackground: hsl(p.h, ns, 0.972),
      sidebarForeground: hsl(p.h, ns + 0.05, 0.28),
      sidebarActive: hsl(p.h, Math.min(p.s, 0.6), 0.93),
      sidebarActiveForeground: ensureContrast(primary, hsl(p.h, Math.min(p.s, 0.6), 0.93), 4.5),
      semanticSuccess: "#1f8a5b",
      semanticWarning: "#c27a0e",
      semanticDanger: "#c73a2b",
    };
  }

  const background = hsl(p.h, ns + 0.03, 0.075);
  const card = hsl(p.h, ns + 0.03, 0.105);
  const foreground = hsl(p.h, ns, 0.95);
  const primary = ensureContrast(hsl(p.h, Math.min(p.s, 0.75), Math.max(p.l, 0.6)), background, 5);
  return {
    primary,
    primaryForeground: readableOn(primary),
    primarySoft: hsl(p.h, Math.min(p.s, 0.5), 0.17),
    secondary: hsl(p.h, ns + 0.03, 0.15),
    secondaryForeground: foreground,
    accent: hsl(a.h, Math.min(a.s, 0.45), 0.18),
    accentForeground: hsl(a.h, Math.min(a.s, 0.8), 0.78),
    background,
    foreground,
    card,
    cardForeground: foreground,
    muted: hsl(p.h, ns + 0.03, 0.15),
    mutedForeground: hsl(p.h, ns, 0.68),
    border: hsl(p.h, ns + 0.03, 0.18),
    input: hsl(p.h, ns + 0.03, 0.22),
    focusRing: primary,
    chart1: primary,
    chart2: ensureContrast(brand.accent, card, 3),
    chart3: hsl(p.h + 200, 0.35, 0.65),
    chart4: hsl(p.h + 150, 0.35, 0.6),
    chart5: hsl(a.h + 40, 0.35, 0.7),
    chart6: hsl(p.h, 0.06, 0.45),
    sidebarBackground: hsl(p.h, ns + 0.03, 0.09),
    sidebarForeground: hsl(p.h, ns, 0.78),
    sidebarActive: hsl(p.h, Math.min(p.s, 0.4), 0.17),
    sidebarActiveForeground: hsl(p.h, Math.min(p.s, 0.8), 0.85),
    semanticSuccess: "#3fbf85",
    semanticWarning: "#e8a53a",
    semanticDanger: "#f0705f",
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
