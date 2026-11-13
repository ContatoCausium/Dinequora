import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { spawn as spawnChild, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import postgres from "postgres";
import {
  assertHostedDbTarget,
  assertHostedPreviewDb,
  assertStateAllows,
  classifyState,
  type DbFacts,
  type DbSession,
  describeTls,
  FUNCTIONS_SQL,
  HOSTED_DB_OPERATIONS,
  IDENTITY_SQL,
  inspectDatabase,
  journalEntries,
  loadServerCa,
  parseForbiddenRefs,
  parseHostedDbUrl,
  redact,
  renderSqlFile,
  runHostedDb,
  runMigrations,
  type SpawnFn,
  tlsOptions,
} from "../../scripts/preview/hosted-db.mjs";
import { PreviewRefusal } from "../../scripts/preview/preview-target.mjs";

/**
 * hosted-db (scripts/preview/hosted-db.mjs): the only way to run SQL directly on the hosted
 * client-preview database. Offline checks (project ref of the API URL = ref of the Session pooler
 * user, production blocked by name, operator confirmation, pooler host/port, CA file), TLS with full
 * verification (real handshakes against local servers with certificates generated for the test),
 * database states (empty before the first migration, marked for this ref afterwards), psql-file
 * rendering, migration child process, and redaction. The database and drizzle-kit are fakes and the
 * TLS servers listen on 127.0.0.1: nothing reaches a network.
 */
// Public test certificates (no private key exists for them): a CA valid until 2126, a CA that
// expired in 2021 and a server (non-CA) certificate.
const TEST_CA_PEM = `-----BEGIN CERTIFICATE-----
MIIBvTCCAWOgAwIBAgIUQTqHv7taRinHze8unMIO3GV582AwCgYIKoZIzj0EAwIw
KzEpMCcGA1UEAwwgRGluZXF1b3JhIFRlc3QgUm9vdCBDQSAoZml4dHVyZSkwIBcN
MjYxMTEzMTkzMzA2WhgPMjEyNjEwMjAxOTMzMDZaMCsxKTAnBgNVBAMMIERpbmVx
dW9yYSBUZXN0IFJvb3QgQ0EgKGZpeHR1cmUpMFkwEwYHKoZIzj0CAQYIKoZIzj0D
AQcDQgAEb/k2mN24VgzZMzd7vllGECBnDGzhSKZffZwAg+sozUa6+Ll0J7oAyH4y
m35krfEc32eyslCdDUuZ9JE24MGEaaNjMGEwHQYDVR0OBBYEFOqSMNjMwwe+1DAU
9YxKkHONaiZVMB8GA1UdIwQYMBaAFOqSMNjMwwe+1DAU9YxKkHONaiZVMA8GA1Ud
EwEB/wQFMAMBAf8wDgYDVR0PAQH/BAQDAgEGMAoGCCqGSM49BAMCA0gAMEUCIQCf
IeI3vU9hfLsaCIZzGKpXw2Zur4X+JUQ/Kt2W+XxZgQIgUPxSVVSRNMpm1/u4dqIW
U2H1MhYdYe7HBiG+Uu6Q30Y=
-----END CERTIFICATE-----
`;
const EXPIRED_CA_PEM = `-----BEGIN CERTIFICATE-----
MIIBsTCCAVegAwIBAgIUf5zVPtlEUqmExKmDjT9WA670qggwCgYIKoZIzj0EAwIw
LjEsMCoGA1UEAwwjRGluZXF1b3JhIEV4cGlyZWQgVGVzdCBDQSAoZml4dHVyZSkw
HhcNMjAwMTAxMDAwMDAwWhcNMjEwMTAxMDAwMDAwWjAuMSwwKgYDVQQDDCNEaW5l
cXVvcmEgRXhwaXJlZCBUZXN0IENBIChmaXh0dXJlKTBZMBMGByqGSM49AgEGCCqG
SM49AwEHA0IABBwuKrcag1cEdsJuJteeaJ3aK2W52dzZfjCH3DHUZmkmOsD3wgtK
Vw+cv9htPo214aE1oEk5hroUGwlWyWmqhUajUzBRMB0GA1UdDgQWBBQ0snZTgupb
qGrBnljr+A9AK86bfDAfBgNVHSMEGDAWgBQ0snZTgupbqGrBnljr+A9AK86bfDAP
BgNVHRMBAf8EBTADAQH/MAoGCCqGSM49BAMCA0gAMEUCIGVJlVUy7I3rWpsEHAJ1
B+HXT9tl/hwb3Pjxn99cyOhzAiEA2v6QLkdKyc87xCBdnMkbOh5ojZBC9WmEAJ4m
dJOIYnI=
-----END CERTIFICATE-----
`;
const SERVER_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIBtTCCAVygAwIBAgIUKD4QgfBYWU+YZrSODWn97RqFwPgwCgYIKoZIzj0EAwIw
KzEpMCcGA1UEAwwgRGluZXF1b3JhIFRlc3QgUm9vdCBDQSAoZml4dHVyZSkwIBcN
MjYxMTEzMTkzMzA2WhgPMjEyNjEwMjAxOTMzMDZaMBwxGjAYBgNVBAMMEWxlYWYu
Zml4dHVyZS50ZXN0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEJPyD0sBdoIzt
QoMt0oei9JAB/f5z91h+FwG5vD0YjQ+GLn4rqZAKoKXm4ToNQjbh+u2LS3F+kqgk
1yMG1q6JTKNrMGkwCQYDVR0TBAIwADAcBgNVHREEFTATghFsZWFmLmZpeHR1cmUu
dGVzdDAdBgNVHQ4EFgQUkPR98UT43V7FSNyFoD1nRCBI/WYwHwYDVR0jBBgwFoAU
6pIw2MzDB77UMBT1jEqQc41qJlUwCgYIKoZIzj0EAwIDRwAwRAIgKviZSgj3CaFy
VCbvb+qiTRxaFZptc2XgyqtUGB3AYW8CICkhuicH6Irs/7aBmkbHNhcm3iA5sqT/
eLOLFYuXuYoM
-----END CERTIFICATE-----
`;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "dq-hosted-db-"));
const tmpFile = (name: string, content: string) => {
  const f = path.join(TMP, name);
  fs.writeFileSync(f, content);
  return f;
};
const CA_FILE = tmpFile("test-ca.crt", TEST_CA_PEM);
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));
const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const REF = "abcdefghij0123456789";
const PROD = "prodprodprodprod0000";
const OTHER = "zzzzzzzzzz9999999999";
const HOST = "aws-0-us-east-1.pooler.supabase.com";
const PASSWORD = "Fixture-Pass-1234";
const A = "first.owner@example.com";
const B = "second.owner@example.com";
const JOURNAL = journalEntries();
/** Built from parts so no credential-shaped literal exists in the repository. */
const dbUrl = ({
  user = `postgres.${REF}`,
  password = PASSWORD,
  host = HOST,
  port = "5432",
  database = "postgres",
  query = "",
  scheme = "postgresql",
} = {}) =>
  [scheme, "://", user, ":", password, "@", host, ":", port, "/", database, query].join("");
const MIGRATE = "db-migrate:client-preview";
const MARK = "db-mark:client-preview";
const FUNCTIONS = "db-functions:client-preview";
const INSPECT = "db-inspect:client-preview";
const env = (operation: string, over: Record<string, string | undefined> = {}) => ({
  PREVIEW_API_URL: `https://${REF}.supabase.co`,
  PREVIEW_DB_URL: dbUrl(),
  PREVIEW_FORBIDDEN_REFS: PROD,
  PREVIEW_DB_CA_FILE: CA_FILE,
  DQ_PREVIEW_CONFIRM: `client-preview:${operation}:${REF}`,
  PREVIEW_PERSONAL_OWNERS: `${A},${B}`,
  ...over,
});
const refusal = (fn: () => unknown): string => {
  let error: unknown;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(PreviewRefusal);
  return (error as Error).message;
};
const noSecrets = (text: string) => {
  expect(text).not.toContain(PASSWORD);
  expect(text).not.toContain("postgresql://");
  expect(text).not.toContain(A);
  expect(text).not.toContain(B);
};

