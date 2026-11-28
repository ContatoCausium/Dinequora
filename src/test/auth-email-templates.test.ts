import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  htmlTemplate,
  LANG,
  LOGO_URL,
  OUT_DIR,
  subjectTemplate,
  TEMPLATES,
} from "../../scripts/email/build-auth-templates.mjs";

/**
 * Supabase Auth e-mail templates (scripts/email/build-auth-templates.mjs → supabase/templates/).
 * Supabase renders them with Go text/template: an unbalanced block or an unknown action makes the
 * e-mail fail to send, so the structure is checked here; the committed files must match the generator.
 */
type Tpl = (typeof TEMPLATES)[keyof typeof TEMPLATES];
const names = Object.keys(TEMPLATES) as (keyof typeof TEMPLATES)[];

/** Resolves the language switch the way the Go template does for one language. */
function render(src: string, pt: boolean) {
  let out = src.replace(LANG, "");
  const re = /\{\{ if \$pt \}\}([\s\S]*?)\{\{ else \}\}([\s\S]*?)\{\{ end \}\}/g;
  out = out.replace(re, (_m, p: string, e: string) => (pt ? p : e));
  return out;
}

function actions(src: string) {
  return [...src.matchAll(/\{\{\s*([^}]*?)\s*\}\}/g)].map((m) => m[1] ?? "");
}

describe("auth e-mail templates", () => {
  it.each(names)("%s: balanced Go template blocks, only known actions", (name) => {
    const t: Tpl = TEMPLATES[name];
    for (const src of [htmlTemplate(t), subjectTemplate(t)]) {
      let depth = 0;
      for (const a of actions(src)) {
        if (/^(if|with|range)\b/.test(a)) depth++;
        else if (a === "end") depth--;
        expect(depth).toBeGreaterThanOrEqual(0);
        expect(
          /^(if \$pt|if eq \(printf "%v" \.preferred_language\) "pt-BR"|with \.Data|else|end|\$pt := false|\$pt = true|\.ConfirmationURL|\.Token|\.NewEmail)$/.test(
            a,
          ),
          `unexpected action {{ ${a} }}`,
        ).toBe(true);
      }
      expect(depth).toBe(0);
    }
  });

  it.each(names)("%s: each language gets its own text and the Supabase link or code", (name) => {
    const t: Tpl = TEMPLATES[name];
    const src = htmlTemplate(t);
    const en = render(src, false);
    const pt = render(src, true);
    expect(en).toContain(t.en.heading.replace("{{ .NewEmail }}", ""));
    expect(pt).toContain(t.pt.heading);
    expect(en).not.toContain(t.pt.footer);
    expect(pt).not.toContain(t.en.footer);
    expect(src).toContain(t.action ?? "{{ .Token }}");
    expect(render(subjectTemplate(t), true)).toBe(t.pt.subject);
    expect(render(subjectTemplate(t), false)).toBe(t.en.subject);
    // No links other than the Supabase token and the support mailbox.
    const hrefs = [...src.matchAll(/href="([^"]+)"/g)].map((m) => m[1] ?? "");
    for (const h of hrefs)
      expect(["{{ .ConfirmationURL }}", "mailto:support@dinequora.com"]).toContain(h);
  });

  it("shows the brand mark from the production app, as a PNG served from public/", () => {
    expect(LOGO_URL).toBe("https://app.dinequora.com/email/dinequora-mark.png");
    const png = fs.readFileSync(path.join(OUT_DIR, "../../public/email/dinequora-mark.png"));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    for (const name of names) {
      const srcs = [...htmlTemplate(TEMPLATES[name]).matchAll(/src="([^"]+)"/g)].map((m) => m[1]);
      expect(srcs).toEqual([LOGO_URL]);
    }
  });

  it("the committed files are the generator's output", () => {
    for (const name of names) {
      const file = fs.readFileSync(path.join(OUT_DIR, `${name}.html`), "utf8");
      expect(file).toBe(htmlTemplate(TEMPLATES[name]));
    }
    const subjects = JSON.parse(fs.readFileSync(path.join(OUT_DIR, "subjects.json"), "utf8"));
    for (const name of names) expect(subjects[name]).toBe(subjectTemplate(TEMPLATES[name]));
  });
});
