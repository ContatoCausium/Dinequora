export type RGB = { r: number; g: number; b: number };
export type HSL = { h: number; s: number; l: number };

const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));

export function isHex(v: string) {
  return /^#([0-9a-f]{6})$/i.test(v.trim());
}

export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

export function rgbToHex({ r, g, b }: RGB) {
  return (
    "#" +
    [r, g, b]
      .map((x) =>
        Math.round(clamp(x, 0, 255))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

export function rgbToHsl({ r, g, b }: RGB): HSL {
  const rn = r / 255,
    gn = g / 255,
    bn = b / 255;
  const max = Math.max(rn, gn, bn),
    min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0,
    s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === rn) h = (gn - bn) / d + (gn < bn ? 6 : 0);
    else if (max === gn) h = (bn - rn) / d + 2;
    else h = (rn - gn) / d + 4;
    h *= 60;
  }
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: HSL): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let [r, g, b] = [0, 0, 0];
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

export const hsl = (h: number, s: number, l: number) =>
  rgbToHex(hslToRgb({ h, s: clamp(s), l: clamp(l) }));

export const hexToHsl = (hex: string) => rgbToHsl(hexToRgb(hex));

function channel(v: number) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function luminance(hex: string) {
  const { r, g, b } = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio between two hex colors. */
export function contrast(a: string, b: string) {
  const la = luminance(a),
    lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Shift lightness of `hex` until it reaches `target` contrast against `bg`. */
export function ensureContrast(hex: string, bg: string, target: number) {
  const base = hexToHsl(hex);
  const darken = luminance(bg) > 0.4;
  let l = base.l;
  let out = hex;
  for (let i = 0; i < 60 && contrast(out, bg) < target; i++) {
    l = clamp(l + (darken ? -0.015 : 0.015));
    out = hsl(base.h, base.s, l);
  }
  return out;
}

export function readableOn(bg: string) {
  return contrast("#ffffff", bg) >= contrast("#111111", bg) ? "#ffffff" : "#141210";
}
