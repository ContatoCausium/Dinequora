/**
 * Site-wide configuration. Everything environment-specific is read from
 * Vite env variables (see .env.example) so nothing is hard-coded per deploy.
 */
import type { Locale } from "../i18n/locale";

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

const rawAppUrl = (import.meta.env.VITE_APP_URL as string | undefined)?.trim() ?? "";
const rawEndpoint = (import.meta.env.VITE_DEMO_REQUEST_ENDPOINT as string | undefined)?.trim() ?? "";

/** Base URL of the restaurant application. Empty string = same origin. */
export const APP_URL = trimSlash(rawAppUrl);

export type AppRoutes = { readonly login: string; readonly signup: string };

/**
 * Login and sign-up routes of the restaurant application, or `null` while the application is
 * not published. Links are off unless VITE_APP_LINKS_ENABLED is exactly "true", so a build never
 * points visitors at an address that does not exist yet; while off, the header, mobile menu and
 * footer show "Coming soon" and render no link to the application.
 */
export function getAppRoutes(env: { VITE_APP_LINKS_ENABLED?: string | undefined }, appUrl: string): AppRoutes | null {
  if (env.VITE_APP_LINKS_ENABLED?.trim() !== "true") return null;
  return { login: `${appUrl}/auth`, signup: `${appUrl}/signup` };
}

export const appRoutes: AppRoutes | null = getAppRoutes(
  { VITE_APP_LINKS_ENABLED: import.meta.env.VITE_APP_LINKS_ENABLED as string | undefined },
  APP_URL,
);

/**
 * Endpoint that receives demo requests. `null` means the form is not yet
 * connected to a delivery backend — the UI must say so and never pretend
 * a request was delivered.
 */
export const DEMO_REQUEST_ENDPOINT: string | null = rawEndpoint === "" ? null : rawEndpoint;

/** Official sales WhatsApp line (US number). */
export const WHATSAPP = {
  /** Digits only, with country code, as wa.me expects. */
  number: "15087149654",
  display: "+1 (508) 714-9654",
} as const;

/** Click-to-chat link; `text` pre-fills the visitor's message (they still press send). */
export function whatsappUrl(text?: string): string {
  const base = `https://wa.me/${WHATSAPP.number}`;
  return text ? `${base}?text=${encodeURIComponent(text)}` : base;
}

/**
 * Company Instagram profile. TODO: replace the fallback with the company profile,
 * e.g. "https://www.instagram.com/dinequora/", or set VITE_INSTAGRAM_URL at build time.
 * Until then the icon opens Instagram's home page.
 */
const rawInstagram = (import.meta.env.VITE_INSTAGRAM_URL as string | undefined)?.trim() ?? "";
export const INSTAGRAM_URL = rawInstagram || "https://www.instagram.com/";

export const whatsappGreeting: Record<Locale, string> = {
  en: "Hi! I'd like to learn more about Dinequora.",
  pt: "Olá! Quero saber mais sobre o Dinequora.",
};

export type NavItem = { label: string; href: string };

const navLabels: Record<Locale, Record<"platform" | "features" | "pricing" | "implementation" | "about", string>> = {
  en: { platform: "Platform", features: "Features", pricing: "Pricing", implementation: "Implementation", about: "About" },
  pt: { platform: "Plataforma", features: "Recursos", pricing: "Preços", implementation: "Implantação", about: "Sobre" },
};

export function getPrimaryNav(locale: Locale): readonly NavItem[] {
  const l = navLabels[locale];
  return [
    { label: l.platform, href: "#platform" },
    { label: l.features, href: "#features" },
    { label: l.pricing, href: "#pricing" },
    { label: l.implementation, href: "#implementation" },
    { label: l.about, href: "#about" },
  ];
}

export const DEMO_ANCHOR = "#demo";
