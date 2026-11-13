// The ONLY way to run SQL directly on the hosted client-preview database (Supabase Session pooler):
// inspect it, apply the migrations, mark it as the client preview and install the dataset functions.
// Deny by default; there is no override switch. Everything comes from the environment (the operator's
// secrets file), never from the command line:
//
//   PREVIEW_DB_OPERATION=inspect|migrate|mark|functions
//   PREVIEW_API_URL=https://<ref>.supabase.co
//   PREVIEW_DB_URL=postgresql://postgres.<ref>:<password>@aws-<n>-<region>.pooler.supabase.com:5432/postgres
//   PREVIEW_FORBIDDEN_REFS=<ref of production>[,<other hosted projects that must never be touched>]
//   PREVIEW_DB_CA_FILE=<Supabase server root certificate, PEM: Database Settings > SSL Configuration>
//   DQ_PREVIEW_CONFIRM=client-preview:db-<operation>:client-preview:<ref>
//   PREVIEW_PERSONAL_OWNERS=<at most two addresses>            (mark only)
//   node scripts/preview/hosted-db.mjs
//
// Before any connection (assertHostedPreviewDb):
//   1. the operation is one of HOSTED_DB_OPERATIONS;
//   2. the API URL is exactly https://<ref>.supabase.co;
//   3. PREVIEW_FORBIDDEN_REFS is declared (at least the production project) and does not contain <ref>:
//      production is blocked by name even if every other value were copied from it by mistake;
//   4. the operator confirmation names this operation and this project;
//   5. the database URL is the Session pooler of THIS project: host aws-…pooler.supabase.com, port
//      5432 (session mode), database postgres, user postgres.<ref> with the SAME ref as the API URL (the
//      pooler host is shared by many projects; the user name is what selects the project), a real
//      password. Local and private hosts (the QA, the demo, CI: scripts/guard/target-guard.mjs), the
//      direct host, the transaction pooler and any other host are refused;
//   6. TLS is always fully verified (verify-full): the server certificate chain must lead to a CA
//      certificate of PREVIEW_DB_CA_FILE and the certificate must be issued for the pooler host name.
//      The pooler's chain ends in Supabase's own root, which no system trust store contains, so the CA
//      file is required. This session trusts ONLY that file; the drizzle-kit child verifies with
//      sslmode=verify-full and the same file (NODE_EXTRA_CA_CERTS). Encryption without verification
//      (sslmode=require/prefer/allow/disable, NODE_TLS_REJECT_UNAUTHORIZED=0) is refused; there is no
//      switch that turns verification off.
// After connecting (read-only session), the state of the database decides what may run:
//   empty               nothing in public, no migration tracker, no account, no stored object
//   migrated-unmarked   every migration of this repository applied, no marker yet
//   preview             marked for THIS ref by scripts/preview/sql/client-preview-identity.sql
//   anything else       (another project's marker, a local stack, tables without a tracker, a
//                       partial migration, real data) is refused
//   migrate    only on `empty` (first migration) or on `preview` (later migrations)
//   mark       only on `migrated-unmarked` with no real data and no platform role
//   functions  only on `preview`
// Passwords, keys, complete URLs and personal addresses are never printed; database and child-process
// messages are redacted before they reach a log.
import fs from "node:fs";
import path from "node:path";
import tls from "node:tls";
import { X509Certificate } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  assertPreviewConfirmation,
  parsePreviewApiUrl,
  PreviewRefusal,
} from "./preview-target.mjs";
import { parsePersonalOwners, PersonalOwnersError } from "./personal-owners.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REF = /^[a-z0-9]{20}$/;
const POOLER_HOST = /^aws-\d{1,2}-[a-z]{2}(-[a-z]+)+-\d\.pooler\.supabase\.com$/;
const LOCAL_HOST =
  /^(localhost|.*\.localhost|127(\.\d{1,3}){3}|\[?::1\]?|0\.0\.0\.0|10(\.\d{1,3}){3}|192\.168(\.\d{1,3}){2}|172\.(1[6-9]|2\d|3[01])(\.\d{1,3}){2}|host\.docker\.internal)$/;
