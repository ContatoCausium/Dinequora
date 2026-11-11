/**
 * Language support: English (default, US market) and Brazilian Portuguese.
 *
 * Each language has its own address: English at `/`, Portuguese at `/pt/` (a static page with
 * Portuguese metadata, see src/i18n/meta.ts). The active language comes from, in order:
 *   1. the path (`/pt/` is always Portuguese),
 *   2. the legacy `?lang=en|pt` parameter (old shared links; the address then moves to the right path),
 *   3. the visitor's last choice (localStorage),
 *   4. the browser language (Portuguese browsers get Portuguese),
 *   5. English.
 */
import { createContext, useContext } from "react";
import { htmlLang, localeFromPath, localePath, pageMeta, type Locale } from "./meta";

export { htmlLang, localeFromPath, localePath, pageMeta, type Locale };

export const LOCALES: readonly Locale[] = ["en", "pt"];

export const STORAGE_KEY = "dinequora.lang";

export const localeName: Record<Locale, string> = { en: "English", pt: "Português" };

export function isLocale(value: unknown): value is Locale {
  return value === "en" || value === "pt";
}

/** Pick the English or Portuguese variant of a value. */
export function pick<T>(locale: Locale, en: T, pt: T): T {
  return locale === "pt" ? pt : en;
}

export function detectInitialLocale(): Locale {
  if (typeof window === "undefined") return "en";
  const fromPath = localeFromPath(window.location.pathname);
  if (fromPath) return fromPath;
  const fromUrl = new URLSearchParams(window.location.search).get("lang");
  if (isLocale(fromUrl)) return fromUrl;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // Storage can be unavailable (privacy mode); fall through.
  }
  const browser = window.navigator.language?.toLowerCase() ?? "";
  return browser.startsWith("pt") ? "pt" : "en";
}

type LocaleContextValue = { locale: Locale; setLocale: (locale: Locale) => void };

export const LocaleContext = createContext<LocaleContextValue>({ locale: "en", setLocale: () => {} });

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext);
}

/** Returns `t(en, pt)`, which picks the variant for the active language. */
export function useT(): <T>(en: T, pt: T) => T {
  const { locale } = useContext(LocaleContext);
  return (en, pt) => pick(locale, en, pt);
}
