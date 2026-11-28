import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { detectInitialLocale, htmlLang, LocaleContext, STORAGE_KEY, type Locale } from "./locale";
import { addressFor, metaFor, pagePath, type PageId } from "./meta";

export function LocaleProvider({ children, initial, page = "home" }: { children: ReactNode; initial?: Locale; page?: PageId }) {
  const [locale, setLocaleState] = useState<Locale>(() => initial ?? detectInitialLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore storage failures; the choice still applies to this visit.
    }
  }, []);

  useEffect(() => {
    // Keep the address on the static page of the active language (no reload: same content).
    const target = addressFor(locale, window.location.href, page);
    const current = window.location.pathname + window.location.search + window.location.hash;
    if (target !== current) window.history.replaceState(window.history.state, "", target);

    const meta = metaFor(page, locale);
    document.documentElement.lang = htmlLang[locale];
    document.title = meta.title;
    document.querySelector('meta[name="description"]')?.setAttribute("content", meta.description);
    // The static pages already carry these; keep them right after a language switch.
    // (canonical and og:url exist only when VITE_SITE_URL is set.)
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonical) canonical.href = new URL(pagePath(page, locale), canonical.href).toString();
    const ogUrl = document.querySelector('meta[property="og:url"]');
    const ogUrlValue = ogUrl?.getAttribute("content");
    if (ogUrl && ogUrlValue) ogUrl.setAttribute("content", new URL(pagePath(page, locale), ogUrlValue).toString());
  }, [locale, page]);

  const value = useMemo(() => ({ locale, setLocale, page }), [locale, setLocale, page]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