const BRAND = Symbol("hosted-preview-db");

export const HOSTED_DB_OPERATIONS = Object.freeze([
  "db-inspect:client-preview",
  "db-migrate:client-preview",
  "db-mark:client-preview",
  "db-functions:client-preview",
]);
export const IDENTITY_SQL = "scripts/preview/sql/client-preview-identity.sql";
export const FUNCTIONS_SQL = "scripts/preview/sql/client-preview-functions.sql";

/** Removes every secret (and anything shaped like one) from a text before it is logged. */
export function redact(text, secrets = []) {
  let out = String(text ?? "");
  for (const s of secrets)
    if (typeof s === "string" && s.length >= 4) {
      out = out.split(s).join("<redacted>");
      const enc = encodeURIComponent(s);
      if (enc !== s) out = out.split(enc).join("<redacted>");
    }
  return out
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"'`]+/gi, "<database url>")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "<token>")
    .replace(/\bsb_(secret|publishable)_[A-Za-z0-9_-]{8,}/g, "<key>")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+/g, "<address>");
}

/** PREVIEW_FORBIDDEN_REFS: hosted projects that must never be touched (production at least). */
export function parseForbiddenRefs(raw, ref) {
  const list = String(raw ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!list.length)
    throw new PreviewRefusal(
      "PREVIEW_FORBIDDEN_REFS is required: declare the ref of the production project (and of any other hosted project) so it is blocked by name",
    );
  if (list.some((r) => !REF.test(r)))
    throw new PreviewRefusal("PREVIEW_FORBIDDEN_REFS must hold 20-character project refs only");
  if (list.includes(ref))
    throw new PreviewRefusal(
      "this project is declared as forbidden (PREVIEW_FORBIDDEN_REFS): it is production or another protected project, not the client preview",
    );
  return Object.freeze([...new Set(list)]);
}

