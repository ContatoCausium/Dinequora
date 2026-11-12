// Target guard for every script that writes to a database (tests, seeds, fixtures, migrations).
//
// Deny by default. A database is DISPOSABLE only when it carries a valid marker (dq_guard.marker)
// bound to the identity of the cluster AND of the database it is in:
//   * the marker is created only by `claim` on a database that is new and empty (no migration
//     tracker, no table in public, no user), or by `adopt` with a confirmation that names this exact
//     cluster (for a restored copy, e.g. a copy of the QA used for a rehearsal);
//   * it stores the cluster's system_identifier and the database OID. A dump restored anywhere else
//     (another cluster, or another database of the same cluster) carries a marker that no longer
//     matches, so a restored copy is NEVER disposable by accident;
//   * clusters listed in protected-clusters.json (the persistent QA, the demo) can never be claimed
//     or adopted, even if a marker were forged;
//   * only loopback hosts are accepted; remote (hosted) databases are refused before connecting;
//   * ports, project ids and environment variables are never trusted: there is no override switch.
//
// The check is made through the channel the caller writes with: dq_guard.attest() in SQL (fixtures,
// psql), a direct connection (scripts using postgres.js), or the API: the CI/test stack exposes the
// dq_guard schema (created empty by its seed) and claim grants dq_guard.attest() to the service role
// only, so an API key of a stack that is not disposable (or of the persistent QA) cannot pass.
// Identifiers are logged only as the first 12 hex digits of sha256('dinequora-cluster:' + id);
// URLs are logged without credentials. Missing information, a failed connection or an unexpected
// answer are refusals.
//
// CLI (exit 0 = allowed, 3 = refused, 2 = usage):
//   node scripts/guard/target-guard.mjs identity  --db-url URL
//   node scripts/guard/target-guard.mjs check     --db-url URL --operation OP
//   SB_SERVICE=… node scripts/guard/target-guard.mjs check-api --api-url URL --operation OP
//   node scripts/guard/target-guard.mjs claim     --db-url URL
//   node scripts/guard/target-guard.mjs adopt     --db-url URL --confirm adopt:<cluster>
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OPERATION = /^[a-z][a-z0-9:._-]{2,80}$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

export class GuardRefusal extends Error {
  constructor(message) {
    super(`refused by the target guard: ${message}`);
    this.name = "GuardRefusal";
  }
}

/** For scripts: a refusal ends the process with exit 3 and its message only (no stack trace). */
export function exitOnRefusal(e) {
  if (e instanceof GuardRefusal) {
    console.error(e.message);
    process.exit(3);
  }
  throw e;
}

export function clusterHash(systemIdentifier) {
  return crypto.createHash("sha256").update(`dinequora-cluster:${systemIdentifier}`).digest("hex");
}
export const short = (hash) => String(hash).slice(0, 12);

export function protectedClusters() {
  const file = path.join(HERE, "protected-clusters.json");
  const list = JSON.parse(fs.readFileSync(file, "utf8")).clusters;
  if (!Array.isArray(list) || list.length === 0)
    throw new GuardRefusal("protected cluster list unreadable");
  for (const c of list)
    if (!/^[0-9a-f]{64}$/.test(c.hash ?? ""))
      throw new GuardRefusal("protected cluster list malformed");
  return list;
}
export function protectedLabel(hash) {
  return protectedClusters().find((c) => c.hash === hash)?.label ?? null;
}

function assertOperation(operation) {
  if (!OPERATION.test(operation ?? "")) throw new GuardRefusal(`invalid or missing operation name`);
}

