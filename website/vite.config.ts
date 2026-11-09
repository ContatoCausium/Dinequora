/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react(), tailwindcss(), absoluteMetaUrls(env["VITE_SITE_URL"] ?? "")],
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
