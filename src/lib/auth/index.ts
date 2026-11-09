import { supabaseAuth } from "./supabase-adapter";
import type { AuthService, SocialProvider } from "./types";

export * from "./types";

/** The single auth implementation used by the app. Replace this adapter to migrate providers. */
export const auth: AuthService = supabaseAuth;

/** Social providers shown on sign-in screens. Toggle here when a provider is (de)configured. */
export const SOCIAL_PROVIDERS: { id: SocialProvider; enabled: boolean }[] = [
  { id: "google", enabled: true },
  { id: "microsoft", enabled: true },
];

/** Accept only same-origin relative paths for post-auth redirects. */
export function safeRedirect(path: unknown, fallback = "/"): string {
  if (
    typeof path !== "string" ||
    !path.startsWith("/") ||
    path.startsWith("//") ||
    path.startsWith("/\\")
  )
    return fallback;
  return path;
}

const PENDING_KEY = "servora.auth.next";
export const pendingRedirect = {
  set: (p: string) => window.sessionStorage.setItem(PENDING_KEY, safeRedirect(p)),
  take: () => {
    const v = window.sessionStorage.getItem(PENDING_KEY);
    window.sessionStorage.removeItem(PENDING_KEY);
    return v ? safeRedirect(v) : null;
  },
};

/** "Keep me signed in": when off, the session ends with the browser session. */
const EPHEMERAL = "servora.auth.ephemeral";
const ALIVE = "servora.auth.alive";
export const sessionPersistence = {
  set(remember: boolean) {
    window.localStorage.setItem(EPHEMERAL, remember ? "0" : "1");
    window.sessionStorage.setItem(ALIVE, "1");
  },
  /** True when a non-remembered session survived a browser restart and must be ended. */
  expired() {
    return window.localStorage.getItem(EPHEMERAL) === "1" && !window.sessionStorage.getItem(ALIVE);
  },
};
