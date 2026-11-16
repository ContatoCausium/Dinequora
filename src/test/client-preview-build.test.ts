import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ASSET_HEADERS,
  assertCleanBuildContext,
  BuildRefusal,
  hardenOutput,
  parseEnvFile,
  ROBOTS_TXT,
  validatePreviewBuildEnv,
} from "../../scripts/preview/build-client-preview.mjs";
import { scanBundle, WORKER_NAME } from "../../scripts/preview/verify-bundle.mjs";

/**
 * Client-preview build (scripts/preview/build-client-preview.mjs) and bundle verification
 * (scripts/preview/verify-bundle.mjs): the build accepts only public values of the expected hosted
 * project and refuses a checkout or shell that would leak other environments (e.g. the QA URL of a
 * local .env.local); the verifier rejects any bundle that carries a credential, another project, a
 * local stack or a connection string. Build outputs here are small synthetic fixtures.
 */
const REF = "abcdefghij0123456789";
const OTHER = "zzzzzzzzzz9999999999";
const URL_ = `https://${REF}.supabase.co`;
const KEY = "sb_publishable_AbCdEfGhIjKlMnOpQrStUv";
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload: Record<string, unknown>) =>
  `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.c2lnbmF0dXJlLXNpZ25hdHVyZQ`;
const values = (over: Record<string, string> = {}) => ({
  VITE_SUPABASE_URL: URL_,
  VITE_SUPABASE_PUBLISHABLE_KEY: KEY,
  VITE_AUTH_SOCIAL_PROVIDERS: "",
  VITE_SUPPORT_EMAIL: "",
  ...over,
});

const temps: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "dq-preview-"));
  temps.push(d);
  return d;
};
afterEach(() => {
  for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("build values", () => {
  it("accepts the public values of the expected project", () => {
    expect(validatePreviewBuildEnv(values(), { expectRef: REF })).toEqual({
      url: URL_,
      key: KEY,
      ref: REF,
    });
    const anon = jwt({ role: "anon", ref: REF });
    expect(
      validatePreviewBuildEnv(values({ VITE_SUPABASE_PUBLISHABLE_KEY: anon }), { expectRef: REF })
        .key,
    ).toBe(anon);
  });

  it.each([
    ["the QA URL", { VITE_SUPABASE_URL: "http://127.0.0.1:55321" }],
    ["a local https URL", { VITE_SUPABASE_URL: "https://localhost:54321" }],
    ["another project", { VITE_SUPABASE_URL: `https://${OTHER}.supabase.co` }],
    ["a non-Supabase host", { VITE_SUPABASE_URL: "https://api.example.com" }],
    ["a URL with a path", { VITE_SUPABASE_URL: `${URL_}/rest/v1` }],
    ["a secret key", { VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_0123456789abcdefghij" }],
    [
      "a service_role JWT",
      { VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ role: "service_role", ref: REF }) },
    ],
    [
      "an anon JWT of another project",
      { VITE_SUPABASE_PUBLISHABLE_KEY: jwt({ role: "anon", ref: OTHER }) },
    ],
    ["social sign-in", { VITE_AUTH_SOCIAL_PROVIDERS: "google" }],
    ["another profile", { VITE_DEPLOYMENT_PROFILE: "standard" }],
    ["a server-only value", { SUPABASE_SERVICE_ROLE_KEY: "x" }],
    ["an unknown key", { VITE_SOMETHING: "x" }],
    ["a bad support e-mail", { VITE_SUPPORT_EMAIL: "support" }],
  ])("refuses %s", (_label, over) => {
    expect(() => validatePreviewBuildEnv(values(over), { expectRef: REF })).toThrow(BuildRefusal);
  });

  it("refuses a real build without --expect-ref", () => {
    expect(() => validatePreviewBuildEnv(values(), {})).toThrow(/--expect-ref/);
  });

  it("placeholder builds accept only a reserved .invalid host and a placeholder key", () => {
    const placeholder = {
      VITE_SUPABASE_URL: "https://dinequora-preview-placeholder.invalid",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_PLACEHOLDER_not_a_real_key",
    };
    expect(validatePreviewBuildEnv(placeholder, { placeholder: true }).ref).toBeNull();
    expect(() => validatePreviewBuildEnv(values(), { placeholder: true })).toThrow(BuildRefusal);
    expect(() =>
      validatePreviewBuildEnv(
        { ...placeholder, VITE_SUPABASE_PUBLISHABLE_KEY: KEY },
        { placeholder: true },
      ),
    ).toThrow(BuildRefusal);
  });

  it("parses the env file (comments, quotes, CRLF)", () => {
    expect(
      parseEnvFile(`# c\r\nVITE_SUPABASE_URL="${URL_}"\r\n\r\nVITE_AUTH_SOCIAL_PROVIDERS=\r\n`),
    ).toEqual({
      VITE_SUPABASE_URL: URL_,
      VITE_AUTH_SOCIAL_PROVIDERS: "",
    });
    expect(() => parseEnvFile("garbage line")).toThrow(BuildRefusal);
  });
});

describe("build context", () => {
  it("refuses a checkout with .env, .env.local or .env.client-preview", () => {
    for (const f of [".env", ".env.local", ".env.client-preview"]) {
      const dir = tmp();
      fs.writeFileSync(path.join(dir, f), "VITE_SUPABASE_URL=http://127.0.0.1:55321\n");
      expect(() => assertCleanBuildContext(dir, {}), f).toThrow(/clean checkout/);
    }
  });
  it("refuses a shell that exports values Vite would build in", () => {
    const dir = tmp();
    for (const env of [
      { VITE_SUPABASE_URL: "http://127.0.0.1:55321" },
      { SUPABASE_URL: "x" },
      { NITRO_PRESET: "node" },
      { SERVER_PRESET: "node" },
      { LOVABLE_SANDBOX: "1" },
    ])
      expect(() => assertCleanBuildContext(dir, env)).toThrow(BuildRefusal);
  });
  it("accepts a clean checkout (only the preview file) and an unrelated shell", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, ".env.client-preview.local"), "");
    fs.writeFileSync(path.join(dir, ".env.example"), "");
    expect(() =>
      assertCleanBuildContext(dir, { PATH: "/bin", PREVIEW_BUNDLE_DENY: "x" }),
    ).not.toThrow();
  });
});

