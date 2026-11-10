import { supabaseAuth } from "./supabase-adapter";
import type { AuthService, SocialProvider } from "./types";

export * from "./types";

/** The single auth implementation used by the app. Replace this adapter to migrate providers. */
export const auth: AuthService = supabaseAuth;

const KNOWN_SOCIAL_PROVIDERS: readonly SocialProvider[] = ["google", "microsoft"];

/**
 * Social sign-in is opt-in per deployment: `VITE_AUTH_SOCIAL_PROVIDERS` lists the providers that
 * are actually configured for this Supabase project (comma-separated, e.g. `google`). Empty or
 * unset = email and password only. The buttons previously relied on the Lovable Cloud broker,
 * which does not work on a self-hosted Supabase project, so nothing is shown unless enabled.
 */
export function socialProvidersFromEnv(
  raw: string | undefined,
): { id: SocialProvider; enabled: boolean }[] {
  const wanted = new Set(
    (raw ?? "")
      .split(",")
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean),
  );
  return KNOWN_SOCIAL_PROVIDERS.map((id) => ({ id, enabled: wanted.has(id) }));
}

/** Social providers shown on sign-in screens. */
export const SOCIAL_PROVIDERS: { id: SocialProvider; enabled: boolean }[] = socialProvidersFromEnv(
  import.meta.env["VITE_AUTH_SOCIAL_PROVIDERS"] as string | undefined,
);

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
