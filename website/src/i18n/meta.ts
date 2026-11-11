/**
 * Language versions of the page and their head metadata. Pure data (no React), shared by the
 * app (runtime) and the build (vite.config.ts writes the static head of each version).
 *
 * English is the main page (US market) at `/`; Portuguese has its own static page at `/pt/`.
 */
export type Locale = "en" | "pt";

/** Path of each language version. */
export const localePath: Record<Locale, string> = { en: "/", pt: "/pt/" };

/** Value for the `<html lang>` attribute and hreflang. */
export const htmlLang: Record<Locale, string> = { en: "en-US", pt: "pt-BR" };

/** Open Graph locale. */
export const ogLocale: Record<Locale, string> = { en: "en_US", pt: "pt_BR" };

/** The language of a path: `/pt` and everything under `/pt/` is Portuguese. */
export function localeFromPath(pathname: string): Locale | null {
  return /^\/pt(\/|$)/.test(pathname) ? "pt" : null;
}

/**
 * The address of a language version: `/` (English) or `/pt/` (Portuguese), keeping other query
 * parameters and the #section, and dropping the legacy `lang` parameter.
 */
export function addressFor(locale: Locale, current: string): string {
  const url = new URL(current);
  url.pathname = localePath[locale];
  url.searchParams.delete("lang");
  return url.pathname + url.search + url.hash;
}

export type PageMeta = {
  title: string;
  description: string;
  /** Open Graph / Twitter card description and image alt text. */
  social: string;
  imageAlt: string;
  noscript: string;
};

/** Page metadata per language (index.html holds the English values; the build checks they match). */
export const pageMeta: Record<Locale, PageMeta> = {
  en: {
    title: "Dinequora — Restaurant Intelligence Platform",
    description:
      "Dinequora is the restaurant management platform for independent restaurants and multi-location groups: point of sale, kitchen display, inventory, purchasing, expenses, financial reports, and team permissions in one place.",
    social: "Run your restaurant. Not the chaos. One platform for operations, inventory, finance, and your team.",
    imageAlt: "Dinequora — Restaurant Intelligence Platform",
    noscript: "Dinequora — Restaurant Intelligence Platform. Please enable JavaScript to view this site.",
  },
  pt: {
    title: "Dinequora — Plataforma de Inteligência para Restaurantes",
    description:
      "Dinequora é a plataforma de gestão para restaurantes independentes e grupos com várias unidades: PDV, tela da cozinha, estoque, compras, despesas, relatórios financeiros e permissões da equipe em um só lugar.",
    social: "Comande seu restaurante. Não o caos. Uma só plataforma para operação, estoque, financeiro e equipe.",
    imageAlt: "Dinequora — Plataforma de Inteligência para Restaurantes",
    noscript: "Dinequora — Plataforma de Inteligência para Restaurantes. Ative o JavaScript para ver este site.",
  },
};
