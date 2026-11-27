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

/** Legal pages, each a static page per language (`/privacy/`, `/pt/privacy/`, `/terms/`, `/pt/terms/`). */
export type LegalPageId = "privacy" | "terms";
export const LEGAL_PAGES: readonly LegalPageId[] = ["privacy", "terms"];

/** Every static page of the site: the home page and the legal pages. */
export type PageId = "home" | LegalPageId;

/** Path of a page in one language: `/`, `/pt/`, `/privacy/`, `/pt/privacy/`. */
export function pagePath(page: PageId, locale: Locale): string {
  return page === "home" ? localePath[locale] : `${localePath[locale]}${page}/`;
}

/** The page a path shows; anything that is not a legal page is the home page. */
export function pageFromPath(pathname: string): PageId {
  const rest = pathname.replace(/^\/pt(?=\/|$)/, "").replace(/^\/+|\/+$/g, "");
  return (LEGAL_PAGES as readonly string[]).includes(rest) ? (rest as LegalPageId) : "home";
}

/**
 * The address of a page in one language: `/` (English) or `/pt/` (Portuguese) for the home page,
 * `/privacy/` or `/pt/privacy/` for a legal page, keeping other query parameters and the #section,
 * and dropping the legacy `lang` parameter. The page defaults to the one of the current address.
 */
export function addressFor(locale: Locale, current: string, page?: PageId): string {
  const url = new URL(current);
  url.pathname = pagePath(page ?? pageFromPath(url.pathname), locale);
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
    description: "Run your restaurant, not the chaos: POS, kitchen display, inventory and finance in one system for independent restaurants and groups. Book a demo.",
    social: "Run your restaurant, not the chaos: POS, kitchen display, inventory and finance in one system for independent restaurants and groups. Book a demo.",
    imageAlt: "Dinequora — Restaurant Intelligence Platform",
    noscript: "Dinequora — Restaurant Intelligence Platform. Please enable JavaScript to view this site.",
  },
  pt: {
    title: "Dinequora — Plataforma de Inteligência para Restaurantes",
    description: "Comande seu restaurante, não o caos: PDV, tela da cozinha, estoque e financeiro num só sistema para restaurantes e grupos. Agende uma demonstração.",
    social: "Comande seu restaurante, não o caos: PDV, tela da cozinha, estoque e financeiro num só sistema para restaurantes e grupos. Agende uma demonstração.",
    imageAlt: "Dinequora — Plataforma de Inteligência para Restaurantes",
    noscript: "Dinequora — Plataforma de Inteligência para Restaurantes. Ative o JavaScript para ver este site.",
  },
};

/** Head metadata of the legal pages (title and description; the social cards reuse them). */
export const legalMeta: Record<LegalPageId, Record<Locale, { title: string; description: string }>> = {
  privacy: {
    en: {
      title: "Privacy Policy — Dinequora",
      description: "How the Dinequora website handles your information: what we collect, why, who we share it with, how long we keep it and how to exercise your rights.",
    },
    pt: {
      title: "Política de Privacidade — Dinequora",
      description: "Como o site da Dinequora trata as suas informações: o que coletamos, para quê, com quem compartilhamos, por quanto tempo guardamos e seus direitos.",
    },
  },
  terms: {
    en: {
      title: "Terms of Use — Dinequora",
      description: "Rules for using the Dinequora website and subscribing to Dinequora: plans, billing periods, implementation fee, cancellation, refunds and governing law.",
    },
    pt: {
      title: "Termos de Uso — Dinequora",
      description: "As regras para usar o site e assinar a Dinequora: planos, períodos de cobrança, taxa de implantação, cancelamento, reembolso e lei aplicável.",
    },
  },
};

/** Title and description of any page in one language. */
export function metaFor(page: PageId, locale: Locale): { title: string; description: string } {
  return page === "home" ? pageMeta[locale] : legalMeta[page][locale];
}