/** A minimal cloudflare-module build output, as Nitro writes it, with a clean preview bundle. */
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
  w(
    "server/index.mjs",
    [
      `const url = "${URL_}"; const profile = "client-preview";`,
      // library constants that are not backends of the app
      `var GOTRUE_URL = "http://localhost:9999"; var cb = "http://127.0.0.1/iframe-oauth/callback";`,
      `const dev = ["https://lovable.dev", "http://localhost:3000"]; const p = "sb_secret_";`,
      `t.push("*.supabase.co", "localhost", "127.0.0.1");`,
      // TanStack Router origin fallback when there is no window.origin
      `if (!this.origin) this.origin = "http://localhost";`,
    ].join("\n"),
  );
  w("server/_ssr/manifest.mjs", `filePath: "C:/dev/Dinequora-client-preview/src/routes/auth.tsx"`);
  w("public/assets/client.js", `const u="${URL_}",k="${KEY}",m=parseProfile("client-preview");`);
  w("public/_headers", "/assets/*\n  cache-control: public, max-age=31536000, immutable\n");
  w("public/robots.txt", "User-agent: *\nAllow: /\n");
  return out;
}
const scan = (out: string, deny: string[] = []) =>
  scanBundle(out, { expectedSupabaseUrl: URL_, expectedPublishableKey: KEY, deny });
const messages = (r: { errors: { message: string }[] }) => r.errors.map((e) => e.message);

