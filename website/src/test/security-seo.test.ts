import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cspDirective, demoEndpointCspProblem, robotsTxt, sitemapXml } from "../build/seo";

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

  it("uses a strict CSP: own files only, no inline or eval, no framing", () => {
    const csp = all.get("content-security-policy")!;
    expect(csp).not.toMatch(/'unsafe-inline'|'unsafe-eval'|'unsafe-hashes'|'strict-dynamic'|\bhttp:|\s\*(\s|;|$)/);
    expect(cspDirective(headersFile, "default-src")).toEqual(["'self'"]);
    expect(cspDirective(headersFile, "script-src")).toEqual(["'self'"]);
    expect(cspDirective(headersFile, "style-src")).toEqual(["'self'"]);
    expect(cspDirective(headersFile, "img-src")).toEqual(["'self'", "data:"]);
    expect(cspDirective(headersFile, "font-src")).toEqual(["'self'"]);
    expect(cspDirective(headersFile, "connect-src")).toEqual(["'self'"]);
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
    expect(html).toContain('href="/?lang=pt"');
  });

  it("uses root-relative assets that exist (it is served at any depth)", () => {
    const refs = [...html.matchAll(/(?:src|href)="(\/[^"?]*)"/g)].map((m) => m[1]!).filter((p) => p !== "/");
    expect(refs.length).toBeGreaterThan(2);
    for (const ref of refs) expect(existsSync(resolve(process.cwd(), "public" + ref)), ref).toBe(true);
  });
});

describe("sitemap.xml and robots.txt", () => {
  it("builds a valid sitemap with both language versions and hreflang alternates", () => {
    const xml = sitemapXml("https://dinequora.com/");
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    expect(doc.documentElement.namespaceURI).toBe("http://www.sitemaps.org/schemas/sitemap/0.9");
    const locs = [...doc.getElementsByTagName("loc")].map((l) => l.textContent);
    expect(locs).toEqual(["https://dinequora.com/", "https://dinequora.com/?lang=pt"]);
    const links = doc.getElementsByTagNameNS("http://www.w3.org/1999/xhtml", "link");
    expect(links).toHaveLength(6);
    expect([...links].slice(0, 3).map((l) => `${l.getAttribute("hreflang")} ${l.getAttribute("href")}`)).toEqual([
      "en-US https://dinequora.com/",
      "pt-BR https://dinequora.com/?lang=pt",
      "x-default https://dinequora.com/",
    ]);
  });

  it("allows crawling and references the sitemap when the site URL is known", () => {
    expect(robotsTxt("https://dinequora.com")).toBe("User-agent: *\nAllow: /\n\nSitemap: https://dinequora.com/sitemap.xml\n");
    expect(robotsTxt("")).toBe("User-agent: *\nAllow: /\n");
  });
});

describe("demo-request endpoint and the CSP", () => {
  const site = "https://dinequora.com";
  it("accepts no endpoint, relative endpoints and same-origin endpoints", () => {
    expect(demoEndpointCspProblem(headersFile, "", site)).toBeNull();
    expect(demoEndpointCspProblem(headersFile, "/api/demo", site)).toBeNull();
    expect(demoEndpointCspProblem(headersFile, "https://dinequora.com/api/demo", site)).toBeNull();
  });
  it("fails the build for a cross-origin endpoint missing from connect-src", () => {
    expect(demoEndpointCspProblem(headersFile, "https://forms.example.com/demo", site)).toMatch(/Add https:\/\/forms\.example\.com to connect-src/);
    const listed = headersFile.replace("connect-src 'self'", "connect-src 'self' https://forms.example.com");
    expect(demoEndpointCspProblem(listed, "https://forms.example.com/demo", site)).toBeNull();
  });
});
