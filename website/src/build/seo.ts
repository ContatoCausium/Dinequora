/**
 * Build-time SEO and security helpers: the static head of each language version, sitemap.xml,
 * robots.txt, and the check that the demo-request endpoint is allowed by the CSP. Absolute URLs
 * come from VITE_SITE_URL so nothing is hard-coded per deploy.
 */
import { htmlLang, localePath, ogLocale, pageMeta, type Locale } from "../i18n/meta";

const LOCALES: readonly Locale[] = ["en", "pt"];

function trimBase(siteUrl: string): string {
  return siteUrl.trim().replace(/\/+$/, "");
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Absolute URL of each language version (English `/`, Portuguese `/pt/`). */
export function pageVersions(siteUrl: string) {
  const base = trimBase(siteUrl);
  return LOCALES.map((locale) => ({ locale, hreflang: htmlLang[locale], href: `${base}${localePath[locale]}` }));
}

/** canonical + og:url of one version, and the reciprocal hreflang alternates (x-default = English). */
function seoTags(locale: Locale, base: string): string {
  const self = `${base}${localePath[locale]}`;
  const other: Locale = locale === "en" ? "pt" : "en";
  return [
    `<link rel="canonical" href="${self}" />`,
    `<meta property="og:url" content="${self}" />`,
    `<meta property="og:locale:alternate" content="${ogLocale[other]}" />`,
    ...pageVersions(base).map((v) => `<link rel="alternate" hreflang="${v.hreflang}" href="${v.href}" />`),
    `<link rel="alternate" hreflang="x-default" href="${base}${localePath.en}" />`,
  ]
    .map((t) => `    ${t}`)
    .join("\n");
}

/** Replaces exactly one match, so a change in index.html cannot silently skip a translation. */
function replaceOne(html: string, pattern: RegExp, value: string, what: string): string {
  const all = html.match(new RegExp(pattern.source, "g"));
  if (!all || all.length !== 1) throw new Error(`index.html: expected exactly one ${what}, found ${all?.length ?? 0}`);
  return html.replace(pattern, value);
}

/**
 * Head of the English page (index.html): absolute social image, canonical, og:url and hreflang
 * when the public URL is known. Also checks that index.html still holds the English metadata.
 */
export function englishIndexHtml(html: string, siteUrl: string): string {
  const en = pageMeta.en;
  const expected: Array<[string, string]> = [
    ["html lang", `<html lang="${htmlLang.en}">`],
    ["title", `<title>${en.title}</title>`],
    ["description", `content="${escapeAttr(en.description)}"`],
    ["noscript text", en.noscript],
  ];
  for (const [what, needle] of expected) {
    if (!html.includes(needle)) throw new Error(`index.html: ${what} differs from src/i18n/meta.ts (en)`);
  }
  const base = trimBase(siteUrl);
  if (!base) return html;
  return html
    .replace(/content="\/og-image\.jpg"/g, `content="${base}/og-image.jpg"`)
    .replace("</head>", `${seoTags("en", base)}\n  </head>`);
}

/**
 * The Portuguese page (/pt/index.html), derived from the built English page: Portuguese
 * `<html lang>`, title, description, social tags, noscript text, canonical and og:url, so the
 * initial HTML is right before any JavaScript runs.
 */
export function portugueseIndexHtml(englishHtml: string, siteUrl: string): string {
  const en = pageMeta.en;
  const pt = pageMeta.pt;
  const base = trimBase(siteUrl);
  let html = englishHtml;
  const swap = (pattern: RegExp, value: string, what: string) => {
    html = replaceOne(html, pattern, value, what);
  };
  swap(/<html lang="en-US">/, `<html lang="${htmlLang.pt}">`, "html lang");
  swap(/<title>[^<]*<\/title>/, `<title>${pt.title}</title>`, "title");
  swap(/(<meta\s+name="description"\s+content=")[^"]*(")/, `$1${escapeAttr(pt.description)}$2`, "meta description");
  swap(/(<meta property="og:title" content=")[^"]*(")/, `$1${escapeAttr(pt.title)}$2`, "og:title");
  swap(/(<meta name="twitter:title" content=")[^"]*(")/, `$1${escapeAttr(pt.title)}$2`, "twitter:title");
  swap(/(<meta\s+property="og:description"\s+content=")[^"]*(")/, `$1${escapeAttr(pt.social)}$2`, "og:description");
  swap(/(<meta\s+name="twitter:description"\s+content=")[^"]*(")/, `$1${escapeAttr(pt.social)}$2`, "twitter:description");
  swap(/(<meta property="og:image:alt" content=")[^"]*(")/, `$1${escapeAttr(pt.imageAlt)}$2`, "og:image:alt");
  swap(/<meta property="og:locale" content="en_US" \/>/, `<meta property="og:locale" content="${ogLocale.pt}" />`, "og:locale");
  swap(new RegExp(escapeRegExp(en.noscript)), pt.noscript, "noscript text");
  if (base) swap(new RegExp(escapeRegExp(seoTags("en", base))), seoTags("pt", base), "canonical/hreflang block");
  return html;
}

/** sitemap.xml listing both language versions, each with reciprocal hreflang alternates. */
export function sitemapXml(siteUrl: string): string {
  const base = trimBase(siteUrl);
  const versions = pageVersions(base);
  const alternates = [
    ...versions.map((v) => `    <xhtml:link rel="alternate" hreflang="${v.hreflang}" href="${escapeAttr(v.href)}"/>`),
    `    <xhtml:link rel="alternate" hreflang="x-default" href="${escapeAttr(`${base}${localePath.en}`)}"/>`,
  ].join("\n");
  const urls = versions.map((v) => `  <url>\n    <loc>${escapeAttr(v.href)}</loc>\n${alternates}\n  </url>`).join("\n");
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
  const base = trimBase(siteUrl);
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
 * Problem with the demo-request endpoint and the CSP, or null when it is fine. Accepted:
 *  - a same-origin path starting with a single "/" (allowed by connect-src 'self' on every host
 *    the site is served from: dinequora.com, www and pages.dev);
 *  - an absolute https:// URL whose origin is listed explicitly in connect-src. An absolute URL is
 *    never treated as 'self': the same site is also served from other hosts, where it would be
 *    cross-origin.
 * Rejected: protocol-relative URLs ("//host/…"), relative paths without a leading "/" (they would
 * change with the page, e.g. under /pt/), http:// and any other scheme.
 */
export function demoEndpointCspProblem(headersFile: string, endpoint: string): string | null {
  const value = endpoint.trim();
  if (!value) return null;
  const connect = cspDirective(headersFile, "connect-src");
  if (!connect) return "public/_headers has no connect-src directive";
  if (/^[/\\]{2}/.test(value) || value.startsWith("\\")) {
    return `VITE_DEMO_REQUEST_ENDPOINT must not be protocol-relative (${value}): use a path such as /api/demo or an absolute https:// URL`;
  }
  if (value.startsWith("/")) {
    return connect.includes("'self'") ? null : `connect-src in public/_headers must include 'self' for ${value}`;
  }
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    return `VITE_DEMO_REQUEST_ENDPOINT must be a path starting with "/" or an absolute https:// URL: ${value}`;
  }
  if (target.protocol !== "https:") return `VITE_DEMO_REQUEST_ENDPOINT must use https:// (${value})`;
  if (connect.includes(target.origin)) return null;
  return `Add ${target.origin} to connect-src in public/_headers: the CSP would block demo requests to ${value}`;
}
