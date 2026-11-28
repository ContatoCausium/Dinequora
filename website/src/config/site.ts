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

/** The published restaurant application (Cloudflare Worker dinequora-app, live since 2026-11-28). */
export const PRODUCTION_APP_URL = "https://app.dinequora.com";

/** Base URL of the restaurant application: VITE_APP_URL when set, otherwise the production app. */
export const APP_URL = trimSlash(rawAppUrl) || PRODUCTION_APP_URL;

export type AppRoutes = { readonly login: string; readonly signup: string };

/**
 * Login and sign-up routes of the restaurant application. The application is published, so the
 * links are on by default; VITE_APP_LINKS_ENABLED="false" is the kill switch that brings back the
 * "Coming soon" state (header, mobile menu and footer show the badge and render no link).
 */
export function getAppRoutes(env: { VITE_APP_LINKS_ENABLED?: string | undefined }, appUrl: string): AppRoutes | null {
  if (env.VITE_APP_LINKS_ENABLED?.trim() === "false") return null;
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
