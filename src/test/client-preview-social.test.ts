import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Client preview: social sign-in is always off (provisioned e-mail accounts only), even if a
 * provider list leaked into the build. SOCIAL_PROVIDERS is computed when the module loads, so each
 * case loads a fresh copy of it with the build values stubbed.
 */
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

async function providers(profile: string, list: string) {
  vi.resetModules();
  vi.stubEnv("VITE_DEPLOYMENT_PROFILE", profile);
  vi.stubEnv("VITE_AUTH_SOCIAL_PROVIDERS", list);
  const mod = await import("@/lib/auth");
  return mod.SOCIAL_PROVIDERS.filter((p) => p.enabled).map((p) => p.id);
}

afterEach(() => vi.unstubAllEnvs());

describe("social sign-in", () => {
  it("standard: follows VITE_AUTH_SOCIAL_PROVIDERS", async () => {
    expect(await providers("", "google")).toEqual(["google"]);
    expect(await providers("", "")).toEqual([]);
  });
  it("client preview: always none", async () => {
    expect(await providers("client-preview", "google,microsoft")).toEqual([]);
  });
});
