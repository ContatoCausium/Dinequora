import { hexToHsl, rgbToHex, rgbToHsl, type RGB } from "./color";

/**
 * Local, pluggable logo color extractor. Runs in the browser only (canvas).
 * A future server/AI provider can implement the same `BrandExtractor` signature.
 */
export type ExtractedColor = { hex: string; weight: number };
export type BrandExtractor = (src: string) => Promise<ExtractedColor[]>;

export const ACCEPTED_LOGO_TYPES = ["image/png", "image/jpeg", "image/svg+xml", "image/webp"];
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

export function validateLogo(file: File): "type" | "size" | null {
  if (!ACCEPTED_LOGO_TYPES.includes(file.type)) return "type";
  if (file.size > MAX_LOGO_BYTES) return "size";
  return null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

const dist = (a: RGB, b: RGB) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);

export const extractLogoColors: BrandExtractor = async (src) => {
  const img = await loadImage(src);
  const size = 96;
  const canvas = document.createElement("canvas");
  const ratio = img.width / img.height || 1;
  canvas.width = ratio >= 1 ? size : Math.round(size * ratio);
  canvas.height = ratio >= 1 ? Math.round(size / ratio) : size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // Estimate background from the four corners so it can be excluded.
  const corner = (x: number, y: number): RGB | null => {
    const i = (y * width + x) * 4;
    return data[i + 3]! < 128 ? null : { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! };
  };
  const corners = [
    corner(0, 0),
    corner(width - 1, 0),
    corner(0, height - 1),
    corner(width - 1, height - 1),
  ].filter(Boolean) as RGB[];

  const buckets = new Map<number, { r: number; g: number; b: number; n: number; w: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3]! < 200) continue;
    const px = { r: data[i]!, g: data[i + 1]!, b: data[i + 2]! };
    if (corners.some((c) => dist(c, px) < 28)) continue;
    const { h, s, l } = rgbToHsl(px);
    if (s < 0.28 || l > 0.9 || l < 0.12) continue; // skip neutrals, outlines, highlights
    const key = Math.round(h / 15) % 24;
    const b = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0, w: 0 };
    const weight = s * (1 - Math.abs(l - 0.5));
    b.r += px.r * weight;
    b.g += px.g * weight;
    b.b += px.b * weight;
    b.n++;
    b.w += weight;
    buckets.set(key, b);
  }

  const total = [...buckets.values()].reduce((s, b) => s + b.n, 0) || 1;
  const candidates = [...buckets.values()]
    .filter((b) => b.n / total > 0.015)
    .sort((x, y) => y.w - x.w)
    .map((b) => ({
      hex: rgbToHex({ r: b.r / b.w, g: b.g / b.w, b: b.b / b.w }),
      weight: b.n / total,
    }));

  // Keep visually distinct hues only.
  const distinct: ExtractedColor[] = [];
  for (const c of candidates) {
    const h = hexToHsl(c.hex).h;
    if (
      distinct.every(
        (d) =>
          Math.min(Math.abs(hexToHsl(d.hex).h - h), 360 - Math.abs(hexToHsl(d.hex).h - h)) > 18,
      )
    )
      distinct.push(c);
    if (distinct.length === 5) break;
  }
  return distinct;
};

/** Rasterize uploads (including SVG) before persistence; never store executable SVG markup. */
export async function logoToDataUrl(file: File): Promise<string> {
  const source = URL.createObjectURL(file);
  try {
    const image = await loadImage(source);
    const scale = Math.min(1, 1024 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas_unavailable");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", 0.9);
  } finally {
    URL.revokeObjectURL(source);
  }
}