/** host:port/db without credentials; throws on anything that is not a loopback postgres URL. */
export function describeDbUrl(dbUrl) {
  let u;
  try {
    u = new URL(dbUrl ?? "");
  } catch {
    throw new GuardRefusal("missing or unreadable database URL");
  }
  if (!/^postgres(ql)?:$/.test(u.protocol)) throw new GuardRefusal("not a postgres URL");
  if (!LOOPBACK.has(u.hostname))
    throw new GuardRefusal(
      `remote database host ${u.hostname} (only local disposable stacks are allowed)`,
    );
  const db = decodeURIComponent(u.pathname.replace(/^\//, "")) || "postgres";
  return { where: `${u.hostname}:${u.port || 5432}/${db}`, url: u };
}
export function describeApiUrl(apiUrl) {
  let u;
  try {
    u = new URL(apiUrl ?? "");
  } catch {
    throw new GuardRefusal("missing or unreadable API URL");
  }
  if (!/^https?:$/.test(u.protocol)) throw new GuardRefusal("not an http(s) URL");
  if (!LOOPBACK.has(u.hostname))
    throw new GuardRefusal(
      `remote API host ${u.hostname} (only local disposable stacks are allowed)`,
    );
  return `${u.hostname}:${u.port || (u.protocol === "https:" ? 443 : 80)}`;
}

// auth.users rows that are not test accounts: no e-mail, or a domain outside the reserved test TLDs.
const NON_TEST_USER = `(email is null or lower(email) !~ '\\.(test|example|invalid|localhost)$')`;

const IDENTITY_SQL = `
  select (select system_identifier::text from pg_control_system()) as sysid,
         (select oid::text from pg_database where datname = current_database()) as datoid,
         current_database() as db,
         to_regclass('dq_guard.marker') is not null as has_marker,
         to_regclass('drizzle.__drizzle_migrations') is not null as has_tracker,
         (select count(*)::int from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r','p','v','m','f')) as public_relations`;

async function readIdentity(sql) {
  const [id] = await sql.unsafe(IDENTITY_SQL);
  if (!id?.sysid || !id?.datoid) throw new GuardRefusal("the database did not report its identity");
  const [{ has_users }] = await sql.unsafe(
    `select to_regclass('auth.users') is not null as has_users`,
  );
  const users = has_users
    ? (await sql.unsafe(`select count(*)::int as n from auth.users`))[0].n
    : 0;
  // Users outside the reserved test domains (RFC 2606/6761: .test .example .invalid .localhost).
  const realUsers = has_users
    ? (await sql.unsafe(`select count(*)::int as n from auth.users where ${NON_TEST_USER}`))[0].n
    : 0;
  let marker = null;
  if (id.has_marker) {
    const rows = await sql.unsafe(
      `select system_identifier, database_oid::text as database_oid, purpose from dq_guard.marker`,
    );
    marker = rows.length === 1 ? rows[0] : { invalid: `${rows.length} marker rows` };
  }
  const hash = clusterHash(id.sysid);
  const bound = Boolean(
    marker && marker.system_identifier === id.sysid && marker.database_oid === id.datoid,
  );
  // A database claimed as new and empty that later receives real people is in persistent use now
  // (e.g. a test stack kept as a staging or QA environment): it stops being disposable. Explicitly
  // adopted copies are not affected (the operator accepted their data).
  const outgrown = bound && marker.purpose === "new-empty" && realUsers > 0;
  const markerValid = bound && !outgrown;
  return {
    hash,
    cluster: short(hash),
    db: id.db,
    protected: protectedLabel(hash),
    marker: marker
      ? markerValid
        ? marker.purpose
        : outgrown
          ? `no longer disposable (${realUsers} user(s) outside the test domains)`
          : "invalid (copied from another cluster or database)"
      : null,
    markerValid,
    realUsers,
    empty: !id.has_tracker && id.public_relations === 0 && users === 0,
    hasTracker: id.has_tracker,
    publicRelations: id.public_relations,
    users,
    sysid: id.sysid, // never printed
    datoid: id.datoid,
  };
}

export function classify(identity) {
  if (identity.protected) return `protected:${identity.protected}`;
  if (identity.markerValid) return "disposable";
  return "unregistered";
}

const ANSWER_TIMEOUT_MS = 20_000;

async function withConnection(dbUrl, fn) {
  const { where } = describeDbUrl(dbUrl);
  const sql = postgres(dbUrl, { max: 1, connect_timeout: 5, idle_timeout: 1, onnotice: () => {} });
  let timer;
  // A server that accepts and then resets or never answers is a refusal, never a hang.
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new GuardRefusal(`no answer from ${where} within ${ANSWER_TIMEOUT_MS / 1000} s`)),
      ANSWER_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([fn(sql, where), deadline]);
  } catch (e) {
    if (e instanceof GuardRefusal) throw e;
    throw new GuardRefusal(
      `cannot verify ${where}: ${String(e?.code ?? e?.message ?? e).slice(0, 120)}`,
    );
  } finally {
    clearTimeout(timer);
    await Promise.race([
      sql.end({ timeout: 1 }).catch(() => {}),
      new Promise((r) => setTimeout(r, 2000).unref()),
    ]);
  }
}