/** Validates PREVIEW_DB_URL against the project ref of the API URL. Never echoes the URL. */
export function parseHostedDbUrl(raw, ref) {
  if (!REF.test(String(ref))) throw new PreviewRefusal("invalid project ref");
  let u;
  try {
    u = new URL(String(raw ?? ""));
  } catch {
    throw new PreviewRefusal("missing or unreadable database URL (PREVIEW_DB_URL)");
  }
  if (!/^postgres(?:ql)?:$/.test(u.protocol))
    throw new PreviewRefusal("the database URL must be a PostgreSQL connection URL");
  const host = u.hostname.toLowerCase();
  if (LOCAL_HOST.test(host))
    throw new PreviewRefusal(
      "local or private database host: the QA, the demo and every local stack are never targets of hosted-db (local stacks use scripts/guard/target-guard.mjs)",
    );
  if (/^db\.[a-z0-9]{20}\.supabase\.co$/.test(host))
    throw new PreviewRefusal(
      "direct database host: use the Session pooler connection string (Connect > Session pooler)",
    );
  if (!POOLER_HOST.test(host))
    throw new PreviewRefusal("the database host is not a Supabase Session pooler host");
  if (u.port === "6543")
    throw new PreviewRefusal(
      "transaction pooler (port 6543): use session mode (port 5432) for migrations and SQL files",
    );
  if (u.port !== "5432") throw new PreviewRefusal("the Session pooler port must be 5432");
  let user;
  let password;
  try {
    user = decodeURIComponent(u.username);
    password = decodeURIComponent(u.password);
  } catch {
    throw new PreviewRefusal("unreadable database credentials");
  }
  const m = /^postgres\.([a-z0-9]{20})$/.exec(user);
  if (!m)
    throw new PreviewRefusal(
      "the database user must be postgres.<project ref> (Session pooler user of the project)",
    );
  if (m[1] !== ref)
    throw new PreviewRefusal(
      "the database user belongs to another project than the API URL (the refs must be identical)",
    );
  if (!password) throw new PreviewRefusal("the database URL has no password");
  if (/[<>]|^(senha|password|your-password|\[.*\])$/i.test(password) || password.length < 8)
    throw new PreviewRefusal("the database password is a placeholder or too short");
  if (u.pathname !== "/postgres") throw new PreviewRefusal("the database must be postgres");
  if (u.hash) throw new PreviewRefusal("the database URL must not have a fragment");
  const params = [...u.searchParams.keys()];
  if (params.some((k) => k !== "sslmode"))
    throw new PreviewRefusal("the database URL may only carry sslmode=verify-full");
  if (u.searchParams.has("sslmode") && u.searchParams.get("sslmode") !== "verify-full")
    throw new PreviewRefusal(
      "the database URL asks for TLS without full verification; hosted-db always verifies the certificate and the host name (omit sslmode or use sslmode=verify-full)",
    );
  const base = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:5432/postgres`;
  // sessionUrl: for this process, which passes explicit TLS options (tlsOptions). connectionUrl: for
  // the drizzle-kit child, whose driver reads the mode from the URL.
  const connectionUrl = `${base}?sslmode=verify-full`;
  return {
    ref,
    host,
    user,
    sessionUrl: base,
    connectionUrl,
    secrets: [password, connectionUrl, base, String(raw)],
  };
}

const PEM_CERTIFICATE = /-----BEGIN CERTIFICATE-----[A-Za-z0-9+/=\s]+?-----END CERTIFICATE-----/g;
/**
 * PREVIEW_DB_CA_FILE: the CA certificate(s) the pooler's certificate chain must lead to (Supabase's
 * server root certificate, downloaded from the project's Database Settings). Certificates are public,
 * but the file must hold nothing else. Refuses a missing or unreadable file, anything that is not a
 * certificate, a private key, a certificate that is not a CA, and a CA outside its validity period.
 */
export function loadServerCa(file, now = Date.now()) {
  if (typeof file !== "string" || file.trim() === "")
    throw new PreviewRefusal(
      "PREVIEW_DB_CA_FILE is required: the Supabase server root certificate (Database Settings > SSL Configuration) that the pooler certificate is verified against",
    );
  const abs = path.resolve(file);
  let text;
  try {
    if (fs.statSync(abs).size > 64 * 1024) throw new Error("too large");
    text = fs.readFileSync(abs, "utf8");
  } catch {
    throw new PreviewRefusal(
      "the CA file (PREVIEW_DB_CA_FILE) is missing, unreadable or too large",
    );
  }
  if (/PRIVATE KEY/.test(text))
    throw new PreviewRefusal("the CA file holds a private key; it must hold CA certificates only");
  const blocks = text.match(PEM_CERTIFICATE) ?? [];
  if (text.replace(PEM_CERTIFICATE, "").trim() !== "" || blocks.length < 1 || blocks.length > 4)
    throw new PreviewRefusal("the CA file must hold one to four PEM certificates and nothing else");
  const certs = blocks.map((pem, i) => {
    let cert;
    try {
      cert = new X509Certificate(pem);
    } catch {
      throw new PreviewRefusal(`certificate #${i + 1} of the CA file is not a valid certificate`);
    }
    if (cert.ca !== true)
      throw new PreviewRefusal(
        `certificate #${i + 1} of the CA file is not a CA certificate (a server certificate cannot be the trust anchor)`,
      );
    if (now < Date.parse(cert.validFrom) || now > Date.parse(cert.validTo))
      throw new PreviewRefusal(`CA certificate #${i + 1} is outside its validity period`);
    return Object.freeze({
      subject: cert.subject.replace(/\s*\n\s*/g, ", "),
      sha256: cert.fingerprint256,
      validTo: new Date(cert.validTo).toISOString().slice(0, 10),
    });
  });
  return Object.freeze({ file: abs, pem: blocks.join("\n"), certs: Object.freeze(certs) });
}

