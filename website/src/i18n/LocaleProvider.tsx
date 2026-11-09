import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { detectInitialLocale, htmlLang, LocaleContext, pageMeta, STORAGE_KEY, type Locale } from "./locale";

export function LocaleProvider({ children, initial }: { children: ReactNode; initial?: Locale }) {
  const [locale, setLocaleState] = useState<Locale>(() => initial ?? detectInitialLocale());

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore storage failures; the choice still applies to this visit.
    }
    // Keep the address shareable: English is the default, Portuguese adds ?lang=pt.
    const url = new URL(window.location.href);
    if (next === "en") url.searchParams.delete("lang");
    else url.searchParams.set("lang", next);
    window.history.replaceState(window.history.state, "", url);
  }, []);

  useEffect(() => {
    const meta = pageMeta[locale];
    document.documentElement.lang = htmlLang[locale];
    document.title = meta.title;
    document.querySelector('meta[name="description"]')?.setAttribute("content", meta.description);
    // Each language version is its own canonical page (present only when VITE_SITE_URL is set).
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (canonical) {
      const url = new URL(canonical.href);
      if (locale === "en") url.searchParams.delete("lang");
      else url.searchParams.set("lang", locale);
      canonical.href = url.toString();
    }
  }, [locale]);

  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}
