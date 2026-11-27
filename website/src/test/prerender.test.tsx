// @vitest-environment node
// Runs without a browser (no window, no document), as the build-time pre-render does.
import { render } from "../entry-server";
import { structuredData, SALES_PHONE } from "../build/seo";
import { pageMeta } from "../i18n/meta";
import { PRICES } from "../config/pricing";
import { WHATSAPP } from "../config/site";

describe("build-time pre-render", () => {
  it("renders each language version without a browser", () => {
    const en = render("en");
    const pt = render("pt");
    expect(en).toMatch(/<h1[^>]*>Run your restaurant\./);
    expect(pt).toMatch(/<h1[^>]*>Comande seu restaurante\./);
    // The main sections are in the delivered HTML, not only after JavaScript.
    for (const id of ["platform", "features", "pricing", "faq", "demo"]) expect(en).toContain(`id="${id}"`);
    expect(en).toContain("Starter");
    expect(pt).toContain("Perguntas");
  });

  it("puts both versions of the masked name in the HTML (CSS picks one per screen)", () => {
    const en = render("en");
    expect(en).toContain('id="dq-name-mask"');
    expect(en).toContain('id="dq-name-mask-narrow"');
  });
});

describe("head metadata", () => {
  it("keeps descriptions within 155 characters and reuses them for social cards", () => {
    for (const locale of ["en", "pt"] as const) {
      const m = pageMeta[locale];
      expect(m.description.length).toBeGreaterThanOrEqual(120);
      expect(m.description.length).toBeLessThanOrEqual(155);
      expect(m.social).toBe(m.description);
    }
  });
});

describe("structured data", () => {
  const parse = (html: string) => JSON.parse(html.replace(/^\s*<script type="application\/ld\+json">/, "").replace(/<\/script>$/, ""));

  it("describes only facts shown on the page, with prices from PRICES", () => {
    const data = parse(structuredData("en", "https://dinequora.com"));
    const graph = data["@graph"] as Array<Record<string, unknown>>;
    expect(graph.map((n) => n["@type"])).toEqual(["Organization", "WebSite", "SoftwareApplication"]);
    const app = graph[2] as { offers: Array<{ name: string; price: string; priceCurrency: string }> };
    expect(app.offers.map((o) => [o.name, o.price, o.priceCurrency])).toEqual([
      ["Starter", PRICES.starter.monthlyUsd.toFixed(2), "USD"],
      ["Growth", PRICES.growth.monthlyUsd.toFixed(2), "USD"],
    ]);
    const text = JSON.stringify(data);
    expect(text).not.toMatch(/aggregateRating|review|address/i);
  });

  it("uses the sales number shown on the page", () => {
    expect(SALES_PHONE.replace(/\D/g, "")).toBe(WHATSAPP.number);
  });

  it("follows the language of each page", () => {
    expect(parse(structuredData("pt", "https://dinequora.com"))["@graph"][1].inLanguage).toBe("pt-BR");
  });
});
