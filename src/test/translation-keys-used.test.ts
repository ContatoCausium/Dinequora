import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Every literal key passed to `t("…")` must exist in BOTH languages. The parity test cannot catch a
 * key that is missing from en-US and pt-BR at the same time (that is how `home.stock.open` reached
 * the Overview as raw text). Scope: files whose `useTranslation` calls all use one namespace, so the
 * namespace of a bare key is unambiguous; dynamic keys (template literals) are skipped.
 */
const SRC = path.resolve(__dirname, "..");
const LOCALES = path.join(SRC, "locales");
const LANGS = ["en-US", "pt-BR"] as const;
const PLURAL = ["", "_zero", "_one", "_two", "_few", "_many", "_other"];

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === "test" || d.name === "locales" ? [] : files(p);
    return /\.(tsx|ts)$/.test(d.name) ? [p] : [];
  });
}

const cache = new Map<string, Record<string, unknown> | null>();
function namespace(lang: string, ns: string) {
  const key = `${lang}/${ns}`;
  if (!cache.has(key)) {
    const file = path.join(LOCALES, lang, `${ns}.json`);
    cache.set(key, fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null);
  }
  return cache.get(key);
}
function has(lang: string, ns: string, key: string) {
  const data = namespace(lang, ns);
  if (!data) return false;
  const parts = key.split(".");
  const last = parts.pop()!;
  let node: unknown = data;
  for (const p of parts) {
    if (!node || typeof node !== "object") return false;
    node = (node as Record<string, unknown>)[p];
  }
  if (!node || typeof node !== "object") return false;
  return PLURAL.some((s) => typeof (node as Record<string, unknown>)[last + s] === "string");
}

describe("translation keys used in code", () => {
  it("exist in en-US and pt-BR", () => {
    const missing: string[] = [];
    let checked = 0;
    for (const file of files(SRC)) {
      const code = fs.readFileSync(file, "utf8");
      // Namespaces bound to the plain `t` (renamed bindings such as `{ t: tOrders }` are ignored).
      const nss = [
        ...code.matchAll(/\{\s*t\s*(?:,[^}]*)?\}\s*=\s*useTranslation\(\s*["']([a-zA-Z]+)["']/g),
      ].map((m) => m[1]!);
      const unique = [...new Set(nss)];
      if (unique.length !== 1) continue;
      const ns = unique[0]!;
      // t("key") or t("key", { …, ns: "other" }) — the ns option overrides the hook namespace.
      for (const m of code.matchAll(
        /\bt\(\s*"([a-zA-Z0-9_.:-]+)"(\s*,\s*\{[^}]*\bns:\s*"([a-zA-Z]+)")?/g,
      )) {
        let key = m[1]!;
        let keyNs = m[3] ?? ns;
        if (key.includes(":")) [keyNs, key] = key.split(":") as [string, string];
        if (!key.includes(".") && !namespace("en-US", keyNs)) continue;
        checked++;
        for (const lang of LANGS)
          if (!has(lang, keyNs, key))
            missing.push(`${path.relative(SRC, file)}: ${keyNs}:${key} (${lang})`);
      }
    }
    expect(checked).toBeGreaterThan(500);
    expect([...new Set(missing)]).toEqual([]);
  });
});