/**
 * TLS options of the session: chain verified against the operator's CA file only, certificate
 * identity verified against the pooler host name. Never built with verification off.
 */
export function tlsOptions(target) {
  assertHostedDbTarget(target);
  return Object.freeze({
    ca: target.ca.pem,
    rejectUnauthorized: true,
    servername: target.host,
    checkServerIdentity: tls.checkServerIdentity,
    minVersion: "TLSv1.2",
  });
}

/**
 * Every offline check. Returns a branded target; nothing else is accepted by the functions that
 * connect or spawn. `env` is the process environment (or a test double).
 */
export function assertHostedPreviewDb(env, operation) {
  if (!HOSTED_DB_OPERATIONS.includes(operation))
    throw new PreviewRefusal(
      `unknown database operation (allowed: ${HOSTED_DB_OPERATIONS.join(", ")})`,
    );
  const { ref } = parsePreviewApiUrl(env.PREVIEW_API_URL);
  const forbidden = parseForbiddenRefs(env.PREVIEW_FORBIDDEN_REFS, ref);
  assertPreviewConfirmation(operation, ref, env.DQ_PREVIEW_CONFIRM);
  const db = parseHostedDbUrl(env.PREVIEW_DB_URL, ref);
  if (String(env.NODE_TLS_REJECT_UNAUTHORIZED ?? "").trim() === "0")
    throw new PreviewRefusal(
      "NODE_TLS_REJECT_UNAUTHORIZED=0 is set: certificate verification must never be turned off",
    );
  const ca = loadServerCa(env.PREVIEW_DB_CA_FILE);
  let personalOwners = null;
  if (operation === "db-mark:client-preview") {
    if (typeof env.PREVIEW_PERSONAL_OWNERS !== "string")
      throw new PreviewRefusal(
        "PREVIEW_PERSONAL_OWNERS must be declared before marking (the list is fixed for good)",
      );
    try {
      personalOwners = parsePersonalOwners(env.PREVIEW_PERSONAL_OWNERS, { mode: "hosted" });
    } catch (e) {
      throw new PreviewRefusal(
        e instanceof PersonalOwnersError ? e.message : "invalid personal owners",
      );
    }
  }
  return Object.freeze({
    [BRAND]: true,
    operation,
    ref,
    host: db.host,
    sessionUrl: db.sessionUrl,
    connectionUrl: db.connectionUrl,
    ca,
    forbidden,
    personalOwners,
    secrets: Object.freeze([...db.secrets, ...(personalOwners ?? [])]),
  });
}

export function assertHostedDbTarget(target) {
  if (!target || target[BRAND] !== true || !HOSTED_DB_OPERATIONS.includes(target.operation))
    throw new PreviewRefusal("not a database target checked by assertHostedPreviewDb");
}

// ---------------------------------------------------------------------------------- inspection
const CATALOG_SQL = `
  select current_user as usr, current_database() as db,
    current_setting('server_version_num')::int as version_num,
    (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p','v','m','f','S')) as public_relations,
    (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')) as public_functions,
    to_regclass('drizzle.__drizzle_migrations') is not null as has_tracker,
    to_regnamespace('dq_guard') is not null as has_local_guard,
    to_regnamespace('dq_preview') is not null as has_preview_schema,
    to_regclass('dq_preview.marker') is not null as has_marker,
    to_regclass('dq_preview.personal_accounts') is not null as has_personal,
    to_regclass('auth.users') is not null as has_auth,
    to_regclass('storage.objects') is not null as has_storage,
    to_regclass('public.organizations') is not null as has_orgs,
    to_regclass('public.user_roles') is not null as has_roles`;