/** Read-only identity of a local database (for the ops wrappers and diagnostics). */
export async function identity(dbUrl) {
  return withConnection(dbUrl, async (sql, where) => {
    const id = await sql.begin("read only", (tx) => readIdentity(tx));
    return { ...id, where, class: classify(id) };
  });
}

/**
 * Refuses unless dbUrl is a local DISPOSABLE database (valid marker, not protected). Returns the
 * short cluster id. `newEmpty: true` additionally requires the marker made by `claim`.
 */
export async function assertDisposableDb(dbUrl, operation, { newEmpty = false } = {}) {
  assertOperation(operation);
  const id = await identity(dbUrl);
  if (id.protected)
    throw new GuardRefusal(`${id.where} is the protected ${id.protected} cluster (${id.cluster})`);
  if (!id.markerValid)
    throw new GuardRefusal(
      `${id.where} (cluster ${id.cluster}) is not a disposable database: ${id.marker ?? "no marker"}. ` +
        "Only a new, empty stack claimed with `target-guard.mjs claim` (or a copy adopted explicitly) is accepted.",
    );
  if (newEmpty && id.marker !== "new-empty")
    throw new GuardRefusal(`${id.where} is an adopted copy, not a new database (${operation})`);
  return id.cluster;
}

/** Same through the API the caller writes with (service key): PostgREST answers for ITS database. */
export async function assertDisposableApi(apiUrl, serviceKey, operation) {
  assertOperation(operation);
  const where = describeApiUrl(apiUrl);
  if (!serviceKey) throw new GuardRefusal("missing service key for the API check");
  let res;
  try {
    res = await fetch(`${apiUrl.replace(/\/$/, "")}/rest/v1/rpc/attest`, {
      method: "POST",
      headers: {
        apikey: serviceKey,
        authorization: `Bearer ${serviceKey}`,
        "content-type": "application/json",
        "content-profile": "dq_guard",
        "accept-profile": "dq_guard",
      },
      body: JSON.stringify({ _operation: operation }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    throw new GuardRefusal(
      `cannot reach the API at ${where}: ${String(e?.cause?.code ?? e?.name ?? e).slice(0, 80)}`,
    );
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body || typeof body.cluster_hash !== "string")
    throw new GuardRefusal(
      `the API at ${where} is not backed by a disposable database (${res.status} ${String(body?.message ?? body?.code ?? "").slice(0, 120)})`,
    );
  const label = protectedLabel(body.cluster_hash);
  if (label)
    throw new GuardRefusal(`the API at ${where} is backed by the protected ${label} cluster`);
  return short(body.cluster_hash);
}

const quote = (s) => `'${String(s).replace(/'/g, "''")}'`;

function guardObjectsSql(purpose, sysid, datoid) {
  const hashes = protectedClusters()
    .map((c) => quote(c.hash))
    .join(",");
  return `
    create schema if not exists dq_guard;
    revoke all on schema dq_guard from public;
    create table if not exists dq_guard.marker (
      singleton boolean primary key default true check (singleton),
      system_identifier text not null,
      database_oid oid not null,
      purpose text not null check (purpose in ('new-empty', 'adopted-copy')),
      created_at timestamptz not null default now());
    revoke all on dq_guard.marker from public;
    delete from dq_guard.marker;
    insert into dq_guard.marker(system_identifier, database_oid, purpose) values (${quote(sysid)}, ${quote(datoid)}::oid, ${quote(purpose)});
    create or replace function dq_guard.attest(_operation text) returns jsonb
      language plpgsql stable security definer set search_path = pg_catalog as $fn$
    declare m record; sys text := (select system_identifier::text from pg_control_system()); h text; real_users bigint := 0;
    begin
      select * into m from dq_guard.marker;
      if m is null or m.system_identifier <> sys or m.database_oid <> (select oid from pg_database where datname = current_database()) then
        raise exception 'refused by the target guard: not a disposable database (marker missing, or copied from another cluster or database)';
      end if;
      if m.purpose = 'new-empty' and to_regclass('auth.users') is not null then
        execute 'select count(*) from auth.users where ${NON_TEST_USER.replace(/'/g, "''")}' into real_users;
        if real_users > 0 then
          raise exception 'refused by the target guard: no longer disposable (it holds users outside the test domains)';
        end if;
      end if;
      h := encode(sha256(convert_to('dinequora-cluster:' || sys, 'UTF8')), 'hex');
      if h = any(array[${hashes}]) then raise exception 'refused by the target guard: protected cluster'; end if;
      if coalesce(_operation, '') !~ '^[a-z][a-z0-9:._-]{2,80}$' then raise exception 'refused by the target guard: invalid operation'; end if;
      return jsonb_build_object('cluster_hash', h, 'purpose', m.purpose, 'operation', _operation);
    end $fn$;
    revoke all on function dq_guard.attest(text) from public;
    -- API: the CI/test stack config exposes the dq_guard schema; only the service role may call attest.
    do $do$ begin
      if exists (select 1 from pg_roles where rolname = 'service_role') then
        execute 'grant usage on schema dq_guard to service_role';
        execute 'grant execute on function dq_guard.attest(text) to service_role';
      end if;
    end $do$;
    notify pgrst, 'reload schema';`;
}

/** Marks a NEW, EMPTY local database as disposable (idempotent while it stays empty). */
export async function claim(dbUrl) {
  return withConnection(dbUrl, async (sql, where) =>
    sql.begin(async (tx) => {
      await tx.unsafe(`select pg_advisory_xact_lock(hashtext('dq_guard.claim'))`);
      const id = await readIdentity(tx);
      if (id.protected)
        throw new GuardRefusal(`${where} is the protected ${id.protected} cluster (${id.cluster})`);
      if (id.markerValid && id.marker === "new-empty" && id.empty)
        return { where, cluster: id.cluster, already: true };
      if (!id.empty)
        throw new GuardRefusal(
          `${where} (cluster ${id.cluster}) is not new and empty (migration tracker: ${id.hasTracker}, public relations: ${id.publicRelations}, users: ${id.users})`,
        );
      await tx.unsafe(guardObjectsSql("new-empty", id.sysid, id.datoid));
      return { where, cluster: id.cluster, already: false };
    }),
  );
}

/** Explicitly accepts a local copy (e.g. a restored QA backup) as disposable: confirm adopt:<cluster>. */
export async function adopt(dbUrl, confirm) {
  return withConnection(dbUrl, async (sql, where) =>
    sql.begin(async (tx) => {
      await tx.unsafe(`select pg_advisory_xact_lock(hashtext('dq_guard.claim'))`);
      const id = await readIdentity(tx);
      if (id.protected)
        throw new GuardRefusal(
          `${where} is the protected ${id.protected} cluster (${id.cluster}); it can never be adopted`,
        );
      if (confirm !== `adopt:${id.cluster}`)
        throw new GuardRefusal(
          `adopting ${where} needs --confirm adopt:${id.cluster} (this cluster's id), got ${confirm ? "a different value" : "nothing"}`,
        );
      await tx.unsafe(guardObjectsSql("adopted-copy", id.sysid, id.datoid));
      return { where, cluster: id.cluster };
    }),
  );
}

/**
 * Gate for EVERY migration run (drizzle.config.ts calls it, so `npx drizzle-kit …` cannot skip it):
 *   * no URL: nothing to protect (generate/check do not connect);
 *   * disposable local database: allowed;
 *   * protected or unregistered local database: needs DQ_GUARD_CONFIRM=migrate:<class>:<cluster>, which
 *     scripts/ops/db-ops.mjs sets only after its own checks (backup of this cluster, no client, …);
 *   * remote (hosted, e.g. production): needs DQ_GUARD_CONFIRM=migrate:remote:<host> (release runbook).
 * The expected code is not printed: whoever runs drizzle-kit by hand is sent to db-ops.
 */
export async function migrationGate(dbUrl, confirm) {
  if (!dbUrl) return "no database URL (nothing to protect)";
  let u;
  try {
    u = new URL(dbUrl);
  } catch {
    throw new GuardRefusal("unreadable migration URL");
  }
  if (!LOOPBACK.has(u.hostname)) {
    if (confirm !== `migrate:remote:${u.hostname}`)
      throw new GuardRefusal(
        `migrations on the remote host ${u.hostname} need the release confirmation for that host (docs/operations/production-environment.md)`,
      );
    return `remote host ${u.hostname}: confirmed`;
  }
  const id = await identity(dbUrl);
  if (id.class === "disposable") return `disposable cluster ${id.cluster}`;
  const label = id.protected ?? "unregistered";
  if (confirm !== `migrate:${label}:${id.cluster}`)
    throw new GuardRefusal(
      `migrations on the ${label} cluster ${id.cluster} run only through scripts/ops/db-ops.mjs migrate (backup and preconditions first)`,
    );
  return `${label} cluster ${id.cluster}: confirmed`;
}

// ------------------------------------------------------------------------------------------ CLI
function args(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--"))
      out[a.slice(2)] = argv[i + 1]?.startsWith("--") ? "" : (argv[++i] ?? "");
    else out._.push(a);
  }
  return out;
}

async function main(argv) {
  const a = args(argv);
  const cmd = a._[0];
  try {
    if (cmd === "identity") {
      const id = await identity(a["db-url"]);
      console.log(
        JSON.stringify({
          where: id.where,
          class: id.class,
          cluster: id.cluster,
          marker: id.marker,
          empty: id.empty,
        }),
      );
    } else if (cmd === "check") {
      console.log(
        `allowed: ${a.operation} on disposable cluster ${await assertDisposableDb(a["db-url"], a.operation, { newEmpty: a["new-empty"] !== undefined })}`,
      );
    } else if (cmd === "check-api") {
      console.log(
        `allowed: ${a.operation} through the API of disposable cluster ${await assertDisposableApi(a["api-url"], process.env.SB_SERVICE, a.operation)}`,
      );
    } else if (cmd === "claim") {
      const r = await claim(a["db-url"]);
      console.log(
        `${r.already ? "already claimed" : "claimed"}: ${r.where} is a new, empty disposable database (cluster ${r.cluster})`,
      );
    } else if (cmd === "adopt") {
      const r = await adopt(a["db-url"], a.confirm);
      console.log(`adopted: ${r.where} is a disposable copy (cluster ${r.cluster})`);
    } else if (cmd === "migrate-gate") {
      // URL and confirmation from the environment (never on the command line, where the password
      // would be visible to other processes)
      const r = await migrationGate(
        process.env.LOVABLE_DB_MIGRATION_URL,
        process.env.DQ_GUARD_CONFIRM,
      );
      console.error(`target guard: migrations allowed on ${r}`);
    } else {
      console.error(
        "usage: target-guard.mjs identity|check|check-api|claim|adopt|migrate-gate (see the header of this file)",
      );
      return 2;
    }
    return 0;
  } catch (e) {
    console.error(
      e instanceof GuardRefusal
        ? e.message
        : `refused by the target guard: ${String(e?.message ?? e).slice(0, 200)}`,
    );
    return 3;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // exit explicitly: a refused connection must not leave a reconnecting client alive
  process.exit(await main(process.argv.slice(2)));
}
