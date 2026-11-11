import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cspDirective, demoEndpointCspProblem, englishIndexHtml, portugueseIndexHtml, robotsTxt, sitemapXml } from "../build/seo";
import { pageMeta } from "../i18n/meta";

// Tests run from website/ (npm test, CI working-directory).
const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const headersFile = read("public/_headers");

/** Header lines of one `_headers` rule (the indented lines under the URL pattern). */
function rule(pattern: string): Map<string, string> {
  const lines = headersFile.split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === pattern && !/^\s/.test(l));
  expect(start, `rule ${pattern}`).toBeGreaterThanOrEqual(0);
  const out = new Map<string, string>();
  for (const l of lines.slice(start + 1)) {
    if (!/^\s+\S/.test(l)) break;
    const i = l.indexOf(":");
    out.set(l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim());
  }
  return out;
}

describe("security headers (public/_headers)", () => {
  const all = rule("/*");

  it("sets every required header on all paths", () => {
    expect(all.get("strict-transport-security")).toBe("max-age=86400");
    expect(all.get("x-frame-options")).toBe("DENY");
    expect(all.get("x-content-type-options")).toBe("nosniff");
    expect(all.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(all.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(all.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()");
    expect(all.get("content-security-policy")).toBeTruthy();
  });

  it("keeps HSTS to this host only: no includeSubDomains, no preload", () => {
    const headerLines = headersFile.split(/\r?\n/).filter((l) => /^\s+\S/.test(l));
    for (const l of headerLines) expect(l).not.toMatch(/includeSubDomains|preload/i);
  });

  it("uses a strict CSP: own files plus the Cloudflare Web Analytics beacon, no inline or eval, no framing", () => {
    const csp = all.get("content-security-policy")!;
    expect(csp).not.toMatch(/'unsafe-inline'|'unsafe-eval'|'unsafe-hashes'|'strict-dynamic'|\bhttp:|\s\*(\s|;|$)/);
    expect(cspDirective(headersFile, "default-src")).toEqual(["'self'"]);
    // The beacon is the only third-party script. Cloudflare serves it as /beacon.min.js/v<hash>; a
    // CSP path without a trailing slash matches only that exact path, so both forms are listed
    // (no host-wide source).
    expect(cspDirective(headersFile, "script-src")).toEqual([
      "'self'",
      "https://static.cloudflareinsights.com/beacon.min.js",
      "https://static.cloudflareinsights.com/beacon.min.js/",
    ]);
    expect(cspDirective(headersFile, "style-src")).toEqual(["'self'"]);
    expect(cspDirective(headersFile, "img-src")).toEqual(["'self'", "data:"]);
    expect(cspDirective(headersFile, "font-src")).toEqual(["'self'"]);
    // The injected beacon posts to this site's own /cdn-cgi/rum: 'self' is enough. The manual-embed
    // host (cloudflareinsights.com) is not used and must stay out.
    expect(cspDirective(headersFile, "connect-src")).toEqual(["'self'"]);
    expect(csp).not.toMatch(/[\s;]https?:\/\/cloudflareinsights\.com/);
    expect(cspDirective(headersFile, "object-src")).toEqual(["'none'"]);
    expect(cspDirective(headersFile, "base-uri")).toEqual(["'self'"]);
    expect(cspDirective(headersFile, "form-action")).toEqual(["'self'"]);
    expect(cspDirective(headersFile, "frame-ancestors")).toEqual(["'none'"]);
    expect(cspDirective(headersFile, "upgrade-insecure-requests")).toEqual([]);
  });

  it("keeps the pages.dev alias out of search results without touching dinequora.com", () => {
    expect(rule("https://dinequora.pages.dev/*").get("x-robots-tag")).toBe("noindex");
    expect(all.has("x-robots-tag")).toBe(false);
    expect(headersFile).not.toMatch(/dinequora\.com\/?\*/);
    // A "! X-Robots-Tag" line would strip the noindex Cloudflare adds to preview deployments.
    expect(headersFile).not.toMatch(/^\s*!/m);
  });
});

describe("HTML pages are CSP-compatible", () => {
  for (const file of ["index.html", "public/404.html"]) {
    it(`${file} has no inline styles, inline scripts or inline event handlers`, () => {
      const html = read(file);
      expect(html).not.toMatch(/\sstyle\s*=/i);
      expect(html).not.toMatch(/\son[a-z]+\s*=/i);
      for (const tag of html.match(/<script\b[^>]*>/gi) ?? []) expect(tag).toMatch(/\ssrc=/);
      expect(html).not.toMatch(/<style\b/i);
    });
  }
});

describe("404 page", () => {
  const html = read("public/404.html");

  it("is not indexed and is bilingual", () => {
    expect(html).toMatch(/<meta name="robots" content="noindex"\s*\/?>/);
    expect(html).toContain('lang="en-US"');
    expect(html).toContain('lang="pt-BR"');
    expect(html).toContain('href="/"');
    expect(html).toContain('href="/pt/"');
  });

  it("uses root-relative assets that exist (it is served at any depth)", () => {
    const refs = [...html.matchAll(/(?:src|href)="(\/[^"?]*)"/g)].map((m) => m[1]!).filter((p) => p !== "/" && p !== "/pt/"); // page links, not files
    expect(refs.length).toBeGreaterThan(2);
    for (const ref of refs) expect(existsSync(resolve(process.cwd(), "public" + ref)), ref).toBe(true);
  });
});

describe("language pages: static head of / (English) and /pt/ (Portuguese)", () => {
  const site = "https://dinequora.com";
  const source = read("index.html");
  const en = englishIndexHtml(source, site);
  const pt = portugueseIndexHtml(en, site);
  const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");
  const head = (html: string) => {
    const doc = parse(html);
    const attr = (sel: string, name: string) => doc.querySelector(sel)?.getAttribute(name) ?? null;
    return {
      lang: doc.documentElement.getAttribute("lang"),
      title: doc.title,
      description: attr('meta[name="description"]', "content"),
      canonical: [...doc.querySelectorAll('link[rel="canonical"]')].map((l) => l.getAttribute("href")),
      ogUrl: attr('meta[property="og:url"]', "content"),
      ogLocale: attr('meta[property="og:locale"]', "content"),
      ogLocaleAlt: attr('meta[property="og:locale:alternate"]', "content"),
      ogTitle: attr('meta[property="og:title"]', "content"),
      ogDescription: attr('meta[property="og:description"]', "content"),
      twitterTitle: attr('meta[name="twitter:title"]', "content"),
      twitterDescription: attr('meta[name="twitter:description"]', "content"),
      ogImage: attr('meta[property="og:image"]', "content"),
      noscript: doc.querySelector("noscript")?.textContent?.trim() ?? null,
      alternates: [...doc.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => `${l.getAttribute("hreflang")} ${l.getAttribute("href")}`),
      script: [...doc.querySelectorAll("script[src]")].map((s) => s.getAttribute("src")),
    };
  };

  it("English page: en-US, English metadata, canonical / and reciprocal hreflang", () => {
    const h = head(en);
    expect(h.lang).toBe("en-US");
    expect(h.title).toBe(pageMeta.en.title);
    expect(h.description).toBe(pageMeta.en.description);
    expect(h.canonical).toEqual(["https://dinequora.com/"]);
    expect(h.ogUrl).toBe("https://dinequora.com/");
    expect(h.ogLocale).toBe("en_US");
    expect(h.ogLocaleAlt).toBe("pt_BR");
    expect(h.ogImage).toBe("https://dinequora.com/og-image.jpg");
    expect(h.alternates).toEqual(["en-US https://dinequora.com/", "pt-BR https://dinequora.com/pt/", "x-default https://dinequora.com/"]);
  });

  it("Portuguese page: pt-BR, Portuguese metadata in the initial HTML, canonical /pt/", () => {
    const h = head(pt);
    expect(h.lang).toBe("pt-BR");
    expect(h.title).toBe(pageMeta.pt.title);
    expect(h.description).toBe(pageMeta.pt.description);
    expect(h.canonical).toEqual(["https://dinequora.com/pt/"]);
    expect(h.ogUrl).toBe("https://dinequora.com/pt/");
    expect(h.ogLocale).toBe("pt_BR");
    expect(h.ogLocaleAlt).toBe("en_US");
    expect(h.ogTitle).toBe(pageMeta.pt.title);
    expect(h.twitterTitle).toBe(pageMeta.pt.title);
    expect(h.ogDescription).toBe(pageMeta.pt.social);
    expect(h.twitterDescription).toBe(pageMeta.pt.social);
    expect(h.noscript).toBe(pageMeta.pt.noscript);
    expect(h.ogImage).toBe("https://dinequora.com/og-image.jpg");
    // Same reciprocal set on both pages; x-default is the English page.
    expect(h.alternates).toEqual(head(en).alternates);
    // Same app bundle (root-relative, so it loads under /pt/ too).
    expect(h.script).toEqual(head(en).script);
    expect(pt).not.toMatch(/Restaurant Intelligence Platform\. Please enable|content="Run your restaurant/);
  });

  it("without VITE_SITE_URL: no canonical or hreflang, but the Portuguese page is still Portuguese", () => {
    const local = portugueseIndexHtml(englishIndexHtml(source, ""), "");
    const h = head(local);
    expect(h.lang).toBe("pt-BR");
    expect(h.title).toBe(pageMeta.pt.title);
    expect(h.canonical).toEqual([]);
    expect(h.alternates).toEqual([]);
  });

  it("stops the build if index.html and the English metadata drift apart", () => {
    expect(() => englishIndexHtml(source.replace(pageMeta.en.title, "Other title"), site)).toThrow(/title differs/);
    expect(() => portugueseIndexHtml(en.replace(/<meta property="og:image:alt"[^>]*>/, ""), site)).toThrow(/og:image:alt/);
  });
});

describe("sitemap.xml and robots.txt", () => {
  it("builds a valid sitemap with / and /pt/ and reciprocal hreflang alternates", () => {
    const xml = sitemapXml("https://dinequora.com/");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(doc.documentElement.namespaceURI).toBe("http://www.sitemaps.org/schemas/sitemap/0.9");
    const urls = [...doc.getElementsByTagName("url")];
    expect(urls.map((u) => u.getElementsByTagName("loc")[0]!.textContent)).toEqual(["https://dinequora.com/", "https://dinequora.com/pt/"]);
    for (const u of urls) {
      const links = [...u.getElementsByTagNameNS("http://www.w3.org/1999/xhtml", "link")];
      expect(links.map((l) => `${l.getAttribute("hreflang")} ${l.getAttribute("href")}`)).toEqual([
        "en-US https://dinequora.com/",
        "pt-BR https://dinequora.com/pt/",
        "x-default https://dinequora.com/",
      ]);
    }
    expect(xml).not.toContain("?lang=");
  });

  it("allows crawling and references the sitemap when the site URL is known", () => {
    expect(robotsTxt("https://dinequora.com")).toBe("User-agent: *\nAllow: /\n\nSitemap: https://dinequora.com/sitemap.xml\n");
    expect(robotsTxt("")).toBe("User-agent: *\nAllow: /\n");
  });
});

describe("demo-request endpoint and the CSP", () => {
  const listed = headersFile.replace("connect-src 'self'", "connect-src 'self' https://forms.example.com");

  it("accepts: no endpoint, a same-origin path, an https URL whose origin is listed", () => {
    expect(demoEndpointCspProblem(headersFile, "")).toBeNull();
    expect(demoEndpointCspProblem(headersFile, "   ")).toBeNull();
    expect(demoEndpointCspProblem(headersFile, "/api/demo")).toBeNull();
    expect(demoEndpointCspProblem(listed, "https://forms.example.com/demo")).toBeNull();
  });

  it("rejects protocol-relative URLs", () => {
    for (const endpoint of ["//forms.example.com/demo", "//forms.example.com", "  //forms.example.com/x", "/\\forms.example.com/x", "\\\\forms.example.com/x"]) {
      expect(demoEndpointCspProblem(listed, endpoint), endpoint).toMatch(/protocol-relative/);
    }
  });

  it("rejects https URLs whose origin is not listed, even the site's own domain (www and pages.dev serve it too)", () => {
    expect(demoEndpointCspProblem(headersFile, "https://forms.example.com/demo")).toMatch(/Add https:\/\/forms\.example\.com to connect-src/);
    expect(demoEndpointCspProblem(headersFile, "https://dinequora.com/api/demo")).toMatch(/Add https:\/\/dinequora\.com to connect-src/);
  });

  it("rejects http, other schemes, relative paths without a leading slash and invalid values", () => {
    expect(demoEndpointCspProblem(listed, "http://forms.example.com/demo")).toMatch(/must use https/);
    expect(demoEndpointCspProblem(listed, "javascript:alert(1)")).toMatch(/must use https/);
    expect(demoEndpointCspProblem(listed, "api/demo")).toMatch(/path starting with "\/"/);
    expect(demoEndpointCspProblem(listed, "https://")).toMatch(/path starting with "\/"/);
  });

  it("rejects a same-origin path when connect-src does not allow 'self'", () => {
    expect(demoEndpointCspProblem(headersFile.replace("connect-src 'self'", "connect-src 'none'"), "/api/demo")).toMatch(/must include 'self'/);
  });
});