describe("database URL: the Session pooler of this project only", () => {
  it("accepts postgres.<ref> on the pooler, session mode, always with full TLS verification", () => {
    const r = parseHostedDbUrl(dbUrl(), REF);
    expect(r).toMatchObject({ ref: REF, host: HOST, user: `postgres.${REF}` });
    // the child (drizzle-kit) reads the mode from the URL; this process passes explicit options
    expect(r.connectionUrl.endsWith("/postgres?sslmode=verify-full")).toBe(true);
    expect(r.sessionUrl.endsWith("/postgres")).toBe(true);
    expect(
      parseHostedDbUrl(dbUrl({ query: "?sslmode=verify-full", scheme: "postgres" }), REF)
        .connectionUrl,
    ).toBe(r.connectionUrl);
    expect(parseHostedDbUrl(dbUrl({ host: "aws-1-sa-east-1.pooler.supabase.com" }), REF).host).toBe(
      "aws-1-sa-east-1.pooler.supabase.com",
    );
  });
  it.each([
    [
      "the persistent QA (local)",
      dbUrl({ host: "127.0.0.1", port: "55322", user: "postgres" }),
      /local or private/,
    ],
    [
      "the local demo",
      dbUrl({ host: "localhost", port: "54322", user: "postgres" }),
      /local or private/,
    ],
    ["a private network host", dbUrl({ host: "192.168.0.10" }), /local or private/],
    [
      "the direct database host",
      dbUrl({ host: `db.${REF}.supabase.co`, user: "postgres" }),
      /direct database host/,
    ],
    [
      "a look-alike pooler host",
      dbUrl({ host: `${HOST}.evil.example` }),
      /not a Supabase Session pooler/,
    ],
    ["another provider", dbUrl({ host: "db.example.com" }), /not a Supabase Session pooler/],
    ["the transaction pooler", dbUrl({ port: "6543" }), /transaction pooler/],
    ["another port", dbUrl({ port: "5433" }), /must be 5432/],
    [
      "a user of ANOTHER project (production)",
      dbUrl({ user: `postgres.${PROD}` }),
      /another project/,
    ],
    ["a user without the project ref", dbUrl({ user: "postgres" }), /postgres\.<project ref>/],
    [
      "another role of the project",
      dbUrl({ user: `supabase_admin.${REF}` }),
      /postgres\.<project ref>/,
    ],
    ["no password", dbUrl({ password: "" }), /no password/],
    ["a placeholder password", dbUrl({ password: "<senha>" }), /placeholder/],
    ["another database", dbUrl({ database: "template1" }), /must be postgres/],
    ["extra connection options", dbUrl({ query: "?options=-c%20role%3Dx" }), /only carry sslmode/],
    [
      "TLS options besides the mode",
      dbUrl({ query: "?sslmode=verify-full&sslrootcert=x" }),
      /only carry sslmode/,
    ],
    ["TLS switched off", dbUrl({ query: "?sslmode=disable" }), /without full verification/],
    [
      "encryption without verification (require)",
      dbUrl({ query: "?sslmode=require" }),
      /without full verification/,
    ],
    [
      "opportunistic TLS (prefer)",
      dbUrl({ query: "?sslmode=prefer" }),
      /without full verification/,
    ],
    ["opportunistic TLS (allow)", dbUrl({ query: "?sslmode=allow" }), /without full verification/],
    [
      "chain-only verification (verify-ca)",
      dbUrl({ query: "?sslmode=verify-ca" }),
      /without full verification/,
    ],
    [
      "a driver-specific bypass",
      dbUrl({ query: "?sslmode=no-verify" }),
      /without full verification/,
    ],
    ["an http URL", `https://${REF}.supabase.co`, /PostgreSQL connection URL/],
    ["garbage", "not a url", /missing or unreadable/],
    ["nothing", undefined, /missing or unreadable/],
  ])("refuses %s, without echoing the URL or the password", (_label, raw, message) => {
    const msg = refusal(() => parseHostedDbUrl(raw, REF));
    expect(msg).toMatch(message);
    noSecrets(msg);
  });
});

describe("production is blocked by name", () => {
  it("requires the declaration and refuses a project listed in it", () => {
    expect(parseForbiddenRefs(` ${PROD} , ${OTHER} `, REF)).toEqual([PROD, OTHER]);
    expect(refusal(() => parseForbiddenRefs(undefined, REF))).toMatch(
      /PREVIEW_FORBIDDEN_REFS is required/,
    );
    expect(refusal(() => parseForbiddenRefs("", REF))).toMatch(/required/);
    expect(refusal(() => parseForbiddenRefs("production", REF))).toMatch(/20-character/);
    expect(refusal(() => parseForbiddenRefs(`${PROD},${REF}`, REF))).toMatch(
      /declared as forbidden/,
    );
  });
  it("refuses production even when every value was copied from it consistently", () => {
    const msg = refusal(() =>
      assertHostedPreviewDb(
        {
          PREVIEW_API_URL: `https://${PROD}.supabase.co`,
          PREVIEW_DB_URL: dbUrl({ user: `postgres.${PROD}` }),
          PREVIEW_FORBIDDEN_REFS: PROD,
          DQ_PREVIEW_CONFIRM: `client-preview:${MIGRATE}:${PROD}`,
        },
        MIGRATE,
      ),
    );
    expect(msg).toMatch(/declared as forbidden/);
    noSecrets(msg);
  });
});