const TEST_DOMAIN = `'\\.(test|example|invalid|localhost)$'`;

/** Reads the facts that classify the database. Read-only queries; `db.query(text)` returns rows. */
export async function inspectDatabase(db) {
  const one = async (text) => (await db.query(text))[0] ?? {};
  const c = await one(CATALOG_SQL);
  const facts = {
    user: c.usr,
    database: c.db,
    versionNum: c.version_num,
    publicRelations: c.public_relations,
    publicFunctions: c.public_functions,
    hasTracker: c.has_tracker === true,
    hasLocalGuard: c.has_local_guard === true,
    hasPreviewSchema: c.has_preview_schema === true,
    hasAuth: c.has_auth === true,
    trackerRows: null,
    marker: null,
    users: null,
    nonTestUsers: null,
    storedObjects: null,
    organizations: null,
    nonDemoOrganizations: null,
    platformRoles: null,
  };
  if (facts.hasTracker)
    facts.trackerRows = (
      await one("select count(*)::int as n from drizzle.__drizzle_migrations")
    ).n;
  if (c.has_marker === true) {
    const rows = await db.query("select label, project_ref from dq_preview.marker");
    facts.marker =
      rows.length === 1
        ? { label: rows[0].label, ref: rows[0].project_ref }
        : { label: null, ref: null };
  }
  if (facts.hasAuth) {
    const outside =
      c.has_personal === true
        ? " and lower(coalesce(email, '')) not in (select email from dq_preview.personal_accounts)"
        : "";
    const u = await one(
      `select count(*)::int as users, (count(*) filter (where (email is null or lower(email) !~ ${TEST_DOMAIN})${outside}))::int as non_test from auth.users`,
    );
    facts.users = u.users;
    facts.nonTestUsers = u.non_test;
  }
  if (c.has_storage === true)
    facts.storedObjects = (await one("select count(*)::int as n from storage.objects")).n;
  if (c.has_orgs === true) {
    const o = await one(
      "select count(*)::int as total, (count(*) filter (where not is_demo))::int as non_demo from public.organizations",
    );
    facts.organizations = o.total;
    facts.nonDemoOrganizations = o.non_demo;
  }
  if (c.has_roles === true)
    facts.platformRoles = (await one("select count(*)::int as n from public.user_roles")).n;
  return facts;
}

export function journalEntries(root = ROOT) {
  return JSON.parse(
    fs.readFileSync(path.join(root, "drizzle/migrations/meta/_journal.json"), "utf8"),
  ).entries.length;
}

/** Classifies the facts: { kind, reason }. `journal` = migrations of this repository. */
export function classifyState(facts, ref, journal) {
  const realData =
    (facts.nonDemoOrganizations ?? 0) > 0 ||
    (facts.nonTestUsers ?? 0) > 0 ||
    (facts.platformRoles ?? 0) > 0;
  if (facts.user !== "postgres" || facts.database !== "postgres")
    return { kind: "unknown", reason: "unexpected session (user or database)" };
  if (!facts.hasAuth)
    return { kind: "unknown", reason: "not a Supabase project database (no auth schema)" };
  if (facts.hasLocalGuard)
    return { kind: "local-stack", reason: "a local disposable stack (dq_guard)" };
  if (facts.hasPreviewSchema) {
    if (!facts.marker || facts.marker.label !== "client-preview")
      return { kind: "unknown", reason: "a preview schema without a valid marker" };
    if (facts.marker.ref !== ref)
      return {
        kind: "foreign",
        reason: "marked for another project (a copied or restored database)",
      };
    if (realData)
      return { kind: "unknown", reason: "the marked database holds real data or a platform role" };
    if (facts.trackerRows !== journal && !(facts.trackerRows < journal))
      return { kind: "unknown", reason: "more migrations applied than this repository has" };
    return { kind: "preview", reason: "marked as the client preview for this project" };
  }
  if (facts.hasTracker) {
    if (facts.trackerRows !== journal)
      return {
        kind: "unknown",
        reason: `partial or foreign migration history (${facts.trackerRows}/${journal})`,
      };
    if (realData)
      return { kind: "unknown", reason: "migrated database with real data or a platform role" };
    if ((facts.users ?? 0) > 0 || (facts.organizations ?? 0) > 0)
      return {
        kind: "unknown",
        reason: "migrated database that already holds accounts or organizations",
      };
    return {
      kind: "migrated-unmarked",
      reason: `every migration applied (${journal}/${journal}), not marked yet`,
    };
  }
  if (
    facts.publicRelations === 0 &&
    facts.publicFunctions === 0 &&
    facts.users === 0 &&
    (facts.storedObjects ?? 0) === 0
  )
    return { kind: "empty", reason: "new and empty" };
  return { kind: "unknown", reason: "not empty and without this repository's migration tracker" };
}

