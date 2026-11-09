import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import enAuth from "@/locales/en-US/auth.json";
import enCommon from "@/locales/en-US/common.json";
import enControl from "@/locales/en-US/control.json";
import enDashboard from "@/locales/en-US/dashboard.json";
import enFinance from "@/locales/en-US/finance.json";
import enIntelligence from "@/locales/en-US/intelligence.json";
import enInventory from "@/locales/en-US/inventory.json";
import enKds from "@/locales/en-US/kds.json";
import enLocations from "@/locales/en-US/locations.json";
import enMenu from "@/locales/en-US/menu.json";
import enOperations from "@/locales/en-US/operations.json";
import enOrders from "@/locales/en-US/orders.json";
import enPos from "@/locales/en-US/pos.json";
import enReports from "@/locales/en-US/reports.json";
import enSettings from "@/locales/en-US/settings.json";
import enTeam from "@/locales/en-US/team.json";
import ptAuth from "@/locales/pt-BR/auth.json";
import ptCommon from "@/locales/pt-BR/common.json";
import ptControl from "@/locales/pt-BR/control.json";
import ptDashboard from "@/locales/pt-BR/dashboard.json";
import ptFinance from "@/locales/pt-BR/finance.json";
import ptIntelligence from "@/locales/pt-BR/intelligence.json";
import ptInventory from "@/locales/pt-BR/inventory.json";
import ptKds from "@/locales/pt-BR/kds.json";
import ptLocations from "@/locales/pt-BR/locations.json";
import ptMenu from "@/locales/pt-BR/menu.json";
import ptOperations from "@/locales/pt-BR/operations.json";
import ptOrders from "@/locales/pt-BR/orders.json";
import ptPos from "@/locales/pt-BR/pos.json";
import ptReports from "@/locales/pt-BR/reports.json";
import ptSettings from "@/locales/pt-BR/settings.json";
import ptTeam from "@/locales/pt-BR/team.json";

export const LANGUAGES = [
  { code: "en-US", label: "English (US)", short: "EN" },
  { code: "pt-BR", label: "Português (BR)", short: "PT" },
] as const;
export type LanguageCode = (typeof LANGUAGES)[number]["code"];
export const DEFAULT_LANGUAGE: LanguageCode = "en-US";
const STORAGE_KEY = "servora.lang";

/** Single registry: adding a namespace = one json per language + one line per language here. */
const RESOURCES = {
  "en-US": {
    common: enCommon,
    dashboard: enDashboard,
    locations: enLocations,
    settings: enSettings,
    auth: enAuth,
    team: enTeam,
    control: enControl,
    menu: enMenu,
    inventory: enInventory,
    finance: enFinance,
    operations: enOperations,
    orders: enOrders,
    pos: enPos,
    kds: enKds,
    reports: enReports,
    intelligence: enIntelligence,
  },
  "pt-BR": {
    common: ptCommon,
    dashboard: ptDashboard,
    locations: ptLocations,
    settings: ptSettings,
    auth: ptAuth,
    team: ptTeam,
    control: ptControl,
    menu: ptMenu,
    inventory: ptInventory,
    finance: ptFinance,
    operations: ptOperations,
    orders: ptOrders,
    pos: ptPos,
    kds: ptKds,
    reports: ptReports,
    intelligence: ptIntelligence,
  },
};
const NAMESPACES = Object.keys(RESOURCES["en-US"]);

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: RESOURCES,
    lng: DEFAULT_LANGUAGE,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: LANGUAGES.map((l) => l.code),
    ns: NAMESPACES,
    defaultNS: "common",
    interpolation: { escapeValue: false },
    initAsync: false,
    react: { useSuspense: false },
  });
}

/** Resolution order (guest): saved preference → browser language → default. Call from useEffect only. */
export function resolveClientLanguage(): LanguageCode {
  const saved = window.localStorage.getItem(STORAGE_KEY);
  if (saved && LANGUAGES.some((l) => l.code === saved)) return saved as LanguageCode;
  const nav = window.navigator.language?.toLowerCase() ?? "";
  return nav.startsWith("pt") ? "pt-BR" : DEFAULT_LANGUAGE;
}

export function setLanguage(code: LanguageCode) {
  window.localStorage.setItem(STORAGE_KEY, code);
  document.documentElement.lang = code;
  void i18n.changeLanguage(code);
}

/**
 * Applies the guest/saved language only after hydration has fully settled, so
 * server-rendered (default-language) markup is never compared against translated text.
 */
export function applyClientLanguageAfterHydration(code: LanguageCode = resolveClientLanguage()) {
  if (code === i18n.language) return;
  const run = () => setLanguage(code);
  const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number })
    .requestIdleCallback;
  if (document.readyState === "complete") {
    if (idle) idle(run);
    else window.setTimeout(run, 0);
  } else
    window.addEventListener("load", () => (idle ? idle(run) : window.setTimeout(run, 0)), {
      once: true,
    });
}

export default i18n;

// Keep namespaces registered even when the i18n instance was initialised earlier (SSR module reuse).
for (const [lng, nss] of Object.entries(RESOURCES)) {
  for (const [ns, res] of Object.entries(nss)) {
    i18n.addResourceBundle(lng, ns, res, true, true);
  }
}