describe("offline checks, all of them, before any connection", () => {
  it("accepts a consistent target for each operation", () => {
    for (const op of HOSTED_DB_OPERATIONS) {
      const t = assertHostedPreviewDb(env(op), op);
      expect(t).toMatchObject({ operation: op, ref: REF, host: HOST });
      expect(() => assertHostedDbTarget(t)).not.toThrow();
    }
    expect(assertHostedPreviewDb(env(MARK), MARK).personalOwners).toEqual([A, B]);
    expect(assertHostedPreviewDb(env(MIGRATE), MIGRATE).personalOwners).toBeNull();
  });
  it.each([
    ["an unknown operation", "db-drop:client-preview", {}, /unknown database operation/],
    ["a seed operation", "seed:client-preview", {}, /unknown database operation/],
    [
      "an API URL of another project",
      MIGRATE,
      { PREVIEW_API_URL: `https://${OTHER}.supabase.co` },
      /operator confirmation|another project/,
    ],
    [
      "a local API URL",
      MIGRATE,
      { PREVIEW_API_URL: "http://127.0.0.1:55321" },
      /local or private host/,
    ],
    ["no confirmation", MIGRATE, { DQ_PREVIEW_CONFIRM: undefined }, /operator confirmation/],
    [
      "the confirmation of another operation",
      MIGRATE,
      { DQ_PREVIEW_CONFIRM: `client-preview:${INSPECT}:${REF}` },
      /operator confirmation/,
    ],
    [
      "the confirmation of another project",
      MIGRATE,
      { DQ_PREVIEW_CONFIRM: `client-preview:${MIGRATE}:${OTHER}` },
      /operator confirmation/,
    ],
    [
      "a database of another project",
      MIGRATE,
      { PREVIEW_DB_URL: dbUrl({ user: `postgres.${OTHER}` }) },
      /another project/,
    ],
    [
      "no forbidden-ref declaration",
      MIGRATE,
      { PREVIEW_FORBIDDEN_REFS: undefined },
      /PREVIEW_FORBIDDEN_REFS is required/,
    ],
    [
      "marking without declaring the personal owners",
      MARK,
      { PREVIEW_PERSONAL_OWNERS: undefined },
      /PREVIEW_PERSONAL_OWNERS must be declared/,
    ],
    [
      "marking with three personal owners",
      MARK,
      { PREVIEW_PERSONAL_OWNERS: `${A},${B},third@example.com` },
      /at most 2/,
    ],
    [
      "marking with a stand-in test address",
      MARK,
      { PREVIEW_PERSONAL_OWNERS: "x@personal.test" },
      /reserved test address/,
    ],
  ])("refuses %s", (_label, operation, over, message) => {
    const msg = refusal(() => assertHostedPreviewDb(env(operation, over), operation));
    expect(msg).toMatch(message);
    noSecrets(msg);
  });
  it("a hand-built target is never accepted", () => {
    expect(() =>
      assertHostedDbTarget({ operation: MIGRATE, ref: REF, host: HOST, connectionUrl: dbUrl() }),
    ).toThrow(/not a database target checked/);
    expect(() => assertHostedDbTarget(null)).toThrow(PreviewRefusal);
  });
});

const facts = (over: Partial<DbFacts> = {}): DbFacts => ({
  user: "postgres",
  database: "postgres",
  versionNum: 170004,
  publicRelations: 0,
  publicFunctions: 0,
  hasTracker: false,
  hasLocalGuard: false,
  hasPreviewSchema: false,
  hasAuth: true,
  trackerRows: null,
  marker: null,
  users: 0,
  nonTestUsers: 0,
  storedObjects: 0,
  organizations: null,
  nonDemoOrganizations: null,
  platformRoles: null,
  ...over,
});
const MIGRATED = {
  hasTracker: true,
  trackerRows: JOURNAL,
  publicRelations: 40,
  publicFunctions: 90,
  organizations: 0,
  nonDemoOrganizations: 0,
  platformRoles: 0,
};
const MARKED = {
  ...MIGRATED,
  hasPreviewSchema: true,
  marker: { label: "client-preview", ref: REF },
};
const kind = (f: Partial<DbFacts>) => classifyState(facts(f), REF, JOURNAL).kind;

describe("database states", () => {
  it("classifies empty, migrated-unmarked and preview", () => {
    expect(kind({})).toBe("empty");
    expect(kind(MIGRATED)).toBe("migrated-unmarked");
    expect(kind(MARKED)).toBe("preview");
    // seeded preview: demo organization, demo accounts and the fixed personal owners
    expect(kind({ ...MARKED, users: 5, nonTestUsers: 0, organizations: 1 })).toBe("preview");
    // a later migration is pending on the marked preview
    expect(kind({ ...MARKED, trackerRows: JOURNAL - 1 })).toBe("preview");
  });
  it.each([
    ["a table in public without the tracker", { publicRelations: 1 }, "unknown"],
    ["a function in public without the tracker", { publicFunctions: 1 }, "unknown"],
    ["an account in an unmigrated database", { users: 1, nonTestUsers: 1 }, "unknown"],
    ["stored objects", { storedObjects: 3 }, "unknown"],
    ["a database that is not a Supabase project", { hasAuth: false }, "unknown"],
    ["another session user", { user: "supabase_admin" }, "unknown"],
    ["a partial migration", { ...MIGRATED, trackerRows: 12 }, "unknown"],
    ["more migrations than the repository", { ...MIGRATED, trackerRows: JOURNAL + 1 }, "unknown"],
    [
      "a migrated database with a real organization (production)",
      { ...MIGRATED, organizations: 2, nonDemoOrganizations: 2 },
      "unknown",
    ],
    [
      "a migrated database with real accounts",
      { ...MIGRATED, users: 4, nonTestUsers: 4 },
      "unknown",
    ],
    ["a migrated database with a platform admin", { ...MIGRATED, platformRoles: 1 }, "unknown"],
    ["a migrated database that already has test accounts", { ...MIGRATED, users: 3 }, "unknown"],
    [
      "a marker of another project (copied database)",
      { ...MARKED, marker: { label: "client-preview", ref: OTHER } },
      "foreign",
    ],
    [
      "a preview schema without a marker row",
      { ...MARKED, marker: { label: null, ref: null } },
      "unknown",
    ],
    [
      "a marked database with a real account outside the list",
      { ...MARKED, users: 6, nonTestUsers: 1 },
      "unknown",
    ],
    ["a marked database with a platform admin", { ...MARKED, platformRoles: 1 }, "unknown"],
    [
      "a marked database with a non-demo organization",
      { ...MARKED, organizations: 2, nonDemoOrganizations: 1 },
      "unknown",
    ],
    ["a local disposable stack", { hasLocalGuard: true }, "local-stack"],
  ])("refuses %s for every write", (_label, f, expected) => {
    const state = classifyState(facts(f as Partial<DbFacts>), REF, JOURNAL);
    expect(state.kind).toBe(expected);
    for (const op of [MIGRATE, MARK, FUNCTIONS])
      expect(() => assertStateAllows(op, state)).toThrow(PreviewRefusal);
    expect(() => assertStateAllows(INSPECT, state)).not.toThrow(); // read-only diagnosis stays possible
  });
  it("each operation runs only in its own states", () => {
    const state = (k: string) => ({ kind: k, reason: "" });
    const allowed = (op: string) =>
      ["empty", "migrated-unmarked", "preview", "foreign", "unknown", "local-stack"].filter((k) => {
        try {
          assertStateAllows(op, state(k));
          return true;
        } catch {
          return false;
        }
      });
    expect(allowed(MIGRATE)).toEqual(["empty", "preview"]); // the first migration needs an empty database
    expect(allowed(MARK)).toEqual(["migrated-unmarked"]);
    expect(allowed(FUNCTIONS)).toEqual(["preview"]);
    expect(() => assertStateAllows("db-drop:client-preview", state("empty"))).toThrow(
      PreviewRefusal,
    );
  });
});

