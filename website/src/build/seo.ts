/**
 * Build-time SEO and security files, derived from VITE_SITE_URL so nothing is hard-coded per
 * deploy (same source as the canonical and hreflang tags added to index.html).
 */

/** The two language versions of the single page: English (default) and Portuguese (?lang=pt). */
export function pageVersions(base: string) {
  return [
    { hreflang: "en-US", href: `${base}/` },
    { hreflang: "pt-BR", href: `${base}/?lang=pt` },
  ] as const;
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** sitemap.xml listing both language versions, each with its hreflang alternates. */
export function sitemapXml(siteUrl: string): string {
  const base = siteUrl.replace(/\/+$/, "");
  const versions = pageVersions(base);
  const alternates = [
    ...versions.map((v) => `    <xhtml:link rel="alternate" hreflang="${v.hreflang}" href="${xmlEscape(v.href)}"/>`),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${xmlEscape(`${base}/`)}"/>`,
  ].join("\n");
  const urls = versions.map((v) => `  <url>\n    <loc>${xmlEscape(v.href)}</loc>\n${alternates}\n  </url>`).join("\n");
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">`,
    urls,
    `</urlset>`,
    ``,
  ].join("\n");
}

/** robots.txt: everything allowed; points at the sitemap when the public URL is known. */
export function robotsTxt(siteUrl: string): string {
  const base = siteUrl.replace(/\/+$/, "");
  return ["User-agent: *", "Allow: /", ...(base ? ["", `Sitemap: ${base}/sitemap.xml`] : []), ""].join("\n");
}

/** Sources of one CSP directive in a `_headers` file (null when the header or directive is missing). */
export function cspDirective(headersFile: string, directive: string): string[] | null {
  const line = headersFile.split(/\r?\n/).find((l) => /^\s+Content-Security-Policy:/i.test(l));
  if (!line) return null;
  const policy = line.replace(/^\s+Content-Security-Policy:\s*/i, "");
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name === directive) return sources;
  }
  return null;
}

/**
 * Problem with the demo-request endpoint and the CSP, or null when it is fine: a cross-origin
 * endpoint must be listed in connect-src, otherwise the browser would block the submission.
 */
export function demoEndpointCspProblem(headersFile: string, endpoint: string, siteUrl: string): string | null {
  if (!endpoint) return null;
  let target: URL;
  try {
    target = new URL(endpoint, siteUrl || "https://site.invalid");
  } catch {
    return `VITE_DEMO_REQUEST_ENDPOINT is not a valid URL: ${endpoint}`;
  }
  const connect = cspDirective(headersFile, "connect-src");
  if (!connect) return "public/_headers has no connect-src directive";
  const sameOrigin = siteUrl !== "" && target.origin === new URL(siteUrl).origin;
  if (connect.includes(target.origin) || ((sameOrigin || !/^https?:\/\//i.test(endpoint)) && connect.includes("'self'"))) return null;
  return `Add ${target.origin} to connect-src in public/_headers: the CSP would block demo requests to ${endpoint}`;
}
