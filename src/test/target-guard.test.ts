import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  assertDisposableApi,
  clusterHash,
  describeApiUrl,
  describeDbUrl,
  exitOnRefusal,
  GuardRefusal,
  protectedLabel,
  short,
} from "../../scripts/guard/target-guard.mjs";

/**
 * Target guard (scripts/guard/target-guard.mjs): the pure parts, the API check with a mocked
 * PostgREST, and a POLICY over the repository: every script that writes to a database must go
 * through the guard. The database-side behaviour (claim, markers, copies, tampering, concurrency) is
 * exercised on real databases by scripts/guard/selftest.sh in the security suite.
 */
const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const protectedList = JSON.parse(read("scripts/guard/protected-clusters.json")) as {
  clusters: { label: string; hash: string }[];
};

afterEach(() => vi.unstubAllGlobals());

describe("targets", () => {
  it("accepts only loopback database URLs and never echoes credentials", () => {
    expect(describeDbUrl("postgresql://postgres:secret@127.0.0.1:64422/postgres").where).toBe(
      "127.0.0.1:64422/postgres",
    );
    expect(describeDbUrl("postgres://u:p@localhost/x").where).toBe("localhost:5432/x");
    for (const bad of [
      "postgresql://postgres:secret@db.abcdefgh.supabase.co:5432/postgres",
      "postgresql://postgres:secret@10.0.0.5:5432/postgres",
      "postgresql://postgres:secret@127.0.0.1.example.com:5432/postgres",
      "http://127.0.0.1:5432/postgres",
      "",
      undefined,
    ]) {
      expect(() => describeDbUrl(bad)).toThrow(GuardRefusal);
      try {
        describeDbUrl(bad);
      } catch (e) {
        expect(String((e as Error).message)).not.toContain("secret");
      }
    }
  });

  it("accepts only loopback API URLs", () => {
    expect(describeApiUrl("http://127.0.0.1:64421")).toBe("127.0.0.1:64421");
    expect(() => describeApiUrl("https://abcdefgh.supabase.co")).toThrow(GuardRefusal);
    expect(() => describeApiUrl("http://dinequora.com")).toThrow(GuardRefusal);
  });

  it("identifies clusters only by a hash; the protected list holds no raw identifier", () => {
    expect(clusterHash("123")).toMatch(/^[0-9a-f]{64}$/);
    expect(clusterHash("123")).toBe(clusterHash("123"));
    expect(clusterHash("123")).not.toBe(clusterHash("124"));
    expect(short(clusterHash("123"))).toHaveLength(12);
    expect(protectedList.clusters.map((c) => c.label).sort()).toEqual(["demo", "qa"]);
    for (const c of protectedList.clusters) expect(protectedLabel(c.hash)).toBe(c.label);
    expect(protectedLabel(clusterHash("123"))).toBeNull();
    expect(read("scripts/guard/protected-clusters.json")).not.toMatch(/\b\d{15,20}\b/);
  });
});

describe("API attestation", () => {
  const answer = (status: number, body: unknown) =>
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status })),
    );

  it("passes only when the database behind the API attests a disposable, unprotected cluster", async () => {
    answer(200, { cluster_hash: clusterHash("999"), purpose: "new-empty" });
    await expect(assertDisposableApi("http://127.0.0.1:64421", "k", "test:x")).resolves.toBe(
      short(clusterHash("999")),
    );
  });

  it("refuses a protected cluster even if it answered (forged marker)", async () => {
    answer(200, { cluster_hash: protectedList.clusters.find((c) => c.label === "qa")!.hash });
    await expect(assertDisposableApi("http://127.0.0.1:55321", "k", "test:x")).rejects.toThrow(
      /protected qa cluster/,
    );
  });

  it("refuses when the API has no attestation, an error, no key, or a bad operation", async () => {
    answer(404, { message: "Could not find the function dq_guard.attest" });
    await expect(assertDisposableApi("http://127.0.0.1:64421", "k", "test:x")).rejects.toThrow(
      GuardRefusal,
    );
    answer(200, { something: "else" });
    await expect(assertDisposableApi("http://127.0.0.1:64421", "k", "test:x")).rejects.toThrow(
      GuardRefusal,
    );
    await expect(
      assertDisposableApi("http://127.0.0.1:64421", undefined, "test:x"),
    ).rejects.toThrow(/service key/);
    await expect(assertDisposableApi("http://127.0.0.1:64421", "k", "DROP; x")).rejects.toThrow(
      /operation/,
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("fetch failed"))),
    );
    await expect(assertDisposableApi("http://127.0.0.1:64421", "k", "test:x")).rejects.toThrow(
      /cannot reach/,
    );
  });

  it("exitOnRefusal rethrows anything that is not a refusal", () => {
    expect(() => exitOnRefusal(new Error("boom"))).toThrow("boom");
  });
});

