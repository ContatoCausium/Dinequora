import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROBOTS_TXT } from "../../scripts/preview/build-client-preview.mjs";
import {
  assertCleanProductionContext,
  hardenProductionOutput,
  ProductionBuildRefusal,
  validateProductionBuildEnv,
} from "../../scripts/production/build-production.mjs";
import {
  PRODUCTION_DOMAIN,
  PRODUCTION_WORKER_NAME,
  scanBundle,
} from "../../scripts/preview/verify-bundle.mjs";
import { parseDeploymentProfile } from "@/lib/deployment-profile";
import { withSecurityHeaders } from "@/lib/security-headers";

/**
 * Production build (scripts/production/build-production.mjs): only the public values of the expected
 * project, e-mail sign-in only, the Worker dinequora-app served on app.dinequora.com only (no
 * workers.dev, no version preview URLs), and the bundle verifier with the production target.
 */
const REF = "abcdefghij0123456789";
const URL_ = `https://${REF}.supabase.co`;
const KEY = "sb_publishable_AbCdEfGhIjKlMnOpQrStUv";
const values = (over: Record<string, string> = {}) => ({
  VITE_SUPABASE_URL: URL_,
  VITE_SUPABASE_PUBLISHABLE_KEY: KEY,
  VITE_AUTH_SOCIAL_PROVIDERS: "",
  VITE_SUPPORT_EMAIL: "support@dinequora.com",
  ...over,
});

