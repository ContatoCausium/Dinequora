/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { demoEndpointCspProblem, robotsTxt, sitemapXml } from "./src/build/seo.ts";

/**
 * When VITE_SITE_URL is set, add a canonical link and make Open Graph / Twitter
 * URLs absolute (social crawlers require absolute image URLs).
 */
function absoluteMetaUrls(siteUrl: string): Plugin {
  const base = siteUrl.replace(/\/+$/, "");
  return {
    name: "dinequora-absolute-meta",
    transformIndexHtml(html) {
      if (!base) return html;
      return html
        .replace(/content="\/og-image\.jpg"/g, `content="${base}/og-image.jpg"`)
        .replace(
          "</head>",
          [
            `    <link rel="canonical" href="${base}/" />`,
            `    <meta property="og:url" content="${base}/" />`,
            // The site is available in English (default) and Portuguese (?lang=pt).
            `    <link rel="alternate" hreflang="en-US" href="${base}/" />`,
            `    <link rel="alternate" hreflang="pt-BR" href="${base}/?lang=pt" />`,
            `    <link rel="alternate" hreflang="x-default" href="${base}/" />`,
            `  </head>`,
          ].join("\n"),
        );
    },
  };
}

/**
 * Emits robots.txt (always) and sitemap.xml (when VITE_SITE_URL is set), and stops the build if
 * the demo-request endpoint would be blocked by the CSP in public/_headers.
 */
function seoAndSecurityFiles(siteUrl: string, demoEndpoint: string): Plugin {
  return {
    name: "dinequora-seo-security",
    apply: "build",
    buildStart() {
      const headers = readFileSync(new URL("./public/_headers", import.meta.url), "utf8");
      const problem = demoEndpointCspProblem(headers, demoEndpoint.trim(), siteUrl.trim());
      if (problem) this.error(problem);
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "robots.txt", source: robotsTxt(siteUrl.trim()) });
      if (siteUrl.trim()) this.emitFile({ type: "asset", fileName: "sitemap.xml", source: sitemapXml(siteUrl.trim()) });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [
      react(),
      tailwindcss(),
      absoluteMetaUrls(env["VITE_SITE_URL"] ?? ""),
      seoAndSecurityFiles(env["VITE_SITE_URL"] ?? "", env["VITE_DEMO_REQUEST_ENDPOINT"] ?? ""),
    ],
    server: { port: 5180, strictPort: true },
    preview: { port: 5181, strictPort: true },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      css: false,
    },
  };
});