const ALLOWED = Object.freeze({
  "db-inspect:client-preview": null,
  "db-migrate:client-preview": ["empty", "preview"],
  "db-mark:client-preview": ["migrated-unmarked"],
  "db-functions:client-preview": ["preview"],
});
/** Refuses the operation unless the database is in a state that allows it. */
export function assertStateAllows(operation, state) {
  const allowed = ALLOWED[operation];
  if (allowed === undefined) throw new PreviewRefusal("unknown database operation");
  if (allowed === null) return;
  if (!allowed.includes(state.kind))
    throw new PreviewRefusal(
      `${operation.split(":")[0]} is refused: the database is ${state.kind} (${state.reason}); it needs ${allowed.join(" or ")}`,
    );
}

// ------------------------------------------------------------------------------------ SQL files
const sqlLiteral = (value) => `'${String(value).replace(/'/g, "''")}'`;
/**
 * Renders a psql script for a plain multi-statement execution: `\set ON_ERROR_STOP on` is dropped
 * (one batch already stops at the first error and the open transaction is rolled back), `:'name'` is
 * replaced by the quoted value. Any other psql meta-command or variable is refused.
 */
export function renderSqlFile(text, vars = {}) {
  const lines = String(text).split(/\r?\n/);
  const kept = [];
  for (const line of lines) {
    if (/^\s*\\/.test(line)) {
      if (!/^\s*\\set ON_ERROR_STOP on\s*$/.test(line))
        throw new PreviewRefusal("the SQL file uses a psql meta-command hosted-db does not run");
      continue;
    }
    kept.push(line);
  }
  for (const [name, value] of Object.entries(vars)) {
    if (!/^[a-z_]+$/.test(name)) throw new PreviewRefusal("invalid SQL variable name");
    if (typeof value !== "string" || /[\\\0\n\r]/.test(value))
      throw new PreviewRefusal(`invalid value for the SQL variable ${name}`);
  }
  const used = new Set();
  const out = kept.join("\n").replace(/:'([a-z_]+)'/g, (_all, name) => {
    if (!(name in vars)) throw new PreviewRefusal(`the SQL file needs the variable ${name}`);
    used.add(name);
    return sqlLiteral(vars[name]);
  });
  for (const name of Object.keys(vars))
    if (!used.has(name)) throw new PreviewRefusal(`the SQL file does not use the variable ${name}`);
  return out;
}

// ------------------------------------------------------------------------------------ execution
const CHILD_ENV = [
  "PATH",
  "Path",
  "SYSTEMROOT",
  "SystemRoot",
  "TEMP",
  "TMP",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
];