describe("post-build hardening", () => {
  it("disallows crawlers, adds static-asset headers and names the Worker", () => {
    const out = fixture();
    hardenOutput(out);
    expect(fs.readFileSync(path.join(out, "public/robots.txt"), "utf8")).toBe(ROBOTS_TXT);
    const headers = fs.readFileSync(path.join(out, "public/_headers"), "utf8");
    expect(headers.startsWith(ASSET_HEADERS)).toBe(true);
    expect(headers).toContain("X-Robots-Tag: noindex, nofollow, noarchive");
    expect(headers).toContain("cache-control: public, max-age=31536000, immutable"); // kept
    const wrangler = JSON.parse(fs.readFileSync(path.join(out, "server/wrangler.json"), "utf8"));
    expect(wrangler.name).toBe(WORKER_NAME);
    expect(wrangler.compatibility_flags).toEqual(["nodejs_compat"]);
    // wrangler deploy would otherwise turn the version preview URLs on (outside Cloudflare Access).
    expect(wrangler.preview_urls).toBe(false);
    expect(wrangler.workers_dev).toBe(true);
  });
});

describe("Worker exposure: workers.dev only, never version preview URLs", () => {
  const withWrangler = (patch: (w: Record<string, unknown>) => Record<string, unknown>) => {
    const out = fixture();
    hardenOutput(out);
    const file = path.join(out, "server/wrangler.json");
    const w = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    fs.writeFileSync(file, JSON.stringify(patch(w)));
    return messages(scan(out));
  };
  it("rejects a build whose config leaves preview URLs unset or on", () => {
    const unset = withWrangler((w) => {
      const copy = { ...w };
      delete copy["preview_urls"];
      return copy;
    });
    expect(unset.some((m) => m.startsWith("preview_urls must be false"))).toBe(true);
    const on = withWrangler((w) => ({ ...w, preview_urls: true }));
    expect(on.some((m) => m.startsWith("preview_urls must be false"))).toBe(true);
  });
  it("rejects a build that turns workers.dev off or adds routes or custom domains", () => {
    const off = withWrangler((w) => ({ ...w, workers_dev: false }));
    expect(off.some((m) => m.startsWith("workers_dev must be true"))).toBe(true);
    for (const key of ["routes", "custom_domains"]) {
      const extra = withWrangler((w) => ({ ...w, [key]: ["preview.example.com"] }));
      expect(
        extra.some((m) => m.startsWith(`unexpected ${key}`)),
        key,
      ).toBe(true);
    }
  });
});

