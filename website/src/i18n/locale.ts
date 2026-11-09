/**
 * Language support: English (default, US market) and Brazilian Portuguese.
 *
 * The active language comes from, in order:
 *   1. the `?lang=en|pt` URL parameter (shareable links),
 *   2. the visitor's last choice (localStorage),
 *   3. the browser language (Portuguese browsers get Portuguese),
 *   4. English.
 */
import { createContext, useContext } from "react";

export type Locale = "en" | "pt";

export const LOCALES: readonly Locale[] = ["en", "pt"];

export const STORAGE_KEY = "dinequora.lang";

/** Value for the `<html lang>` attribute. */
export const htmlLang: Record<Locale, string> = { en: "en-US", pt: "pt-BR" };

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

/** Page title and description per language (kept in sync with index.html for English). */
export const pageMeta: Record<Locale, { title: string; description: string }> = {
  en: {
    title: "Dinequora — Restaurant Intelligence Platform",
    description:
      "Dinequora is the restaurant management platform for independent restaurants and multi-location groups: point of sale, kitchen display, inventory, purchasing, expenses, financial reports, and team permissions in one place.",
  },
  pt: {
    title: "Dinequora — Plataforma de Inteligência para Restaurantes",
    description:
      "Dinequora é a plataforma de gestão para restaurantes independentes e grupos com várias unidades: PDV, tela da cozinha, estoque, compras, despesas, relatórios financeiros e permissões da equipe em um só lugar.",
  },
};