/** Applies the migrations with the same tool as every other environment (drizzle-kit migrate). */
export function runMigrations(
  target,
  { spawn = spawnSync, log = console.log, root = ROOT, env = process.env } = {},
) {
  assertHostedDbTarget(target);
  if (target.operation !== "db-migrate:client-preview")
    throw new PreviewRefusal("the target was not checked for db-migrate");
  const childEnv = Object.fromEntries(
    CHILD_ENV.filter((k) => env[k] !== undefined).map((k) => [k, env[k]]),
  );
  if (!target.connectionUrl.endsWith("?sslmode=verify-full"))
    throw new PreviewRefusal("the migration connection must use sslmode=verify-full");
  childEnv.LOVABLE_DB_MIGRATION_URL = target.connectionUrl;
  // The child's driver verifies the chain and the host name (verify-full) with Node's trust store
  // plus the operator's CA file. NODE_TLS_REJECT_UNAUTHORIZED and NODE_OPTIONS are never passed on.
  childEnv.NODE_EXTRA_CA_CERTS = target.ca.file;
  // The repository's migration gate (drizzle.config.ts) asks for the host by name; it is given only
  // here, after every check of this file.
  childEnv.DQ_GUARD_CONFIRM = `migrate:remote:${target.host}`;
  const res = spawn(
    process.execPath,
    [path.join(root, "node_modules/drizzle-kit/bin.cjs"), "migrate"],
    {
      cwd: root,
      env: childEnv,
      encoding: "utf8",
      timeout: 15 * 60_000,
    },
  );
  const output = redact(`${res.stdout ?? ""}\n${res.stderr ?? ""}`, target.secrets)
    .replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")
    .split(/[\r\n]+/)
    .map((l) => l.trim())
    .filter((l) => /applied|error|refused|fail/i.test(l));
  for (const line of [...new Set(output)].slice(-12)) log(`  drizzle-kit: ${line.slice(0, 300)}`);
  if (res.error || res.status !== 0)
    throw new PreviewRefusal(
      `drizzle-kit migrate failed (exit ${res.status ?? "none"}); nothing else was run`,
    );
}

// Node's certificate-verification failures (chain, validity, host name).
const TLS_FAILURE =
  /^(ERR_TLS_|CERT_|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_|HOSTNAME_MISMATCH|INVALID_CA|INVALID_PURPOSE)/;

/** Opens the single session used for inspection and SQL files. */
export async function connectHostedDb(target) {
  assertHostedDbTarget(target);
  const sql = postgres(target.sessionUrl, {
    max: 1,
    // Full verification (chain to the operator's CA file + host name); see tlsOptions.
    ssl: tlsOptions(target),
    prepare: false,
    connect_timeout: 15,
    idle_timeout: 5,
    onnotice: () => {},
    connection: { application_name: "dinequora-client-preview-ops", statement_timeout: 180_000 },
  });
  return {
    query: async (text) => {
      try {
        return await sql.unsafe(text);
      } catch (e) {
        if (TLS_FAILURE.test(String(e?.code ?? "")))
          throw new PreviewRefusal(
            `TLS verification failed (${e.code}): the server certificate does not lead to a CA of PREVIEW_DB_CA_FILE or was not issued for the pooler host; nothing was sent to the server`,
          );
        throw new PreviewRefusal(
          `database error: ${redact(`${e?.code ?? ""} ${e?.message ?? e}`, target.secrets).slice(0, 300)}`,
        );
      }
    },
    end: () =>
      Promise.race([
        sql.end({ timeout: 2 }).catch(() => {}),
        new Promise((r) => setTimeout(r, 4000).unref()),
      ]),
  };
}

export function describeState(facts, state, journal) {
  const n = (v) => (v === null || v === undefined ? "n/a" : String(v));
  return [
    `state: ${state.kind} (${state.reason})`,
    `postgres ${Math.floor((facts.versionNum ?? 0) / 10000)}; public objects: ${n(facts.publicRelations)} relations, ${n(facts.publicFunctions)} functions`,
    `migrations applied: ${facts.hasTracker ? `${n(facts.trackerRows)}/${journal}` : "none"}`,
    `accounts: ${n(facts.users)} (outside the test domains and the fixed personal owners: ${n(facts.nonTestUsers)}); organizations: ${n(facts.organizations)} (non-demo: ${n(facts.nonDemoOrganizations)}); platform roles: ${n(facts.platformRoles)}`,
  ];
}