describe("policy: every script that writes to a database goes through the guard", () => {
  const files = (dir: string, ext: string) =>
    fs
      .readdirSync(path.join(ROOT, dir))
      .filter((f) => f.endsWith(ext))
      .map((f) => `${dir}/${f}`);

  it("SQL files that write start with the guard, before any write", () => {
    const sql = [...files("scripts/security", ".sql"), "scripts/seeds/demo/seed-demo-orgs.sql"];
    // a transaction (BEGIN;) or any DML/DDL; the BEGIN of a DO block alone is not a write
    const writers = sql.filter((f) =>
      /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|TRUNCATE)\b|\bBEGIN\s*;/i.test(
        read(f).replace(/--.*$/gm, ""),
      ),
    );
    expect(writers.length).toBeGreaterThanOrEqual(10);
    for (const f of writers) {
      const s = read(f);
      const guard = s.indexOf("dq_guard.attest(");
      expect(guard, `${f} has no target guard`).toBeGreaterThan(-1);
      const firstWrite = s
        .replace(/--.*$/gm, (m) => " ".repeat(m.length))
        .search(/\b(INSERT|UPDATE|DELETE|BEGIN;|CREATE TEMP|CREATE FUNCTION)\b/i);
      expect(guard, `${f}: a write comes before the guard`).toBeLessThan(
        firstWrite === -1 ? Infinity : firstWrite,
      );
      expect(s, `${f} still trusts the PR #22 opt-in`).not.toContain("dinequora.fixture_target");
    }
  });

  it("Node scripts that write call the guard before connecting, without overrides", () => {
    const node = [...files("scripts/security", ".mjs"), "scripts/qa/seed-qa-org.mjs"];
    for (const f of node) {
      const s = read(f).replace(/^\s*\/\/.*$/gm, ""); // code only, not comments
      const writes = /postgres\(|createClient\(/.test(s);
      if (!writes) continue;
      expect(s, `${f} has no target guard`).toMatch(/assertDisposable(Db|Api)\(/);
      expect(s, `${f} keeps an environment override`).not.toMatch(
        /ALLOW_[A-Z_]*WRITES|process\.env\.[A-Z_]*(DISABLE|SKIP|FORCE)/,
      );
      expect(s, `${f} still trusts ports`).not.toMatch(/5532[0-2]/);
    }
    for (const f of files("src/test/integration", ".db.test.ts"))
      expect(read(f), `${f} has no target guard`).toContain("disposableQa(");
  });

  it("legacy Python scripts exit before doing anything", () => {
    for (const f of files("scripts/security", ".py")) {
      const first = read(f)
        .split("\n")
        .find((l) => l.trim() && !l.trim().startsWith("#"));
      expect(first, `${f} is not retired`).toMatch(/^raise SystemExit\(/);
    }
  });

  it("the CI stack has its own identity, not the persistent QA's", () => {
    const cfg = read("scripts/qa/supabase/config.toml");
    expect(cfg).toMatch(/^project_id = "dq-ci"$/m);
    expect(cfg).not.toMatch(/^port = 553\d\d$/m);
    expect(cfg).not.toMatch(/^project_id = "dq-rebuild"$/m);
  });
});