/** Fake session: answers the inspection queries from `f`, records everything it is asked. */
function fakeDb(initial: Partial<DbFacts>, after?: Partial<DbFacts>) {
  let f = facts(initial);
  const queries: string[] = [];
  const session: DbSession = {
    query: async (text: string) => {
      queries.push(text);
      const t = text.replace(/\s+/g, " ");
      if (t.includes("current_user as usr"))
        return [
          {
            usr: f.user,
            db: f.database,
            version_num: f.versionNum,
            public_relations: f.publicRelations,
            public_functions: f.publicFunctions,
            has_tracker: f.hasTracker,
            has_local_guard: f.hasLocalGuard,
            has_preview_schema: f.hasPreviewSchema,
            has_marker: f.marker !== null,
            has_personal: f.hasPreviewSchema,
            has_auth: f.hasAuth,
            has_storage: f.storedObjects !== null,
            has_orgs: f.organizations !== null,
            has_roles: f.platformRoles !== null,
          },
        ];
      if (t.includes("from drizzle.__drizzle_migrations")) return [{ n: f.trackerRows }];
      if (t.includes("from dq_preview.marker"))
        return f.marker?.label ? [{ label: f.marker.label, project_ref: f.marker.ref }] : [];
      if (t.includes("from auth.users")) return [{ users: f.users, non_test: f.nonTestUsers }];
      if (t.includes("from storage.objects")) return [{ n: f.storedObjects }];
      if (t.includes("from public.organizations"))
        return [{ total: f.organizations, non_demo: f.nonDemoOrganizations }];
      if (t.includes("from public.user_roles")) return [{ n: f.platformRoles }];
      if (/^set default_transaction_read_only = (on|off)$/.test(t) || t.startsWith("notify pgrst"))
        return [];
      // a SQL file was applied: the database moves to its next state
      if (after) f = facts(after);
      return [];
    },
    end: vi.fn(async () => undefined),
  };
  return {
    session,
    queries,
    isWrite: (q: string) => !/^\s*(select|set default_transaction_read_only|notify)/i.test(q),
  };
}

describe("inspection", () => {
  it("reads the facts with read-only queries and excludes the fixed personal owners from the real accounts", async () => {
    const { session, queries, isWrite } = fakeDb({ ...MARKED, users: 5, organizations: 1 });
    const f = await inspectDatabase(session);
    expect(f).toMatchObject({
      hasTracker: true,
      trackerRows: JOURNAL,
      marker: { label: "client-preview", ref: REF },
      users: 5,
    });
    expect(queries.filter(isWrite)).toEqual([]);
    expect(queries.find((q) => q.includes("from auth.users"))).toContain(
      "not in (select email from dq_preview.personal_accounts)",
    );
    const fresh = fakeDb({});
    await inspectDatabase(fresh.session);
    expect(fresh.queries.find((q) => q.includes("from auth.users"))).not.toContain(
      "personal_accounts",
    );
    expect(
      fresh.queries.some(
        (q) => q.includes("drizzle.__drizzle_migrations") && !q.includes("to_regclass"),
      ),
    ).toBe(false);
  });
});

describe("SQL files (psql scripts run without psql)", () => {
  it("renders the identity marker with quoted values and no psql syntax left", () => {
    const sql = renderSqlFile(read(IDENTITY_SQL), {
      project_ref: REF,
      personal_owners: `${A},${B}`,
    });
    expect(sql).not.toMatch(/^\s*\\/m);
    expect(sql).not.toMatch(/:'[a-z_]+'/);
    expect(sql).toContain(`set_config('dq_preview.project_ref', '${REF}', true)`);
    expect(sql).toContain(`set_config('dq_preview.personal_owners', '${A},${B}', true)`);
    // the literal used to detect a missing psql variable is left alone
    expect(sql).toContain("= ':personal_owners'");
  });
  it("renders the dataset functions without variables", () => {
    const sql = renderSqlFile(read(FUNCTIONS_SQL));
    expect(sql).not.toMatch(/^\s*\\/m);
    expect(sql).toContain("CREATE OR REPLACE FUNCTION public.client_preview_purge_operational");
  });
  it("quotes values and refuses anything it does not understand", () => {
    expect(renderSqlFile("select :'v';", { v: "o'brien" })).toBe("select 'o''brien';");
    expect(() => renderSqlFile("select :'missing';")).toThrow(/needs the variable missing/);
    expect(() => renderSqlFile("select 1;", { extra: "x" })).toThrow(
      /does not use the variable extra/,
    );
    expect(() => renderSqlFile("\\i other.sql\nselect 1;")).toThrow(/meta-command/);
    expect(() => renderSqlFile("\\! rm -rf /\nselect 1;")).toThrow(/meta-command/);
    expect(() => renderSqlFile("\\set ON_ERROR_STOP off\nselect 1;")).toThrow(/meta-command/);
    expect(() => renderSqlFile("select :'v';", { v: "a\nb" })).toThrow(/invalid value/);
    expect(() => renderSqlFile("select :'v';", { v: "a\\b" })).toThrow(/invalid value/);
    expect(() => renderSqlFile("select :'V';", { V: "x" })).toThrow(/invalid SQL variable name/);
  });
});

const okSpawn = (stdout = "[✓] migrations applied successfully!"): SpawnFn =>
  vi.fn(() => ({ status: 0, stdout, stderr: "" }));

describe("migrations (drizzle-kit child process)", () => {
  it("passes only the connection, the CA file and the gate confirmation, in a minimal environment", () => {
    const target = assertHostedPreviewDb(env(MIGRATE), MIGRATE);
    const spawn = okSpawn();
    const lines: string[] = [];
    runMigrations(target, {
      spawn,
      log: (l) => lines.push(l),
      env: {
        PATH: "/bin",
        SUPABASE_SERVICE_ROLE_KEY: "leak",
        DQ_GUARD_CONFIRM: "stale",
        VITE_X: "1",
        // none of these may reach the child: they would weaken or redirect its TLS verification
        NODE_TLS_REJECT_UNAUTHORIZED: "0",
        NODE_OPTIONS: "--use-system-ca",
        NODE_EXTRA_CA_CERTS: "/somewhere/else.pem",
        SSL_CERT_FILE: "/somewhere/else.pem",
        PGSSLMODE: "disable",
      },
    });
    const [, args, options] = (spawn as unknown as { mock: { calls: Parameters<SpawnFn>[] } }).mock
      .calls[0]!;
    expect(args.map((a) => path.basename(a))).toEqual(["bin.cjs", "migrate"]);
    expect(Object.keys(options.env).sort()).toEqual([
      "DQ_GUARD_CONFIRM",
      "LOVABLE_DB_MIGRATION_URL",
      "NODE_EXTRA_CA_CERTS",
      "PATH",
    ]);
    expect(options.env["DQ_GUARD_CONFIRM"]).toBe(`migrate:remote:${HOST}`);
    expect(options.env["LOVABLE_DB_MIGRATION_URL"]).toBe(target.connectionUrl);
    // the child's driver verifies chain and host name (verify-full) with the operator's CA file
    expect(options.env["LOVABLE_DB_MIGRATION_URL"]!.endsWith("?sslmode=verify-full")).toBe(true);
    expect(options.env["NODE_EXTRA_CA_CERTS"]).toBe(path.resolve(CA_FILE));
    expect(lines.join("\n")).toContain("migrations applied successfully");
    noSecrets(lines.join("\n"));
  });
  it("redacts whatever the child prints and stops on failure", () => {
    const target = assertHostedPreviewDb(env(MIGRATE), MIGRATE);
    const lines: string[] = [];
    const failing: SpawnFn = vi.fn(() => ({
      status: 1,
      stdout: "",
      stderr: `error: connect failed for ${target.connectionUrl} (password ${PASSWORD})`,
    }));
    expect(() =>
      runMigrations(target, { spawn: failing, log: (l) => lines.push(l), env: {} }),
    ).toThrow(/drizzle-kit migrate failed/);
    expect(lines.length).toBeGreaterThan(0);
    noSecrets(lines.join("\n"));
  });
  it("runs only for a target checked for db-migrate", () => {
    const target = assertHostedPreviewDb(env(INSPECT), INSPECT);
    expect(() => runMigrations(target, { spawn: okSpawn(), env: {} })).toThrow(
      /not checked for db-migrate/,
    );
  });
});