const temps: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "dq-production-"));
  temps.push(d);
  return d;
};
afterEach(() => {
  for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("production profile", () => {
  it("is its own profile, and turns the security headers on like the preview", () => {
    expect(parseDeploymentProfile("production")).toBe("production");
    expect(parseDeploymentProfile("Production")).toBe("production");
    const res = withSecurityHeaders(
      new Response("ok"),
      new Request("https://app.dinequora.com/"),
      true,
    );
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Strict-Transport-Security")).toBeTruthy();
  });
});

describe("production build values", () => {
  it("accepts the public values of the expected project", () => {
    expect(validateProductionBuildEnv(values(), { expectRef: REF })).toEqual({
      url: URL_,
      key: KEY,
      ref: REF,
    });
  });

  it.each([
    ["another project", { VITE_SUPABASE_URL: "https://zzzzzzzzzz9999999999.supabase.co" }],
    ["a local URL", { VITE_SUPABASE_URL: "http://127.0.0.1:55321" }],
    ["a secret key", { VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_0123456789abcdefghij" }],
    ["a JWT instead of a publishable key", { VITE_SUPABASE_PUBLISHABLE_KEY: "eyJabc.eyJdef.sig" }],
    [
      "social sign-in (not working on the own project yet)",
      { VITE_AUTH_SOCIAL_PROVIDERS: "google" },
    ],
    ["another profile", { VITE_DEPLOYMENT_PROFILE: "client-preview" }],
    ["a server-only value", { SUPABASE_SERVICE_ROLE_KEY: "x" }],
  ])("refuses %s", (_label, over) => {
    expect(() => validateProductionBuildEnv(values(over), { expectRef: REF })).toThrow(
      ProductionBuildRefusal,
    );
  });

  it("refuses without --expect-ref, or with another one", () => {
    expect(() => validateProductionBuildEnv(values())).toThrow(ProductionBuildRefusal);
    expect(() =>
      validateProductionBuildEnv(values(), { expectRef: "zzzzzzzzzz9999999999" }),
    ).toThrow(ProductionBuildRefusal);
  });

  it("refuses a checkout with .env files Vite would load, or a leaking shell", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, ".env.production.local"), "");
    expect(() => assertCleanProductionContext(dir, {})).not.toThrow();
    for (const f of [".env", ".env.local", ".env.production"]) {
      fs.writeFileSync(path.join(dir, f), "VITE_SUPABASE_URL=http://127.0.0.1:55321\n");
      expect(() => assertCleanProductionContext(dir, {})).toThrow(ProductionBuildRefusal);
      fs.rmSync(path.join(dir, f));
    }
    expect(() => assertCleanProductionContext(dir, { VITE_SUPABASE_URL: "x" })).toThrow(
      ProductionBuildRefusal,
    );
  });
});

/** A minimal cloudflare-module build output with a clean production bundle. */
function fixture(): string {
  const out = tmp();
  const w = (p: string, s: string) => {
    fs.mkdirSync(path.dirname(path.join(out, p)), { recursive: true });
    fs.writeFileSync(path.join(out, p), s);
  };
  w("nitro.json", JSON.stringify({ preset: "cloudflare-module" }));
  w(
    "server/wrangler.json",
    JSON.stringify({
      name: "tanstack-start-ts",
      main: "index.mjs",
      compatibility_flags: ["nodejs_compat"],
    }),
  );
  w("server/index.mjs", `const url = "${URL_}"; const profile = "production";`);
  w("public/assets/client.js", `const u="${URL_}",k="${KEY}",m=parseProfile("production");`);
  w("public/_headers", "/assets/*\n  cache-control: public, max-age=31536000, immutable\n");
  w("public/robots.txt", "User-agent: *\nAllow: /\n");
  return out;
}
const scan = (out: string) =>
  scanBundle(out, { expectedSupabaseUrl: URL_, expectedPublishableKey: KEY, target: "production" });

describe("production output", () => {
  it("serves dinequora-app on app.dinequora.com only, with no-index assets", () => {
    const out = fixture();
    hardenProductionOutput(out);
    expect(fs.readFileSync(path.join(out, "public/robots.txt"), "utf8")).toBe(ROBOTS_TXT);
    const wrangler = JSON.parse(fs.readFileSync(path.join(out, "server/wrangler.json"), "utf8"));
    expect(wrangler).toMatchObject({
      name: PRODUCTION_WORKER_NAME,
      workers_dev: false,
      preview_urls: false,
      routes: [{ pattern: PRODUCTION_DOMAIN, custom_domain: true }],
    });
    expect(scan(out).errors).toEqual([]);
  });

  it("refuses a production bundle served on workers.dev, with preview URLs or another domain", () => {
    for (const patch of [
      (w: Record<string, unknown>) => ({ ...w, workers_dev: true }),
      (w: Record<string, unknown>) => ({ ...w, preview_urls: true }),
      (w: Record<string, unknown>) => ({
        ...w,
        routes: [{ pattern: "evil.example.com", custom_domain: true }],
      }),
      (w: Record<string, unknown>) => ({ ...w, name: "dinequora-client-preview" }),
    ]) {
      const out = fixture();
      hardenProductionOutput(out);
      const file = path.join(out, "server/wrangler.json");
      fs.writeFileSync(file, JSON.stringify(patch(JSON.parse(fs.readFileSync(file, "utf8")))));
      expect(scan(out).errors.length).toBeGreaterThan(0);
    }
  });

  it("allows the Stripe and service-role names in server files only", () => {
    const out = fixture();
    hardenProductionOutput(out);
    fs.writeFileSync(
      path.join(out, "server/billing.mjs"),
      `const k = process.env["STRIPE_SECRET_KEY"]; const s = process.env["SUPABASE_SERVICE_ROLE_KEY"];`,
    );
    expect(scan(out).errors).toEqual([]);
    // The client preview still refuses them on the server...
    expect(
      scanBundle(out, { expectedSupabaseUrl: URL_, expectedPublishableKey: KEY }).errors.some((e) =>
        /service-role client|payment provider/.test(e.message),
      ),
    ).toBe(true);
    // ...and production refuses them in the browser bundle.
    fs.writeFileSync(path.join(out, "public/assets/leak.js"), `x="STRIPE_SECRET_KEY"`);
    expect(scan(out).errors.length).toBeGreaterThan(0);
  });

  it("a production output fails the client-preview check, and the other way round", () => {
    const out = fixture();
    hardenProductionOutput(out);
    expect(
      scanBundle(out, { expectedSupabaseUrl: URL_, expectedPublishableKey: KEY }).errors.length,
    ).toBeGreaterThan(0);
  });
});
