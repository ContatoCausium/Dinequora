import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  assertClientPreviewApi,
  assertPreviewConfirmation,
  assertPreviewIdentity,
  inspectServiceKey,
  parsePreviewApiUrl,
  PREVIEW_OPERATIONS,
  PreviewRefusal,
} from "../../scripts/preview/preview-target.mjs";

/**
 * Client-preview guard (scripts/preview/preview-target.mjs): seed and reset may write only to the
 * hosted client-preview project — confirmed by the operator for that operation and project, with a
 * server key of that project, marked by scripts/preview/sql/client-preview-identity.sql with the
 * same ref, and holding no real data. PostgREST is mocked: nothing reaches a network.
 */
const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const REF = "abcdefghij0123456789";
const OTHER = "zzzzzzzzzz9999999999";
const URL_ = `https://${REF}.supabase.co`;
const SECRET = "sb_secret_0123456789abcdefghijklmnop";
const SEED = "seed:client-preview";
const RESET = "reset:client-preview";
const confirmFor = (op: string, ref = REF) => `client-preview:${op}:${ref}`;
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (payload: Record<string, unknown>) =>
  `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.c2lnbmF0dXJlLXNpZ25hdHVyZQ`;
const IDENTITY = {
  label: "client-preview",
  project_ref: REF,
  marker_version: 1,
  marked_at: "2026-11-14T00:00:00Z",
  non_demo_organizations: 0,
  non_test_users: 0,
  platform_roles: 0,
};
const ok = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status }));
const target = (over: Record<string, unknown> = {}) => ({
  apiUrl: URL_,
  serviceKey: SECRET,
  operation: SEED,
  confirm: confirmFor(SEED),
  fetchImpl: ok(IDENTITY),
  ...over,
});
async function refusal(p: Promise<unknown>): Promise<string> {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(PreviewRefusal);
  return (e as Error).message;
}

describe("destination URL", () => {
  it("accepts only the hosted project origin", () => {
    expect(parsePreviewApiUrl(URL_)).toEqual({ ref: REF, origin: URL_ });
    expect(parsePreviewApiUrl(`${URL_}/`).ref).toBe(REF);
  });
  it.each([
    ["local stack", "http://127.0.0.1:55321"],
    ["localhost https", "https://localhost:54321"],
    ["loopback v6", "http://[::1]:54321"],
    ["private network", "https://192.168.1.20"],
    ["docker host", "https://host.docker.internal"],
    ["plain http", `http://${REF}.supabase.co`],
    ["credentials", `https://user:pw@${REF}.supabase.co`],
    ["port", `https://${REF}.supabase.co:8443`],
    ["path", `${URL_}/rest/v1`],
    ["query", `${URL_}/?x=1`],
    ["look-alike host", `https://${REF}.supabase.co.evil.example`],
    ["short ref", "https://abc.supabase.co"],
    ["other host", "https://preview.dinequora.com"],
    ["garbage", "not a url"],
    ["missing", undefined],
  ])("refuses %s", (_label, url) => {
    expect(() => parsePreviewApiUrl(url)).toThrow(PreviewRefusal);
  });
  it("points local stacks at the local target guard", () => {
    expect(() => parsePreviewApiUrl("http://127.0.0.1:55321")).toThrow(/target-guard\.mjs/);
  });
});

describe("operator confirmation", () => {
  it("must name the operation and the project", () => {
    expect(() => assertPreviewConfirmation(SEED, REF, confirmFor(SEED))).not.toThrow();
    for (const bad of [
      undefined,
      "",
      "yes",
      confirmFor(RESET), // other operation
      confirmFor(SEED, OTHER), // other project
      `${confirmFor(SEED)} `,
      confirmFor(SEED).toUpperCase(),
    ])
      expect(() => assertPreviewConfirmation(SEED, REF, bad)).toThrow(PreviewRefusal);
  });
  it("never prints the expected value", () => {
    try {
      assertPreviewConfirmation(SEED, REF, "wrong");
    } catch (e) {
      expect((e as Error).message).not.toContain(confirmFor(SEED));
    }
  });
});

describe("server key", () => {
  it("accepts a secret key or a service_role JWT of this project", () => {
    expect(inspectServiceKey(SECRET, REF)).toBe("secret");
    expect(inspectServiceKey(jwt({ role: "service_role", ref: REF }), REF)).toBe(
      "service_role_jwt",
    );
  });
  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["publishable key", "sb_publishable_0123456789abcdefghij"],
    ["anon JWT", jwt({ role: "anon", ref: REF })],
    ["authenticated JWT", jwt({ role: "authenticated", ref: REF })],
    ["service_role of another project", jwt({ role: "service_role", ref: OTHER })],
    ["service_role without ref", jwt({ role: "service_role" })],
    ["short secret", "sb_secret_x"],
    ["unknown format", "hunter2"],
  ])("refuses %s", (_label, key) => {
    expect(() => inspectServiceKey(key, REF)).toThrow(PreviewRefusal);
  });
});