describe("operations end to end (fake session and child)", () => {
  const run = async (
    operation: string,
    before: Partial<DbFacts>,
    after?: Partial<DbFacts>,
    spawn: SpawnFn = okSpawn(),
  ) => {
    const target = assertHostedPreviewDb(env(operation), operation);
    const db = fakeDb(before, after);
    const lines: string[] = [];
    const result = await runHostedDb(target, {
      db: db.session,
      spawn,
      log: (l) => lines.push(l),
    }).then(
      (state) => ({ state, error: null as Error | null }),
      (error: Error) => ({ state: null, error }),
    );
    return { ...result, ...db, lines, spawn };
  };

  it("inspect never writes, whatever the state", async () => {
    for (const before of [{}, MIGRATED, MARKED, { publicRelations: 9 }]) {
      const r = await run(INSPECT, before);
      expect(r.error).toBeNull();
      expect(r.queries[0]).toBe("set default_transaction_read_only = on");
      expect(r.queries.filter(r.isWrite)).toEqual([]);
      expect(r.queries).not.toContain("set default_transaction_read_only = off");
      expect(r.spawn).not.toHaveBeenCalled();
      expect(r.session.end).toHaveBeenCalled();
    }
  });

  it("the first migration requires an empty database", async () => {
    const spawn = okSpawn();
    const target = assertHostedPreviewDb(env(MIGRATE), MIGRATE);
    // empty -> migrated: the child moves the database to its next state
    let migrated = false;
    const before = fakeDb({});
    const afterDb = fakeDb(MIGRATED);
    const session: DbSession = {
      query: (text) => (migrated ? afterDb.session.query(text) : before.session.query(text)),
      end: vi.fn(async () => undefined),
    };
    const moving: SpawnFn = vi.fn((...a: Parameters<SpawnFn>) => {
      migrated = true;
      return spawn(...a);
    });
    const state = await runHostedDb(target, { db: session, spawn: moving, log: () => {} });
    expect(state.kind).toBe("migrated-unmarked");
    expect(moving).toHaveBeenCalledTimes(1);
    expect([...before.queries, ...afterDb.queries].filter(before.isWrite)).toEqual([]); // this session only reads

    for (const notEmpty of [
      { publicRelations: 3 },
      MIGRATED,
      { users: 2, nonTestUsers: 2 },
      { ...MIGRATED, trackerRows: 5 },
    ]) {
      const r = await run(MIGRATE, notEmpty);
      expect(r.error).toBeInstanceOf(PreviewRefusal);
      expect(r.error?.message).toMatch(/db-migrate is refused/);
      expect(r.spawn).not.toHaveBeenCalled();
    }
  });

  it("fails loudly when the tracker is incomplete after the migration", async () => {
    const r = await run(MIGRATE, {});
    expect(r.error?.message).toMatch(/tracker has/);
  });

  it("mark runs only on a fully migrated, unmarked database and leaves the session read-only again", async () => {
    const r = await run(MARK, MIGRATED, MARKED);
    expect(r.error).toBeNull();
    expect(r.state?.kind).toBe("preview");
    const sqlIndex = r.queries.findIndex((q) => q.includes("CREATE SCHEMA dq_preview"));
    expect(r.queries[sqlIndex - 1]).toBe("set default_transaction_read_only = off");
    expect(r.queries[sqlIndex]).toContain(`'${A},${B}'`);
    expect(r.queries[sqlIndex + 1]).toBe("notify pgrst, 'reload schema'");
    expect(r.queries[sqlIndex + 2]).toBe("set default_transaction_read_only = on");
    expect(r.queries.filter(r.isWrite)).toHaveLength(1);
    noSecrets(r.lines.join("\n"));
    expect(r.lines.join("\n")).toContain("2 personal owner(s) fixed");

    for (const wrong of [
      {},
      MARKED,
      { ...MIGRATED, platformRoles: 1 },
      { ...MIGRATED, organizations: 1, nonDemoOrganizations: 1 },
    ]) {
      const refused = await run(MARK, wrong);
      expect(refused.error).toBeInstanceOf(PreviewRefusal);
      expect(refused.queries.filter(refused.isWrite)).toEqual([]);
      expect(refused.queries).not.toContain("set default_transaction_read_only = off");
    }
  });

  it("functions run only on the database marked for this project", async () => {
    const r = await run(FUNCTIONS, MARKED, MARKED);
    expect(r.error).toBeNull();
    expect(r.queries.filter(r.isWrite)).toHaveLength(1);
    expect(r.queries.find(r.isWrite)).toContain("client_preview_purge_operational");
    for (const wrong of [
      {},
      MIGRATED,
      { ...MARKED, marker: { label: "client-preview", ref: OTHER } },
    ]) {
      const refused = await run(FUNCTIONS, wrong);
      expect(refused.error).toBeInstanceOf(PreviewRefusal);
      expect(refused.queries.filter(refused.isWrite)).toEqual([]);
    }
  });

  it("stops when the SQL file did not leave a marked preview", async () => {
    const r = await run(MARK, MIGRATED, MIGRATED);
    expect(r.error?.message).toMatch(
      /after .*client-preview-identity\.sql the database is migrated-unmarked/,
    );
  });
});

