// 0036 (the basis-point sale RPCs retired from the API): file-level review aids. The database behaviour
// is covered by scripts/security/pos_sale_flow_integrity.mjs, api_privileges.mjs,
// security_closure_rollback.mjs, the SQL fixtures and the permission matrix.
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildSecurityClosureRollbackFiles } from "../../scripts/qa/build-m2-rollback.mjs";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8").replace(/\r\n/g, "\n");
const M0036 = read("drizzle/migrations/0036_retire_legacy_pos_sale_rpcs.sql");
const code = (src: string) =>
  src
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
const journal = JSON.parse(read("drizzle/migrations/meta/_journal.json")) as {
  entries: { idx: number; tag: string; when: number }[];
};

const ARGS14 =
  "uuid, uuid, public.order_type, text, text, text, text, text, text, integer, integer, jsonb, boolean, text";
const RETIRED = [
  `public.create_pos_sale(${ARGS14})`,
  `public.finalize_pos_sale_atomic(${ARGS14}, text)`,
  `public.persist_finalized_pos_sale_atomic(${ARGS14}, text)`,
];

describe("0036 retire the basis-point sale RPCs", () => {
  it("follows 0035 in the journal with a greater `when`", () => {
    const i = journal.entries.findIndex((e) => e.tag === "0036_retire_legacy_pos_sale_rpcs");
    expect(journal.entries[i - 1]!.tag).toBe("0035_pending_sale_reason_privacy");
    expect(journal.entries[i]!.when).toBeGreaterThan(journal.entries[i - 1]!.when);
    // later migrations (0037 dining room…) keep the order: each `when` above the previous one
    for (const next of journal.entries.slice(i + 1))
      expect(next.when).toBeGreaterThan(journal.entries[journal.entries.indexOf(next) - 1]!.when);
  });

  it("is plain ASCII and sets the lock wait limit first", () => {
    expect(M0036.split("\n").filter((l) => /[^\x20-\x7e]/.test(l.replace(/\t/g, " ")))).toEqual([]);
    expect(
      code(M0036)
        .split("\n")
        .map((l) => l.trim())
        .find(Boolean),
    ).toBe("set local lock_timeout = '5s';");
  });

  it("revokes EXECUTE on exactly the three legacy signatures from every API role and PUBLIC", () => {
    const revokes = [
      ...code(M0036).matchAll(/revoke all on function ([^\n]+)\n\s+from ([^;]+);/g),
    ].map((m) => [m[1], m[2]]);
    expect(revokes.map((r) => r[0])).toEqual(RETIRED);
    for (const r of revokes) expect(r[1]).toBe("public, anon, authenticated, service_role");
  });

  it("is additive: drops nothing, redefines nothing, grants nothing, touches no data and no v2 privilege", () => {
    const c = code(M0036);
    expect(c).not.toMatch(/\bdrop\b/i);
    expect(c).not.toMatch(/create\s+(or\s+replace\s+)?(function|trigger|table|policy)/i);
    expect(c).not.toMatch(/^\s*grant\b/im);
    expect(c).not.toMatch(/^\s*(insert|update|delete|alter)\b/im);
    // the v2 functions appear only inside the verification block (names in a list), never in a REVOKE
    expect(c).not.toMatch(/revoke[^;]*_v2/i);
  });

  it("verifies its own result in the same transaction (any surprise aborts the run)", () => {
    const c = code(M0036);
    expect(c).toContain("raise exception 'legacy sale function % is still executable by %'");
    expect(c).toContain(
      "raise exception 'expected exactly one definition of sale function %, found %'",
    );
    expect(c).toContain(
      "raise exception 'current sale function % must stay executable by authenticated and not by anon'",
    );
  });

  it("the signatures are the ones the earlier migrations define (the wrappers of 0025 delegate to v2)", () => {
    const m0025 = read("drizzle/migrations/0025_store_sales_tax_rate.sql");
    const wrapper = (name: string) => {
      const start = m0025.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
      expect(start, name).toBeGreaterThan(0);
      return m0025.slice(start, m0025.indexOf("END $function$;", start));
    };
    expect(wrapper("create_pos_sale")).toContain("RETURN public.create_pos_sale_v2(");
    expect(wrapper("finalize_pos_sale_atomic")).toContain(
      "RETURN public.finalize_pos_sale_atomic_v2(",
    );
    expect(wrapper("create_pos_sale")).toContain("_tax_rate_basis_points*100");
    // no later migration redefines the wrappers (0032/0033 change create_pos_sale_v2 only)
    for (const f of fs
      .readdirSync(path.join(ROOT, "drizzle/migrations"))
      .filter((n) => /^00(2[6-9]|3\d)_.*\.sql$/.test(n)))
      expect(read(`drizzle/migrations/${f}`), f).not.toMatch(
        /create\s+(or\s+replace\s+)?function\s+public\.(create_pos_sale|finalize_pos_sale_atomic|persist_finalized_pos_sale_atomic)\s*\(/i,
      );
  });

  it("the application never calls a retired RPC (only the _v2 flow and the resolution RPCs)", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name !== "test" && e.name !== "integrations") walk(p);
        } else if (/\.(ts|tsx)$/.test(e.name)) files.push(p);
      }
    };
    walk(path.join(ROOT, "src"));
    const calls = files.flatMap((f) =>
      [...fs.readFileSync(f, "utf8").matchAll(/\.rpc\(\s*["'`]([a-z0-9_]+)["'`]/g)].map(
        (m) => m[1]!,
      ),
    );
    expect(calls).toContain("persist_finalized_pos_sale_atomic_v2");
    expect(calls).toContain("create_pos_sale_v2");
    for (const retired of [
      "create_pos_sale",
      "finalize_pos_sale_atomic",
      "persist_finalized_pos_sale_atomic",
    ])
      expect(calls, retired).not.toContain(retired);
  });

  it("rollback: generated, grants EXECUTE back to authenticated only, nothing else", () => {
    const built = buildSecurityClosureRollbackFiles()["0036-rollback"];
    expect(read("docs/operations/security-closure/0036-rollback.sql")).toBe(built);
    const c = code(built);
    expect(c.trim().split("\n")[0]).toBe("set local lock_timeout = '5s';");
    const grants = [...c.matchAll(/grant execute on function ([^\n]+) to ([^;]+);/g)].map((m) => [
      m[1],
      m[2],
    ]);
    expect(grants.map((g) => g[0])).toEqual(RETIRED);
    for (const g of grants) expect(g[1]).toBe("authenticated");
    expect(c).not.toMatch(/\b(anon|service_role|public)\b\s*;/i);
    expect(c).not.toMatch(/\b(drop|revoke|create|alter|insert|update|delete)\b/i);
  });
});
