import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../locales");
const LANGS = ["en-US", "pt-BR"] as const;

function flatten(obj: unknown, prefix = ""): string[] {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, prefix ? `${prefix}.${k}` : k),
  );
}
// i18next plural suffixes may legitimately differ between languages.
const normalize = (key: string) => key.replace(/_(zero|one|two|few|many|other)$/, "");

describe("locale parity", () => {
  const namespaces = fs.readdirSync(path.join(ROOT, "en-US")).filter((f) => f.endsWith(".json"));

  it("every language ships the same namespaces", () => {
    for (const lang of LANGS) {
      expect(
        fs
          .readdirSync(path.join(ROOT, lang))
          .filter((f) => f.endsWith(".json"))
          .sort(),
      ).toEqual([...namespaces].sort());
    }
  });

  for (const ns of namespaces) {
    it(`${ns}: en-US and pt-BR define the same keys`, () => {
      const [en, pt] = LANGS.map(
        (lang) =>
          new Set(
            flatten(JSON.parse(fs.readFileSync(path.join(ROOT, lang, ns), "utf8"))).map(normalize),
          ),
      );
      expect(
        [...en!].filter((k) => !pt!.has(k)),
        `missing in pt-BR/${ns}`,
      ).toEqual([]);
      expect(
        [...pt!].filter((k) => !en!.has(k)),
        `missing in en-US/${ns}`,
      ).toEqual([]);
    });
  }
});