describe("TLS: the CA file the pooler certificate is verified against", () => {
  it("accepts valid CA certificates and reports only public facts", () => {
    const ca = loadServerCa(CA_FILE);
    expect(ca.file).toBe(path.resolve(CA_FILE));
    expect(ca.certs).toHaveLength(1);
    expect(ca.certs[0]!.subject).toContain("Dinequora Test Root CA");
    expect(ca.certs[0]!.sha256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(ca.certs[0]!.validTo).toBe("2126-10-20");
    expect(loadServerCa(tmpFile("bundle.crt", TEST_CA_PEM + TEST_CA_PEM)).certs).toHaveLength(2);
  });
  const keyBlock = ["-----BEGIN", "PRIVATE KEY-----\nAAAA\n-----END", "PRIVATE KEY-----\n"].join(
    " ",
  );
  it.each([
    ["no declaration", undefined, /PREVIEW_DB_CA_FILE is required/],
    ["an empty declaration", "  ", /PREVIEW_DB_CA_FILE is required/],
    ["a missing file", path.join(TMP, "nope.crt"), /missing, unreadable/],
    [
      "a file that is not a certificate",
      tmpFile("text.crt", "hello"),
      /one to four PEM certificates/,
    ],
    [
      "anything besides certificates",
      tmpFile("extra.crt", `${TEST_CA_PEM}rejectUnauthorized=false\n`),
      /and nothing else/,
    ],
    ["a private key", tmpFile("key.pem", keyBlock + TEST_CA_PEM), /private key/],
    [
      "a corrupted certificate",
      tmpFile("bad.crt", TEST_CA_PEM.replace("MIIBvTCC", "AAAAAAAA")),
      /not a valid certificate/,
    ],
    [
      "a server certificate as the trust anchor",
      tmpFile("leaf.crt", SERVER_CERT_PEM),
      /not a CA certificate/,
    ],
    ["an expired CA", tmpFile("expired.crt", EXPIRED_CA_PEM), /outside its validity period/],
    [
      "a valid CA together with an expired one",
      tmpFile("mixed.crt", TEST_CA_PEM + EXPIRED_CA_PEM),
      /CA certificate #2 is outside its validity period/,
    ],
    ["five certificates", tmpFile("five.crt", TEST_CA_PEM.repeat(5)), /one to four/],
  ])("refuses %s", (_label, file, message) => {
    expect(refusal(() => loadServerCa(file))).toMatch(message);
  });
  it("refuses a CA before and after its validity period", () => {
    expect(() => loadServerCa(CA_FILE, Date.parse("2020-01-01"))).toThrow(/validity period/);
    expect(() => loadServerCa(CA_FILE, Date.parse("2200-01-01"))).toThrow(/validity period/);
  });
  it("every operation needs the CA file and refuses a process with verification turned off", () => {
    for (const op of HOSTED_DB_OPERATIONS) {
      expect(
        refusal(() => assertHostedPreviewDb(env(op, { PREVIEW_DB_CA_FILE: undefined }), op)),
      ).toMatch(/PREVIEW_DB_CA_FILE is required/);
      expect(
        refusal(() => assertHostedPreviewDb(env(op, { NODE_TLS_REJECT_UNAUTHORIZED: "0" }), op)),
      ).toMatch(/must never be turned off/);
      expect(
        refusal(() =>
          assertHostedPreviewDb(
            env(op, { PREVIEW_DB_CA_FILE: tmpFile("leaf2.crt", SERVER_CERT_PEM) }),
            op,
          ),
        ),
      ).toMatch(/not a CA certificate/);
    }
    expect(() =>
      assertHostedPreviewDb(env(INSPECT, { NODE_TLS_REJECT_UNAUTHORIZED: "1" }), INSPECT),
    ).not.toThrow();
  });
  it("the session's TLS options always verify the chain and the host name", () => {
    const target = assertHostedPreviewDb(env(INSPECT), INSPECT);
    const o = tlsOptions(target);
    expect(o.rejectUnauthorized).toBe(true);
    expect(o.servername).toBe(HOST); // identity is checked against the pooler host name
    expect(o.checkServerIdentity).toBe(tls.checkServerIdentity); // Node's own check, not a stub
    expect(o.ca).toBe(target.ca.pem); // only the operator's CA file, not the system trust store
    expect(o.minVersion).toBe("TLSv1.2");
    expect(Object.isFrozen(o)).toBe(true);
    expect(() => tlsOptions({ host: HOST, ca: target.ca } as never)).toThrow(
      /not a database target checked/,
    );
    const text = describeTls(target).join("\n");
    expect(text).toContain("verify-full");
    expect(text).toContain("Dinequora Test Root CA");
    noSecrets(text);
  });
});

const OPENSSL = spawnSync("openssl", ["version"], { encoding: "utf8" }).status === 0;
/**
 * Real TLS handshakes on 127.0.0.1 with a throw-away PKI created for this run (keys never leave the
 * temporary directory): a root, an intermediate WITHOUT Key Usage (like the pooler's, per Supabase
 * issue reports), a server certificate for the pooler host name, one for another host, one for
 * localhost, a rogue root with its own certificate for the pooler host name, and a self-signed one.
 */
describe.skipIf(!OPENSSL)("TLS: real handshakes with full verification", () => {
  const dir = path.join(TMP, "pki");
  const pem = (name: string) => fs.readFileSync(path.join(dir, name), "utf8");
  const openssl = (...args: string[]) => {
    const r = spawnSync("openssl", args, { cwd: dir, encoding: "utf8" });
    if (r.status !== 0) throw new Error(`openssl ${args[0]} failed: ${r.stderr}`);
  };
  const KEY = ["-newkey", "ec", "-pkeyopt", "ec_paramgen_curve:prime256v1", "-nodes"];
  const root = (name: string, cn: string) =>
    openssl(
      ...["req", "-x509", ...KEY, "-keyout", `${name}.key`, "-out", `${name}.crt`],
      ...["-subj", `/CN=${cn}`, "-days", "2"],
      ...["-addext", "basicConstraints=critical,CA:TRUE"],
      ...["-addext", "keyUsage=critical,keyCertSign,cRLSign"],
    );
  const issue = (name: string, cn: string, issuer: string, extensions: string) => {
    openssl("req", ...KEY, "-keyout", `${name}.key`, "-out", `${name}.csr`, "-subj", `/CN=${cn}`);
    fs.writeFileSync(path.join(dir, `${name}.ext`), extensions);
    openssl(
      ...["x509", "-req", "-in", `${name}.csr`, "-CA", `${issuer}.crt`, "-CAkey", `${issuer}.key`],
      ...["-CAcreateserial", "-out", `${name}.crt`, "-days", "2", "-extfile", `${name}.ext`],
    );
  };
  const server = (host: string) => `basicConstraints=CA:FALSE\nsubjectAltName=DNS:${host}\n`;
  const OTHER_HOST = "aws-0-eu-west-1.pooler.supabase.com";
  beforeAll(() => {
    fs.mkdirSync(dir);
    root("root", "Test Root (stands for the Supabase root)");
    issue("inter", "Test Intermediate", "root", "basicConstraints=critical,CA:TRUE\n");
    issue("pooler", HOST, "inter", server(HOST));
    issue("otherhost", OTHER_HOST, "inter", server(OTHER_HOST));
    issue("local", "localhost", "inter", server("localhost"));
    root("rogue", "Rogue Root");
    issue("roguepooler", HOST, "rogue", server(HOST));
    openssl(
      ...["req", "-x509", ...KEY, "-keyout", "self.key", "-out", "self.crt", "-days", "2"],
      ...["-subj", `/CN=${HOST}`, "-addext", `subjectAltName=DNS:${HOST}`],
    );
  }, 120_000);

  const target = (caFile = path.join(dir, "root.crt")) =>
    assertHostedPreviewDb(env(INSPECT, { PREVIEW_DB_CA_FILE: caFile }), INSPECT);
  const certChain = (name: string, chain: string[]) =>
    [pem(`${name}.crt`), ...chain.map((c) => pem(`${c}.crt`))].join("\n");
  const listen = (s: net.Server, host: string) =>
    new Promise<number>((resolve) =>
      s.listen(0, host, () => resolve((s.address() as net.AddressInfo).port)),
    );
  const close = (s: net.Server) => new Promise<void>((resolve) => s.close(() => resolve()));

  /** Plain TLS server; `fn` gets its port and a counter of completed handshakes. */
  async function withTlsServer(
    name: string,
    chain: string[],
    fn: (port: number, seen: { secure: number }) => Promise<void>,
  ) {
    const seen = { secure: 0 };
    const s = tls.createServer(
      { key: pem(`${name}.key`), cert: certChain(name, chain) },
      (sock) => {
        seen.secure++;
        sock.on("error", () => {});
        sock.end();
      },
    );
    s.on("tlsClientError", () => {});
    const port = await listen(s, "127.0.0.1");
    try {
      await fn(port, seen);
    } finally {
      await close(s);
    }
  }
  const handshake = (port: number, options: tls.ConnectionOptions) =>
    new Promise<string>((resolve) => {
      const s = tls.connect({ host: "127.0.0.1", port, ...options }, () => {
        s.end();
        resolve("verified");
      });
      s.on("error", (e: NodeJS.ErrnoException) => resolve(String(e.code)));
    });
  // The server records a handshake a moment after the client finishes it: wait for the server's side
  // (and give a refused handshake the same time to prove it never completes).
  const settled = async (seen: { secure: number }, expected: number) => {
    for (let i = 0; i < 40 && seen.secure !== expected; i++)
      await new Promise((r) => setTimeout(r, 25));
    if (expected === 0) await new Promise((r) => setTimeout(r, 150));
    return seen.secure;
  };

  describe("the session's options (tlsOptions) against TLS servers", () => {
    it("accepts the pooler certificate that chains to the operator's CA through the intermediate", async () => {
      await withTlsServer("pooler", ["inter"], async (port, seen) => {
        expect(await handshake(port, tlsOptions(target()))).toBe("verified");
        expect(await settled(seen, 1)).toBe(1);
      });
    });
    it.each([
      [
        "a certificate for the pooler host issued by another root",
        "roguepooler",
        ["rogue"],
        /SELF_SIGNED_CERT_IN_CHAIN/,
      ],
      [
        "the same, without sending its root",
        "roguepooler",
        [],
        /UNABLE_TO_(GET_ISSUER_CERT|VERIFY_LEAF_SIGNATURE)/,
      ],
      ["a self-signed certificate for the pooler host", "self", [], /DEPTH_ZERO_SELF_SIGNED_CERT/],
      [
        "a valid certificate of the same CA issued for ANOTHER host",
        "otherhost",
        ["inter"],
        /ERR_TLS_CERT_ALTNAME_INVALID/,
      ],
      [
        "a chain the server does not complete (no intermediate)",
        "pooler",
        [],
        /UNABLE_TO_(GET_ISSUER_CERT|VERIFY_LEAF_SIGNATURE)/,
      ],
    ])("refuses %s", async (_label, name, chain, code) => {
      await withTlsServer(name as string, chain as string[], async (port, seen) => {
        expect(await handshake(port, tlsOptions(target()))).toMatch(code as RegExp);
        expect(await settled(seen, 0)).toBe(0); // the handshake never completes
      });
    });
    it("refuses the genuine server when the operator's CA file is another CA", async () => {
      await withTlsServer("pooler", ["inter"], async (port) => {
        expect(await handshake(port, tlsOptions(target(CA_FILE)))).toMatch(/SELF_SIGNED|UNABLE_TO/);
      });
    });
    it("control: without verification the rogue server would have been accepted", async () => {
      await withTlsServer("roguepooler", ["rogue"], async (port, seen) => {
        expect(await handshake(port, { rejectUnauthorized: false })).toBe("verified");
        expect(await settled(seen, 1)).toBe(1);
      });
    });
  });

  /**
   * Minimal PostgreSQL front: answers the SSLRequest with "S", upgrades to TLS and, if a startup
   * message arrives (the client accepted the certificate), answers with an ErrorResponse (28000).
   */
  async function withPgServer(
    name: string,
    chain: string[],
    host: string,
    fn: (port: number, seen: { secure: number; startup: number }) => Promise<void>,
  ) {
    const seen = { secure: 0, startup: 0 };
    const secureContext = tls.createSecureContext({
      key: pem(`${name}.key`),
      cert: certChain(name, chain),
    });
    const body = Buffer.from("SFATAL\0VFATAL\0C28000\0Mfixture server\0\0", "latin1");
    const head = Buffer.alloc(5);
    head.write("E");
    head.writeInt32BE(body.length + 4, 1);
    const s = net.createServer((sock) => {
      sock.on("error", () => {});
      sock.once("data", (d) => {
        if (d.length !== 8 || d.readInt32BE(4) !== 80877103) {
          sock.destroy();
          return;
        }
        sock.write("S");
        const t = new tls.TLSSocket(sock, { isServer: true, secureContext });
        t.on("error", () => {});
        t.on("secure", () => seen.secure++);
        t.once("data", () => {
          seen.startup++;
          t.end(Buffer.concat([head, body]));
        });
      });
    });
    const port = await listen(s, host);
    try {
      await fn(port, seen);
    } finally {
      await close(s);
    }
  }
  const TLS_CODE = /SELF_SIGNED|UNABLE_TO|ERR_TLS_CERT_ALTNAME_INVALID|CERT_/;

  describe("the database driver with the session's options", () => {
    const driver = async (port: number, ssl: object | string) => {
      const sql = postgres({
        host: "127.0.0.1",
        port,
        database: "postgres",
        username: "postgres",
        password: "fixture",
        ssl: ssl as never,
        max: 1,
        connect_timeout: 5,
        idle_timeout: 1,
        onnotice: () => {},
      });
      try {
        await sql`select 1`;
        return "connected";
      } catch (e) {
        return String((e as NodeJS.ErrnoException).code ?? (e as Error).message);
      } finally {
        await sql.end({ timeout: 1 }).catch(() => {});
      }
    };
    it("speaks to the server only after the certificate and the host name were verified", async () => {
      await withPgServer("pooler", ["inter"], "127.0.0.1", async (port, seen) => {
        expect(await driver(port, tlsOptions(target()))).toBe("28000"); // reached the protocol
        expect(seen).toEqual({ secure: 1, startup: 1 });
      });
    });
    it.each([
      ["a rogue server", "roguepooler", ["rogue"]],
      ["a certificate for another host", "otherhost", ["inter"]],
      ["a self-signed certificate", "self", []],
    ])("sends nothing (no startup, no password) to %s", async (_label, name, chain) => {
      await withPgServer(name as string, chain as string[], "127.0.0.1", async (port, seen) => {
        expect(await driver(port, tlsOptions(target()))).toMatch(TLS_CODE);
        expect(seen).toEqual({ secure: 0, startup: 0 });
      });
    });
    it("control: the former setting (ssl 'require') would have talked to the rogue server", async () => {
      await withPgServer("roguepooler", ["rogue"], "127.0.0.1", async (port, seen) => {
        expect(await driver(port, "require")).toBe("28000");
        expect(seen.startup).toBe(1);
      });
    });
  });

  describe("the migration child's mode (sslmode=verify-full + NODE_EXTRA_CA_CERTS)", () => {
    // What drizzle-kit does: the driver gets the URL only, in a separate process.
    const script = () =>
      tmpFile(
        "child.mjs",
        [
          `import postgres from ${JSON.stringify(pathToFileURL(path.join(ROOT, "node_modules/postgres/src/index.js")).href)};`,
          "const sql = postgres(process.env.FIXTURE_URL, { max: 1, connect_timeout: 5, onnotice: () => {} });",
          "try { await sql`select 1`; console.log('RESULT connected'); }",
          "catch (e) { console.log('RESULT ' + (e.code ?? e.message)); }",
          "finally { await sql.end({ timeout: 1 }).catch(() => {}); }",
        ].join("\n"),
      );
    const child = (port: number, mode: string, extra: Record<string, string>) =>
      new Promise<string>((resolve) => {
        const url = [
          "postgresql",
          "://postgres",
          ":",
          "fixture",
          "@localhost:",
          port,
          "/postgres?sslmode=",
          mode,
        ].join("");
        const base: Record<string, string> = { FIXTURE_URL: url };
        for (const k of ["PATH", "Path", "SYSTEMROOT", "SystemRoot"])
          if (process.env[k]) base[k] = process.env[k]!;
        const p = spawnChild(process.execPath, [script()], { env: { ...base, ...extra } });
        let out = "";
        p.stdout.on("data", (d: Buffer) => (out += d.toString()));
        p.on("close", () => resolve(/RESULT (.*)/.exec(out)?.[1]?.trim() ?? `no result: ${out}`));
      });
    const withCa = () => ({ NODE_EXTRA_CA_CERTS: path.join(dir, "root.crt") });

    it("verifies chain and host name, then speaks to the server", async () => {
      await withPgServer("local", ["inter"], "localhost", async (port, seen) => {
        expect(await child(port, "verify-full", withCa())).toBe("28000");
        expect(seen).toEqual({ secure: 1, startup: 1 });
      });
    }, 30_000);
    it("refuses the server when the CA file is not given to the child", async () => {
      await withPgServer("local", ["inter"], "localhost", async (port, seen) => {
        expect(await child(port, "verify-full", {})).toMatch(TLS_CODE);
        expect(seen.startup).toBe(0);
      });
    }, 30_000);
    it("refuses a certificate of the right CA issued for another host", async () => {
      await withPgServer("pooler", ["inter"], "localhost", async (port, seen) => {
        expect(await child(port, "verify-full", withCa())).toBe("ERR_TLS_CERT_ALTNAME_INVALID");
        expect(seen.startup).toBe(0);
      });
    }, 30_000);
    it("control: sslmode=require (the former mode) accepts a server it cannot verify", async () => {
      await withPgServer("local", ["inter"], "localhost", async (port, seen) => {
        expect(await child(port, "require", {})).toBe("28000");
        expect(seen.startup).toBe(1);
      });
    }, 30_000);
  });
});

describe("redaction", () => {
  it("removes passwords, URLs, tokens, keys and addresses", () => {
    const secret = "p@ss w0rd/ç";
    const text = [
      `password ${secret} and encoded ${encodeURIComponent(secret)}`,
      dbUrl(),
      ["eyJhbGciOiJIUzI1NiJ9", "eyJyb2xlIjoic2VydmljZV9yb2xlIn0", "c2lnbmF0dXJlLXNpZw"].join("."),
      ["sb", "secret", "0123456789abcdef"].join("_"),
      A,
    ].join(" | ");
    const out = redact(text, [secret]);
    expect(out).not.toContain(secret);
    expect(out).not.toContain(encodeURIComponent(secret));
    expect(out).not.toContain(PASSWORD);
    expect(out).not.toMatch(/eyJ|sb_secret_|@example\.com/);
    expect(out).toContain("<database url>");
  });
});

describe("policy", () => {
  const code = read("scripts/preview/hosted-db.mjs").replace(/^\s*\/\/.*$/gm, "");
  it("connects and spawns only with a checked target, and reads its input from the environment", () => {
    for (const fn of [
      "export async function connectHostedDb(target) {",
      "export async function runHostedDb(",
    ]) {
      const body = code.slice(code.indexOf(fn));
      expect(body.indexOf("assertHostedDbTarget(target)"), fn).toBeGreaterThan(-1);
      expect(body.indexOf("assertHostedDbTarget(target)"), fn).toBeLessThan(body.indexOf("\n}\n"));
    }
    const migrations = code.slice(code.indexOf("export function runMigrations("));
    expect(migrations.indexOf("assertHostedDbTarget(target)")).toBeLessThan(
      migrations.indexOf("spawn("),
    );
    expect(code.indexOf("assertHostedDbTarget(target);\n  const sql = postgres(")).toBeGreaterThan(
      -1,
    );
    // the only use of argv is to detect direct execution
    expect(code.match(/process\.argv/g)).toHaveLength(2);
    expect(code).toMatch(
      /process\.argv\[1\] && path\.resolve\(process\.argv\[1\]\) === fileURLToPath/,
    );
    expect(code).not.toMatch(/process\.env\.[A-Z_]*(DISABLE|SKIP|FORCE|BYPASS|ALLOW)/);
  });
  it("TLS verification cannot be switched off anywhere in the file", () => {
    // the session: explicit options that verify chain and host name, on a URL without a mode
    expect(code).toMatch(
      /const sql = postgres\(target\.sessionUrl, \{[\s\S]{0,200}ssl: tlsOptions\(target\),/,
    );
    expect(code.match(/rejectUnauthorized/g)).toHaveLength(1);
    expect(code).toMatch(/rejectUnauthorized: true,/);
    expect(code).not.toMatch(/rejectUnauthorized:\s*(false|0|!1)/);
    expect(code).not.toMatch(/ssl:\s*["'`](require|prefer|allow|no-verify|disable)["'`]/);
    expect(code).not.toMatch(/checkServerIdentity:\s*\(/); // never a custom (stub) identity check
    expect(code).toMatch(/checkServerIdentity: tls\.checkServerIdentity,/);
    // the only mode ever written into a URL is verify-full
    expect([...code.matchAll(/sslmode=([a-z-]+)/g)].map((m) => m[1])).toEqual(
      expect.arrayContaining(["verify-full"]),
    );
    expect(code).not.toMatch(/sslmode=(require|prefer|allow|disable|no-verify|verify-ca)\b/);
    // the child gets the CA file and nothing that could weaken verification
    const migrations = code.slice(code.indexOf("export function runMigrations("));
    expect(migrations).toMatch(/childEnv\.NODE_EXTRA_CA_CERTS = target\.ca\.file;/);
    expect(code).not.toMatch(
      /(childEnv|process\.env|\benv)\.(NODE_TLS_REJECT_UNAUTHORIZED|NODE_OPTIONS)\s*=[^=]/,
    );
    const passedOn = /const CHILD_ENV = \[([\s\S]*?)\];/.exec(code)?.[1] ?? "";
    expect(passedOn).toContain('"PATH"');
    expect(passedOn).not.toMatch(/NODE_|SSL_|PGSSL/);
  });
  it("never prints the connection URL, the password or the personal owners", () => {
    expect(code).not.toMatch(/log\([^)]*connectionUrl/);
    expect(code).not.toMatch(/console\.(log|error)\([^)]*(connectionUrl|PREVIEW_DB_URL|secrets)/);
    expect(code).not.toMatch(/log\([^)]*personalOwners\.join/);
  });
  it("does not change any migration and is not one", () => {
    expect(
      fs
        .readdirSync(path.join(ROOT, "drizzle/migrations"))
        .some((m) => /hosted|client.?preview/i.test(m)),
    ).toBe(false);
    expect(code).not.toMatch(/drizzle\/migrations\/\d/);
  });
});