describe("bundle verification", () => {
  it("a hardened clean bundle passes (library constants allowed, manifest path only a warning)", () => {
    const out = fixture();
    hardenOutput(out);
    const r = scan(out);
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.file)).toEqual(["server/_ssr/manifest.mjs"]);
  });

  it("an un-hardened bundle fails (robots, asset headers, Worker name)", () => {
    const m = messages(scan(fixture()));
    expect(m).toContain("must disallow every crawler");
    expect(m).toContain("static assets must carry X-Robots-Tag: noindex");
    expect(m.some((x) => x.startsWith("worker name is tanstack-start-ts"))).toBe(true);
  });

  const leaks: [string, string, string, RegExp][] = [
    [
      "a service_role JWT",
      "server/x.mjs",
      `k="${jwt({ role: "service_role", ref: REF })}"`,
      /role service_role/,
    ],
    [
      "an anon key of another project",
      "public/assets/x.js",
      `k="${jwt({ role: "anon", ref: OTHER })}"`,
      /anon key/,
    ],
    ["a secret key", "server/x.mjs", `k="sb_secret_0123456789abcdefgh"`, /secret key/],
    [
      "another publishable key",
      "public/assets/x.js",
      `k="sb_publishable_ZZZZZZZZZZZZZZZZ"`,
      /publishable key of another project/,
    ],
    [
      "another Supabase project",
      "public/assets/x.js",
      `u="https://${OTHER}.supabase.co"`,
      /another Supabase project/,
    ],
    ["the QA API", "public/assets/x.js", `u="http://127.0.0.1:55321"`, /local or private backend/],
    [
      "localhost with any port (the router fallback is allowed only without one)",
      "public/assets/x.js",
      `u="http://localhost:8095"`,
      /local or private backend/,
    ],
    ["a local https origin", "server/x.mjs", `u="https://localhost"`, /local or private backend/],
    [
      "the local demo API",
      "server/x.mjs",
      `u="http://localhost:54321/rest/v1"`,
      /local or private backend/,
    ],
    [
      "a private network host",
      "server/x.mjs",
      `u="https://192.168.0.10:8000"`,
      /local or private backend/,
    ],
    [
      "a connection string",
      "server/x.mjs",
      `db="postgresql://postgres:pw@db.example:5432/postgres"`,
      /connection string/,
    ],
    ["the local demo stack id", "server/x.mjs", `id="ilemvaquootxarmisdjb"`, /commercial demo/],
    ["the QA stack name", "server/x.mjs", `n="dq-rebuild"`, /persistent QA/],
    [
      "the production project name",
      "server/x.mjs",
      `n="dinequora-production"`,
      /production project/,
    ],
    [
      "the service-role client",
      "server/x.mjs",
      `process.env["SUPABASE_SERVICE_ROLE_KEY"]`,
      /service-role client/,
    ],
    [
      "a build path in a public file",
      "public/assets/x.js",
      `p="C:/dev/Dinequora/src/x.ts"`,
      /absolute build-machine path/,
    ],
  ];
  it.each(leaks)("rejects %s without echoing it", (_label, file, content, expected) => {
    const out = fixture();
    hardenOutput(out);
    fs.writeFileSync(path.join(out, file), content);
    const r = scan(out);
    expect(messages(r).some((m) => expected.test(m))).toBe(true);
    const report = JSON.stringify(r);
    for (const secretish of content.match(
      /eyJ[^"]+|sb_(secret|publishable)_[A-Za-z0-9]+|postgresql:\/\/[^"]+/g,
    ) ?? [])
      expect(report).not.toContain(secretish);
  });

  it("rejects strings from the operator's deny list (e.g. other project refs) by index only", () => {
    const out = fixture();
    hardenOutput(out);
    fs.writeFileSync(path.join(out, "server/x.mjs"), `const prod = "proddddddddddddref00";`);
    const r = scan(out, ["proddddddddddddref00"]);
    expect(messages(r)).toContain("denied string #1 (PREVIEW_BUNDLE_DENY)");
    expect(JSON.stringify(r)).not.toContain("proddddddddddddref00");
  });

  it("rejects local wrangler state, source maps and a non-preview build", () => {
    const out = fixture();
    hardenOutput(out);
    fs.mkdirSync(path.join(out, "server/.wrangler/state"), { recursive: true });
    fs.writeFileSync(path.join(out, "server/.wrangler/state/trace.sqlite"), "x");
    fs.writeFileSync(path.join(out, "public/assets/client.js.map"), "{}");
    fs.writeFileSync(path.join(out, "public/assets/client.js"), `const u="${URL_}",k="${KEY}";`);
    const m = messages(scan(out));
    expect(m).toContain("local wrangler state inside the build output (rebuild from clean)");
    expect(m).toContain("source map in the build output");
    expect(m).toContain("the browser bundle was not built with the client-preview profile");
  });

  it("rejects a bundle built for another backend", () => {
    const out = fixture();
    hardenOutput(out);
    const r = scanBundle(out, {
      expectedSupabaseUrl: `https://${OTHER}.supabase.co`,
      expectedPublishableKey: "sb_publishable_ZZZZZZZZZZZZZZZZ",
    });
    expect(messages(r)).toEqual(
      expect.arrayContaining([
        "the expected Supabase URL is not in the browser bundle",
        "the expected Supabase URL is not in the server bundle",
        "the expected publishable key is not in the browser bundle",
      ]),
    );
  });

  it("rejects Worker configuration that carries values or bindings", () => {
    const out = fixture();
    hardenOutput(out);
    const file = path.join(out, "server/wrangler.json");
    const w = JSON.parse(fs.readFileSync(file, "utf8"));
    fs.writeFileSync(file, JSON.stringify({ ...w, vars: { SUPABASE_URL: URL_ } }));
    expect(messages(scan(out)).some((m) => m.startsWith("unexpected vars section"))).toBe(true);
  });

  it("requires the expected values and a complete output", () => {
    expect(
      messages(scanBundle(tmp(), { expectedSupabaseUrl: URL_, expectedPublishableKey: KEY })),
    ).toContain("missing from the build output");
    expect(
      messages(scanBundle(fixture(), { expectedSupabaseUrl: "", expectedPublishableKey: "" })),
    ).toContain("expected Supabase URL and publishable key are required");
  });
});
