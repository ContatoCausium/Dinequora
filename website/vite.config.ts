/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { readFileSync } from "node:fs";
import { demoEndpointCspProblem, englishIndexHtml, portugueseIndexHtml, robotsTxt, sitemapXml } from "./src/build/seo.ts";

/**
 * English page head: when VITE_SITE_URL is set, absolute Open Graph image URLs (social crawlers
 * require them), canonical, og:url and hreflang alternates for `/` and `/pt/`.
 */
function englishHead(siteUrl: string): Plugin {
  return {
    name: "dinequora-english-head",
    transformIndexHtml(html) {
      return englishIndexHtml(html, siteUrl);
    },
  };
}

/**
 * Preloads the Latin subset of Inter Variable, the face of the opening's name and headline, so the
 * first screen does not wait for the stylesheet to discover it. The file name is hashed, so it is
 * read from the bundle.
 */
function preloadHeadlineFont(): Plugin {
  return {
    name: "dinequora-preload-headline-font",
    apply: (_config, env) => env.command === "build" && !env.isSsrBuild,
    transformIndexHtml: {
      order: "post",
      handler(html, ctx) {
        const file = Object.keys(ctx.bundle ?? {}).find((name) => /inter-latin-wght-normal-[\w-]+\.woff2$/.test(name));
        if (!file) return html;
        return html.replace(
          "</head>",
          `    <link rel="preload" as="font" type="font/woff2" href="/${file}" crossorigin />\n  </head>`,
        );
      },
    },
  };
}

/**
 * Build output beyond the bundle:
 *  - pt/index.html: the Portuguese page with its own static head (lang, title, description,
 *    canonical /pt/, hreflang), derived from the built English page;
 *  - robots.txt (always) and sitemap.xml (when VITE_SITE_URL is set);
 *  - stops the build if the demo-request endpoint would be blocked by the CSP in public/_headers.
 */
function languagePagesAndSeoFiles(siteUrl: string, demoEndpoint: string): Plugin {
  return {
    name: "dinequora-language-pages-seo",
    // Not in the server build of src/entry-server.tsx (it has no index.html).
    apply: (_config, env) => env.command === "build" && !env.isSsrBuild,
    enforce: "post",
    buildStart() {
      const headers = readFileSync(new URL("./public/_headers", import.meta.url), "utf8");
      const problem = demoEndpointCspProblem(headers, demoEndpoint);
      if (problem) this.error(problem);
    },
    generateBundle(_options, bundle) {
      const english = bundle["index.html"];
      if (!english || english.type !== "asset") this.error("index.html was not emitted");
      const source = typeof english.source === "string" ? english.source : new TextDecoder().decode(english.source);
      this.emitFile({ type: "asset", fileName: "pt/index.html", source: portugueseIndexHtml(source, siteUrl) });
      this.emitFile({ type: "asset", fileName: "robots.txt", source: robotsTxt(siteUrl) });
      if (siteUrl.trim()) this.emitFile({ type: "asset", fileName: "sitemap.xml", source: sitemapXml(siteUrl) });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  const siteUrl = env["VITE_SITE_URL"] ?? "";
  return {
    plugins: [
      react(),
      tailwindcss(),
      englishHead(siteUrl),
      preloadHeadlineFont(),
      languagePagesAndSeoFiles(siteUrl, env["VITE_DEMO_REQUEST_ENDPOINT"] ?? ""),
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