/**
 * Runs one operation on a checked target. `db` and `spawn` are injectable for tests; by default the
 * real Session pooler connection and drizzle-kit are used.
 */
export async function runHostedDb(target, { db, spawn, log = console.log, root = ROOT } = {}) {
  assertHostedDbTarget(target);
  const journal = journalEntries(root);
  const session = db ?? (await connectHostedDb(target));
  const read = async () => {
    const facts = await inspectDatabase(session);
    return { facts, state: classifyState(facts, target.ref, journal) };
  };
  try {
    // Inspection never writes: the session is read-only until a checked SQL file has to run.
    await session.query("set default_transaction_read_only = on");
    let { facts, state } = await read();
    for (const line of describeState(facts, state, journal)) log(line);
    assertStateAllows(target.operation, state);
    if (target.operation === "db-inspect:client-preview") return state;

    if (target.operation === "db-migrate:client-preview") {
      log(
        `applying ${journal} migration(s) with drizzle-kit (from ${facts.trackerRows ?? 0} applied)`,
      );
      runMigrations(target, { ...(spawn ? { spawn } : {}), log, root });
      ({ facts, state } = await read());
      if (facts.trackerRows !== journal)
        throw new PreviewRefusal(
          `after the migration the tracker has ${facts.trackerRows}/${journal} rows`,
        );
      for (const line of describeState(facts, state, journal)) log(line);
      return state;
    }

    const file = target.operation === "db-mark:client-preview" ? IDENTITY_SQL : FUNCTIONS_SQL;
    const vars =
      target.operation === "db-mark:client-preview"
        ? { project_ref: target.ref, personal_owners: target.personalOwners.join(",") }
        : {};
    const text = renderSqlFile(fs.readFileSync(path.join(root, file), "utf8"), vars);
    if (target.operation === "db-mark:client-preview")
      log(
        `marking project ${target.ref} as the client preview with ${target.personalOwners.length} personal owner(s) fixed`,
      );
    await session.query("set default_transaction_read_only = off");
    await session.query(text);
    await session.query("notify pgrst, 'reload schema'");
    await session.query("set default_transaction_read_only = on");
    ({ facts, state } = await read());
    if (state.kind !== "preview")
      throw new PreviewRefusal(`after ${file} the database is ${state.kind} (${state.reason})`);
    for (const line of describeState(facts, state, journal)) log(line);
    return state;
  } finally {
    await session.end?.();
  }
}

/** What the connection will be verified against (public information: subjects and fingerprints). */
export function describeTls(target) {
  assertHostedDbTarget(target);
  return [
    `TLS: verify-full — certificate chain verified against ${target.ca.certs.length} CA certificate(s) of PREVIEW_DB_CA_FILE, identity verified against the pooler host name`,
    ...target.ca.certs.map(
      (c) => `  CA: ${c.subject} (valid until ${c.validTo}, sha256 ${c.sha256})`,
    ),
  ];
}

async function main(env) {
  const name = String(env.PREVIEW_DB_OPERATION ?? "");
  const operation = `db-${name}:client-preview`;
  const target = assertHostedPreviewDb(env, operation);
  console.log(
    `hosted-db: ${operation} accepted for project ${target.ref} (Session pooler); connecting`,
  );
  for (const line of describeTls(target)) console.log(line);
  await runHostedDb(target);
  console.log(`hosted-db: ${operation} finished for project ${target.ref}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main(process.env).catch((e) => {
    if (e instanceof PreviewRefusal) {
      console.error(e.message);
      process.exit(3);
    }
    console.error(`hosted-db failed: ${redact(e?.message ?? e).slice(0, 300)}`);
    process.exit(1);
  });
