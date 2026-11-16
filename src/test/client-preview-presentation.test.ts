import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Client preview presentation (Phase 0): the preview shown to prospective customers lists only what
 * exists and never presents an unfinished feature or a simulation as available. These are policy
 * checks on the source, like the other client-preview policy tests: they keep a later edit from
 * bringing a roadmap item, a simulated integration or an "AI model" claim back into the preview.
 */
const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
type LocaleFile = {
  title?: string;
  nav?: Record<string, string>;
  demo?: Record<string, string>;
  [key: string]: unknown;
};
const json = (p: string) => JSON.parse(read(p)) as LocaleFile;
const LOCALES = ["en-US", "pt-BR"] as const;

describe("Insights: analysis from recorded data, no AI claim either way", () => {
  it("the module is named Insights in navigation and on the page", () => {
    for (const l of LOCALES) {
      expect(json(`src/locales/${l}/common.json`).nav?.["intelligence"]).toBe("Insights");
      expect(json(`src/locales/${l}/intelligence.json`).title).toBe("Insights");
    }
    expect(read("src/routes/_authenticated/_app/intelligence.tsx")).not.toContain(
      "Dinequora Intelligence · Dinequora",
    );
  });

  it("no text claims or denies an AI model, and no 'deterministic' jargon", () => {
    for (const l of LOCALES) {
      // Visible texts only (key names such as "deterministic" are not shown to anyone).
      const values: string[] = [];
      const walk = (v: unknown): void => {
        if (typeof v === "string") values.push(v);
        else if (v && typeof v === "object") Object.values(v).forEach(walk);
      };
      walk(json(`src/locales/${l}/intelligence.json`));
      const text = values.join(" | ");
      expect(text).not.toMatch(/AI model|modelo de IA|deterministic|determinístic/i);
    }
  });

  it("no visible text anywhere still uses the old module name", () => {
    for (const l of LOCALES)
      for (const f of fs.readdirSync(path.join(root, `src/locales/${l}`))) {
        const values: string[] = [];
        const walk = (v: unknown): void => {
          if (typeof v === "string") values.push(v);
          else if (v && typeof v === "object") Object.values(v).forEach(walk);
        };
        walk(json(`src/locales/${l}/${f}`));
        for (const v of values) expect(v, `${l}/${f}`).not.toMatch(/Intelligence|Inteligência/);
      }
  });

  it("the WhatsApp card (integration not connected) never renders in the client preview", () => {
    const src = read("src/routes/_authenticated/_app/intelligence.tsx");
    expect(src).toMatch(/const showWhatsApp = !isClientPreview\(\);/);
    expect(src).toMatch(/\{showWhatsApp && \(\s*<WhatsAppPreviewCard/);
    expect(src.match(/<WhatsAppPreviewCard/g)).toHaveLength(1);
  });
});

describe("no roadmap or white-label leftovers in the preview", () => {
  const shell = read("src/components/app/app-shell.tsx");

  it("'Coming next' roadmap items are hidden in the client preview", () => {
    const at = shell.indexOf('t("nav.comingNext")');
    expect(at).toBeGreaterThan(-1);
    expect(shell.lastIndexOf("{!isClientPreview() && (", at)).toBeGreaterThan(
      shell.lastIndexOf("function SidebarNav", at),
    );
  });

  it("'Powered by Dinequora' only appears under a customer's own logo", () => {
    expect(shell).toMatch(/org\.logoUrl \? \(\s*<span[^>]*>\{t\("shell\.poweredBy"\)\}/);
  });
});

describe("one honest demo indicator", () => {
  it("the shell shows a single workspace-level indicator for demo organizations", () => {
    const shell = read("src/components/app/app-shell.tsx");
    expect(shell).toMatch(/org\.fictional && \(/);
    expect(shell).toContain('t("demo.workspace")');
    for (const l of LOCALES) {
      const demo = json(`src/locales/${l}/common.json`).demo ?? {};
      expect(demo["workspace"]).toBeTruthy();
      expect(demo["workspaceShort"]).toBeTruthy();
    }
  });

  it("module pages no longer carry their own demo badge variant", () => {
    for (const f of [
      "src/routes/_authenticated/_app/finance.tsx",
      "src/routes/_authenticated/_app/intelligence.tsx",
      "src/routes/_authenticated/_app/inventory.tsx",
      "src/routes/_authenticated/_app/pos.tsx",
      "src/components/menu/menu-page.tsx",
    ])
      expect(read(f), f).not.toMatch(/org\.fictional && <DemoBadge/);
  });
});

describe("billing and onboarding in the preview", () => {
  it("billing shows no placeholder price list and no 'payments not connected' warning", () => {
    const src = read("src/routes/_authenticated/_app/settings.billing.tsx");
    expect(src).toMatch(/const preview = isClientPreview\(\);/);
    expect(src).toMatch(/\{!preview && \(\s*<Panel title=\{t\("billing\.plans"\)\}/);
    expect(src).toMatch(/preview \? \(\s*<div[^>]*>\s*<Info/);
  });

  it("onboarding never offers to create a restaurant in the preview; members go to the workspace", () => {
    const src = read("src/routes/_authenticated/onboarding.tsx");
    expect(src).toMatch(
      /if \(isClientPreview\(\)\) \{\s*if \(\(await fetchMemberships\(context\.user\.id\)\)\.length > 0\) throw redirect\(\{ to: "\/" \}\);/,
    );
    expect(src).toMatch(/\{!preview && \(/);
  });
});
