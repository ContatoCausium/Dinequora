/**
 * Build-time rendering of the page (see scripts/prerender.mjs). The HTML that the server delivers
 * then already holds the title, the headings and the text of each language version, so crawlers
 * and link previews that do not run JavaScript see the real page. In the browser, main.tsx renders
 * the app over it as before.
 */
import { renderToString } from "react-dom/server";
import { App } from "./App";
import type { Locale, PageId } from "./i18n/meta";

export function render(locale: Locale, page: PageId = "home"): string {
  return renderToString(<App initialLocale={locale} page={page} />);
}
