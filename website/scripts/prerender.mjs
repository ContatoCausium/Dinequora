// Puts the rendered page into the HTML of each language version, after `vite build` and the SSR
// build of src/entry-server.tsx (see the "build" script). Fails the build if a page or the root
// element is missing, so a broken pre-render never ships silently.
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

const site = fileURLToPath(new URL("../", import.meta.url));
const server = new URL("../dist-ssr/entry-server.js", import.meta.url);
const { render } = await import(pathToFileURL(fileURLToPath(server)).href);

const pages = [
  { locale: "en", page: "home", file: "dist/index.html" },
  { locale: "pt", page: "home", file: "dist/pt/index.html" },
  { locale: "en", page: "privacy", file: "dist/privacy/index.html" },
  { locale: "pt", page: "privacy", file: "dist/pt/privacy/index.html" },
];

for (const { locale, page, file } of pages) {
  const path = `${site}${file}`;
  const html = readFileSync(path, "utf8");
  const empty = '<div id="root"></div>';
  if (html.split(empty).length !== 2) throw new Error(`${file}: expected exactly one empty #root`);
  // The CSP (style-src 'self') refuses inline style attributes in HTML. They only carry
  // scroll-driven values (heights, transforms, opacity) that the app sets again when it runs,
  // so the pre-rendered markup leaves them out.
  const body = render(locale, page).replace(/ style="[^"]*"/g, "");
  if (/<style[\s>]|<script(?![^>]*type="application\/ld\+json")/i.test(body)) {
    throw new Error(`${file}: the pre-render must not contain inline <style> or <script> (CSP)`);
  }
  if (!body || body.length < 1000) throw new Error(`${file}: the pre-render came out empty`);
  writeFileSync(path, html.replace(empty, `<div id="root">${body}</div>`));
  console.log(`prerender: ${file} (${page}, ${locale}) ${Math.round(body.length / 1024)} kB of HTML`);
}

// The server bundle is only a build tool; it is not deployed.
rmSync(`${site}dist-ssr`, { recursive: true, force: true });