describe("database identity", () => {
  it("accepts the marked preview with no real data", () => {
    expect(() => assertPreviewIdentity(IDENTITY, REF)).not.toThrow();
  });
  it.each([
    ["no identity", null],
    ["an array", []],
    ["other label", { ...IDENTITY, label: "qa" }],
    ["other marker version", { ...IDENTITY, marker_version: 2 }],
    ["marker of another project (copied database)", { ...IDENTITY, project_ref: OTHER }],
    ["real organizations", { ...IDENTITY, non_demo_organizations: 3 }],
    ["real accounts", { ...IDENTITY, non_test_users: 1 }],
    ["platform admins", { ...IDENTITY, platform_roles: 1 }],
    ["missing counts", { label: "client-preview", project_ref: REF, marker_version: 1 }],
    ["non-numeric count", { ...IDENTITY, non_test_users: "0" }],
  ])("refuses %s", (_label, identity) => {
    expect(() => assertPreviewIdentity(identity, REF)).toThrow(PreviewRefusal);
  });
});

describe("full check through the API", () => {
  it("passes for the marked preview and calls only the identity RPC, with the key as apikey", async () => {
    const fetchImpl = ok(IDENTITY);
    await expect(assertClientPreviewApi(target({ fetchImpl }))).resolves.toEqual({
      ref: REF,
      keyKind: "secret",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${URL_}/rest/v1/rpc/client_preview_identity`);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["apikey"]).toBe(SECRET);
    // a new-format key is not a JWT: never sent as a bearer token
    expect(headers["authorization"]).toBeUndefined();
  });
  it("sends a legacy service_role JWT as bearer too", async () => {
    const key = jwt({ role: "service_role", ref: REF });
    const fetchImpl = ok(IDENTITY);
    await assertClientPreviewApi(target({ serviceKey: key, fetchImpl }));
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>)["authorization"]).toBe(`Bearer ${key}`);
  });
  it("accepts seed, reset and verify, each with its own confirmation", async () => {
    expect(PREVIEW_OPERATIONS).toEqual([SEED, RESET, "verify:client-preview"]);
    await expect(
      assertClientPreviewApi(target({ operation: RESET, confirm: confirmFor(RESET) })),
    ).resolves.toMatchObject({ ref: REF });
    await refusal(assertClientPreviewApi(target({ operation: RESET, confirm: confirmFor(SEED) })));
  });
  it("refuses unknown operations before any request", async () => {
    const fetchImpl = ok(IDENTITY);
    await refusal(assertClientPreviewApi(target({ operation: "seed:qa-tenant", fetchImpl })));
    await refusal(assertClientPreviewApi(target({ operation: "migrate:remote", fetchImpl })));
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("refuses a local stack, a wrong confirmation or a wrong key before any request", async () => {
    const fetchImpl = ok(IDENTITY);
    await refusal(assertClientPreviewApi(target({ apiUrl: "http://127.0.0.1:55321", fetchImpl })));
    await refusal(assertClientPreviewApi(target({ confirm: undefined, fetchImpl })));
    await refusal(
      assertClientPreviewApi(target({ serviceKey: "sb_publishable_0123456789abcdef", fetchImpl })),
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it("refuses an unmarked database (production, QA or any project without the marker)", async () => {
    const msg = await refusal(
      assertClientPreviewApi(
        target({ fetchImpl: ok({ code: "PGRST202", message: "function not found" }, 404) }),
      ),
    );
    expect(msg).toMatch(/not marked as the client preview/);
  });
  it("refuses when the RPC is not executable with this key (401/403)", async () => {
    await refusal(assertClientPreviewApi(target({ fetchImpl: ok({ code: "42501" }, 401) })));
    await refusal(assertClientPreviewApi(target({ fetchImpl: ok({ code: "42501" }, 403) })));
  });
  it("refuses a marker copied from another project and a database with real data", async () => {
    await refusal(
      assertClientPreviewApi(target({ fetchImpl: ok({ ...IDENTITY, project_ref: OTHER }) })),
    );
    await refusal(
      assertClientPreviewApi(target({ fetchImpl: ok({ ...IDENTITY, non_demo_organizations: 1 }) })),
    );
  });
  it("refuses on network failure, timeout or a non-JSON answer", async () => {
    await refusal(
      assertClientPreviewApi(
        target({
          fetchImpl: vi.fn(async () => {
            throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ENOTFOUND" } });
          }),
        }),
      ),
    );
    await refusal(
      assertClientPreviewApi(target({ fetchImpl: vi.fn(async () => new Response("<html>")) })),
    );
  });
  it("never puts the key in a refusal message", async () => {
    const key = jwt({ role: "service_role", ref: OTHER });
    for (const over of [
      { serviceKey: key },
      { fetchImpl: ok({}, 404) },
      { fetchImpl: ok({ ...IDENTITY, non_test_users: 2 }) },
    ]) {
      const msg = await refusal(assertClientPreviewApi(target(over)));
      expect(msg).not.toContain(SECRET);
      expect(msg).not.toContain(key);
    }
  });
});

describe("policy: seed and reset of the client preview", () => {
  const scripts = [
    "scripts/preview/seed-client-preview.mjs",
    "scripts/preview/reset-client-preview.mjs",
  ];

  // Guards a script may run before touching a database: the preview guard itself, the resolver
  // that runs the right guard for the destination (local disposable stack or hosted preview), or
  // the brand check of a destination the resolver produced.
  const GUARD_CALLS = ["assertClientPreviewApi(", "resolvePreviewTarget(", "assertResolvedTarget("];

  it("every preview script that writes calls the guard first, with no override", () => {
    for (const f of fs
      .readdirSync(path.join(ROOT, "scripts/preview"))
      .filter((x) => x.endsWith(".mjs"))) {
      const code = read(`scripts/preview/${f}`).replace(/^\s*\/\/.*$/gm, "");
      expect(code, `${f} keeps an environment override`).not.toMatch(
        /ALLOW_[A-Z_]*WRITES|process\.env\.[A-Z_]*(DISABLE|SKIP|FORCE|BYPASS)/,
      );
      // database access only (Buffer.from, file writes and regex groups are not database writes)
      const firstWrite = code.search(/createClient\(|\bpostgres\((?!\?)|\.rpc\(|\.from\(["'`]/);
      if (firstWrite === -1) continue;
      if (f === "smoke-app.mjs") continue; // signs in as the demo accounts only; covered below
      const found = GUARD_CALLS.map((g) => code.indexOf(g)).filter((i) => i >= 0);
      const guard = found.length ? Math.min(...found) : -1;
      expect(guard, `${f} writes without the client-preview guard`).toBeGreaterThan(-1);
      expect(guard, `${f}: a write comes before the guard`).toBeLessThan(firstWrite);
    }
  });

  it("seed, reset and verify resolve their own operation before loading anything that writes", () => {
    for (const [f, op] of [
      [scripts[0]!, SEED],
      [scripts[1]!, RESET],
      ["scripts/preview/verify-dataset.mjs", "verify:client-preview"],
    ] as const) {
      const code = read(f).replace(/^\s*\/\/.*$/gm, "");
      expect(code).toContain(`const OPERATION = "${op}";`);
      const resolve = code.search(
        /await resolvePreviewTarget\(process\.env, OPERATION\)\.catch\(exitOnTargetRefusal\)/,
      );
      expect(resolve, f).toBeGreaterThan(-1);
      // the writer is imported (and any client created) only after the destination was accepted
      const writer = code.search(/import\("\.\/seed-core\.mjs"\)|createClient\(/);
      if (writer >= 0) expect(resolve, f).toBeLessThan(writer);
      expect(code, `${f} imports the writer statically`).not.toMatch(/^import .*seed-core/m);
    }
  });

  it("the resolver runs the target guard for local stacks and the preview guard for the hosted project", () => {
    const code = read("scripts/preview/client-preview-target.mjs");
    expect(code).toMatch(
      /mode === "local"[\s\S]*assertDisposableApi\(apiUrl, serviceKey, operation\)/,
    );
    expect(code).toMatch(/assertClientPreviewApi\(\{[\s\S]*confirm: env\.DQ_PREVIEW_CONFIRM/);
    expect(code).toContain("Symbol(");
    const core = read("scripts/preview/seed-core.mjs").replace(/^\s*\/\/.*$/gm, "");
    const brand = core.indexOf("assertResolvedTarget(target)");
    expect(brand).toBeGreaterThan(-1);
    expect(brand).toBeLessThan(core.indexOf("createClient(target"));
  });

  it("the app smoke test only talks to a local run, workers.dev or the preview domain", () => {
    const m = /const ALLOWED_APP =\s*(\/.*\/);/.exec(read("scripts/preview/smoke-app.mjs"));
    expect(m).not.toBeNull();
    const allowed = new Function(`return ${m![1]}`)() as RegExp;
    for (const good of [
      "http://127.0.0.1:8799",
      "https://dinequora-client-preview.demo.workers.dev",
      "https://preview.dinequora.com",
    ])
      expect(allowed.test(good), good).toBe(true);
    for (const bad of [
      "https://dinequora.com",
      "https://app.dinequora.com",
      "http://10.0.0.5:8095",
      "https://evil.example/x.workers.dev",
      "https://preview.dinequora.com.evil.example",
    ])
      expect(allowed.test(bad), bad).toBe(false);
  });

  it("the dataset functions refuse anything but the preview or a disposable stack, and act on demo organizations only", () => {
    const sql = read("scripts/preview/sql/client-preview-functions.sql").replace(/--.*$/gm, "");
    const guard = sql.indexOf("PERFORM dq_guard.attest('seed:client-preview')");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(sql.search(/CREATE OR REPLACE FUNCTION/));
    expect(sql).toContain("to_regclass('dq_preview.marker') IS NULL");
    for (const fn of ["client_preview_backdate", "client_preview_purge"]) {
      const body = sql.slice(sql.indexOf(`FUNCTION public.${fn}(`));
      expect(body.indexOf("PERFORM public.client_preview_assert_target(_org_id)")).toBeGreaterThan(
        -1,
      );
      expect(sql).toContain(`REVOKE ALL ON FUNCTION public.${fn}(`);
      expect(sql).toMatch(
        new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn}\\([^)]*\\) TO service_role;`),
      );
    }
    expect(sql).toMatch(
      /NOT EXISTS \(SELECT 1 FROM public\.organizations WHERE id = _org_id AND is_demo\)/,
    );
    expect(sql).toMatch(/DELETE FROM public\.organizations WHERE id = _org_id AND is_demo;/);
    expect(sql).not.toMatch(/DELETE FROM (public\.)?audit_logs|DELETE FROM auth\./i);
    expect(sql).not.toMatch(/GRANT [^;]* TO (anon|authenticated|PUBLIC)/i);
    // every time moved by the back-dating is checked against now
    expect((sql.match(/> now\(\)/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("the destination comes from the environment, never from the command line", () => {
    for (const f of [
      ...scripts,
      "scripts/preview/verify-dataset.mjs",
      "scripts/preview/seed-core.mjs",
      "scripts/preview/client-preview-target.mjs",
    ])
      expect(read(f), f).not.toMatch(/process\.argv/);
  });

  it("the identity marker refuses real data and is executable by service_role only", () => {
    const sql = read("scripts/preview/sql/client-preview-identity.sql");
    const body = sql.replace(/--.*$/gm, "");
    for (const check of [
      "ref !~ '^[a-z0-9]{20}$'",
      "to_regclass('public.organizations') IS NULL",
      "to_regnamespace('dq_preview') IS NOT NULL",
      "to_regnamespace('dq_guard') IS NOT NULL",
      "FROM public.organizations WHERE NOT is_demo",
      "FROM auth.users",
      "FROM public.user_roles",
    ])
      expect(body, check).toContain(check);
    // every refusal happens before the first write
    const lastRefusal = body.lastIndexOf("RAISE EXCEPTION");
    expect(lastRefusal).toBeLessThan(body.indexOf("CREATE SCHEMA"));
    expect(body).toMatch(
      /REVOKE ALL ON FUNCTION public\.client_preview_identity\(\) FROM PUBLIC, anon, authenticated;/,
    );
    expect(body).toMatch(
      /GRANT EXECUTE ON FUNCTION public\.client_preview_identity\(\) TO service_role;/,
    );
    expect(body).not.toMatch(/GRANT [^;]* TO (anon|authenticated|PUBLIC)/i);
    expect(body).toMatch(/SECURITY DEFINER SET search_path = ''/);
  });

  it("the marker is not a migration and never reaches QA or production through drizzle", () => {
    const migrations = fs.readdirSync(path.join(ROOT, "drizzle/migrations"));
    expect(migrations.some((m) => /client.?preview/i.test(m))).toBe(false);
    for (const m of migrations.filter((x) => x.endsWith(".sql")))
      expect(read(`drizzle/migrations/${m}`), m).not.toMatch(/client_preview_|dq_preview/);
  });

  it("the existing seeds keep refusing hosted databases", () => {
    expect(read("scripts/qa/seed-qa-org.mjs")).toMatch(/assertDisposableApi\(/);
    expect(read("scripts/seeds/demo/seed-demo-orgs.sql")).toContain("dq_guard.attest(");
  });
});
