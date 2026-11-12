// Operational wrapper for LOCAL Supabase databases: inspect, precheck, backup, migrate, recover.
// Creating or running this tool authorizes nothing: every write to a database that is not
// disposable needs the authorization of its owner AND a confirmation typed for that exact target.
//
//   node scripts/ops/db-ops.mjs inspect  --db-url URL --container supabase_db_<project>
//   node scripts/ops/db-ops.mjs precheck --db-url URL --container C --backup DIR
//   node scripts/ops/db-ops.mjs backup   --db-url URL --container C --out NEW_DIR
//   node scripts/ops/db-ops.mjs migrate  --db-url URL --container C --backup DIR --confirm migrate:<class>:<cluster>
//   node scripts/ops/db-ops.mjs recover  --db-url URL --container C --backup DIR --confirm recover:<class>:<cluster>
//
// Target identity comes from the database itself (scripts/guard/target-guard.mjs): the cluster's
// system_identifier (shown only as its 12-digit hash), the database OID and the guard marker.
// Classes: qa / demo (protected-clusters.json), disposable (valid marker), unregistered (any other
// local database, e.g. a restored copy). Remote (hosted, e.g. production) URLs are refused: production
// follows its own release procedure. The URL and the container must reach the SAME database.
//   * inspect / precheck / backup only read (read-only sessions).
//   * migrate / recover need --confirm <operation>:<class>:<cluster> naming this exact target (none on
//     a disposable database for migrate); recover ALWAYS needs it. No environment variable replaces it.
//   * migrate and recover take a cluster-wide advisory lock: two operations never overlap.
//   * a failure is reported with the next manual step; a restore is NEVER started automatically.
//   * --api-window N (1..60, default 5): minutes of API silence (gateway log) required before migrate.
// Output never contains passwords, keys, URLs with credentials or raw cluster identifiers.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import {
  identity,
  clusterHash,
  short,
  describeDbUrl,
  GuardRefusal,
} from "../guard/target-guard.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FINGERPRINT_SQL = path.join(ROOT, "scripts/ops/sql/fingerprint.sql");
const JOURNAL = path.join(ROOT, "drizzle/migrations/meta/_journal.json");
const LOCK_KEY = "dinequora-db-ops";
const SERVICE_USERS = new Set([
  "authenticator",
  "supabase_admin",
  "supabase_auth_admin",
  "supabase_storage_admin",
  "supabase_realtime_admin",
  "supabase_replication_admin",
]);
const SERVICE_APPS =
  /^(PostgREST|pg_net|pg_cron|supabase_mt_realtime|cluster_node_realtime|Supavisor|realtime|postgres_exporter)/;

class Stop extends Error {}
const say = (s = "") => console.log(s);
const stop = (msg) => {
  throw new Stop(msg);
};

function parse(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--"))
      a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[++i] : "";
    else a._.push(argv[i]);
  }
  return a;
}

// Every docker call has a deadline (default 2 min; dumps and restores pass a longer one): a hung
// container or daemon is a stop, never a hang.
function docker(args, opts = {}) {
  const r = spawnSync("docker", args, {
    encoding: opts.binary ? undefined : "utf8",
    maxBuffer: 1 << 28,
    timeout: 120_000,
    killSignal: "SIGKILL",
    ...opts,
  });
  if (r.error)
    stop(
      `docker ${args[0]} failed: ${r.error.code === "ETIMEDOUT" ? "no answer within the deadline" : (r.error.code ?? r.error.message)}`,
    );
  return r;
}
/** A database answer within ms, or a stop. */
async function deadline(promise, ms, what) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise(
        (_, rej) =>
          (timer = setTimeout(
            () => rej(new Stop(`no answer from the database within ${ms / 1000} s (${what})`)),
            ms,
          )),
      ),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
const DB_DEADLINE = 20_000;
function cpsql(container, sql, { db = "postgres", user = "postgres", readOnly = true } = {}) {
  const env = readOnly ? ["-e", "PGOPTIONS=-c default_transaction_read_only=on"] : [];
  const r = docker(
    [
      "exec",
      "-i",
      ...env,
      container,
      "psql",
      "-U",
      user,
      "-d",
      db,
      "-X",
      "-q",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: sql },
  );
  if (r.status !== 0)
    stop(
      `query failed in ${container}: ${(r.stderr || "").trim().split("\n").slice(-1)[0]?.slice(0, 200)}`,
    );
  return r.stdout.trim();
}

/** Who the target is, checked through BOTH channels (URL and container). */
async function target(a, { needContainer = true } = {}) {
  let id;
  try {
    id = await identity(a["db-url"]);
  } catch (e) {
    if (e instanceof GuardRefusal && /remote/.test(e.message))
      stop(
        `${e.message}. Remote (hosted) databases, production included, are not handled by this tool.`,
      );
    throw e;
  }
  const label = id.protected ?? (id.markerValid ? "disposable" : "unregistered");
  const t = { ...id, label, container: a.container };
  if (needContainer || a.container) {
    if (!/^supabase_db_[a-z0-9_-]+$/i.test(a.container ?? ""))
      stop("--container supabase_db_<project> is required");
    const [sys, oid] = cpsql(
      a.container,
      "select (select system_identifier from pg_control_system()) || '|' || (select oid from pg_database where datname = current_database())",
    ).split("|");
    if (clusterHash(sys) !== id.hash || oid !== id.datoid)
      stop(
        `--db-url and --container are DIFFERENT databases (URL cluster ${id.cluster}, container cluster ${short(clusterHash(sys))}); nothing done`,
      );
    t.project = a.container.replace(/^supabase_db_/, "");
  }
  if (id.db !== "postgres")
    stop(`database ${id.db}: these operations handle the "postgres" database of a Supabase stack`);
  return t;
}

function journal() {
  return JSON.parse(fs.readFileSync(JOURNAL, "utf8")).entries;
}
async function trackerRows(dbUrl) {
  const sql = postgres(dbUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    return await deadline(
      sql.begin("read only", async (tx) => {
        const [{ ok }] =
          await tx`select to_regclass('drizzle.__drizzle_migrations') is not null as ok`;
        return ok
          ? tx`select id, created_at::text as created_at, hash from drizzle.__drizzle_migrations order by id`
          : [];
      }),
      DB_DEADLINE,
      "migration tracker",
    );
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}
function migrationState(rows) {
  const entries = journal();
  const applied = rows.length;
  const prefix = rows.every(
    (r, i) => entries[i] && String(entries[i].when) === String(r.created_at),
  );
  return { applied, prefix, pending: entries.slice(applied).map((e) => e.tag) };
}
async function sessions(dbUrl) {
  const sql = postgres(dbUrl, { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    const rows = await deadline(
      sql.begin(
        "read only",
        (
          tx,
        ) => tx`select usename, coalesce(application_name, '') as app, backend_type from pg_stat_activity
                           where datname = current_database() and pid <> pg_backend_pid() and backend_type = 'client backend'`,
      ),
      DB_DEADLINE,
      "sessions",
    );
    const direct = rows.filter((r) => !SERVICE_USERS.has(r.usename) && !SERVICE_APPS.test(r.app));
    return {
      direct: direct.length,
      service: rows.length - direct.length,
      apps: [...new Set(direct.map((r) => r.app || "(no name)"))],
    };
  } finally {
    await sql.end({ timeout: 1 }).catch(() => {});
  }
}
function apiRequests(project, minutes = 5) {
  const r = docker(["logs", "--since", `${minutes}m`, `supabase_kong_${project}`]);
  if (r.status !== 0) return null;
  // counted, never printed (the lines carry API keys)
  return `${r.stdout}\n${r.stderr}`
    .split("\n")
    .filter((l) =>
      /"(GET|POST|PATCH|PUT|DELETE|HEAD) \/(rest|auth|realtime|storage|graphql)\//.test(l),
    ).length;
}
function fingerprint(container) {
  const r = docker(
    [
      "exec",
      "-i",
      "-e",
      "PGOPTIONS=-c default_transaction_read_only=on",
      container,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-X",
      "-q",
      "-At",
    ],
    { input: fs.readFileSync(FINGERPRINT_SQL, "utf8") },
  );
  const lines = `${r.stdout}\n${r.stderr}`
    .split("\n")
    .map((l) => l.replace(/^NOTICE:  /, ""))
    .filter((l) => l.startsWith("FP"));
  if (r.status !== 0 || lines.length === 0)
    stop("fingerprint failed (is this a migrated application database?)");
  return normalizeFingerprint(lines.join("\n"));
}
// One keyed line per object: compared as a sorted set (psql interleaves NOTICE and SELECT output).
const normalizeFingerprint = (text) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("FP"))
    .sort()
    .join("\n") + "\n";
const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/** A backup folder made by this tool or by the A1 procedure (2026-11-12). */
function readBackup(dir) {
  if (!dir || !fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory())
    stop("--backup must be an existing backup folder");
  const files = fs.readdirSync(dir);
  const dump = files.filter((f) => f.endsWith(".dump"));
  const fp = files.filter((f) => f.endsWith(".fingerprint-before.txt"));
  if (
    dump.length !== 1 ||
    fp.length !== 1 ||
    !files.includes("SHA256SUMS.txt") ||
    !files.includes("MANIFEST.txt") ||
    !files.includes("migration-history.txt")
  )
    stop(
      "backup folder incomplete (one .dump, one .fingerprint-before.txt, SHA256SUMS.txt, MANIFEST.txt, migration-history.txt)",
    );
  const sums = fs.readFileSync(path.join(dir, "SHA256SUMS.txt"), "utf8").trim().split("\n");
  const bad = [];
  for (const line of sums) {
    const m = line.match(/^([0-9a-f]{64}) [ *](.+)$/);
    if (!m || !files.includes(m[2]) || sha256(path.join(dir, m[2])) !== m[1])
      bad.push(m?.[2] ?? line.slice(0, 40));
  }
  if (bad.length || !sums.some((l) => l.endsWith(dump[0])) || !sums.some((l) => l.endsWith(fp[0])))
    stop(`backup checksums do not match (${bad.join(", ") || "dump or fingerprint not listed"})`);
  const manifest = fs.readFileSync(path.join(dir, "MANIFEST.txt"), "utf8");
  const raw = manifest.match(/system_identifier=(\d+)/)?.[1];
  const hash = manifest.match(/^cluster=([0-9a-f]{64})$/m)?.[1] ?? (raw ? clusterHash(raw) : null);
  if (!hash) stop("backup manifest names no cluster");
  return {
    dir,
    dump: path.join(dir, dump[0]),
    dumpSha: sha256(path.join(dir, dump[0])),
    fingerprint: normalizeFingerprint(fs.readFileSync(path.join(dir, fp[0]), "utf8")),
    history: fs.readFileSync(path.join(dir, "migration-history.txt"), "utf8").trim(),
    hash,
  };
}
const historyOf = (rows) => rows.map((r) => `${r.id} ${r.created_at} ${r.hash}`).join("\n");

async function report(t, a) {
  const rows = await trackerRows(a["db-url"]);
  const m = migrationState(rows);
  const s = await sessions(a["db-url"]);
  const win = a["api-window"] === undefined ? 5 : Number(a["api-window"]);
  if (!Number.isInteger(win) || win < 1 || win > 60) stop("--api-window must be 1..60 minutes");
  const api = t.project ? apiRequests(t.project, win) : null;
  say(`target      ${t.where}${t.container ? `  (container ${t.container}: same database)` : ""}`);
  say(`class       ${t.label}   cluster ${t.cluster}   guard marker: ${t.marker ?? "none"}`);
  say(
    `migrations  ${m.applied} applied (${m.prefix ? "a prefix of the journal" : "NOT a prefix of the journal"}), ${m.pending.length} pending${m.pending.length ? `: ${m.pending.join(", ")}` : ""}`,
  );
  say(
    `sessions    direct clients: ${s.direct}${s.apps.length ? ` (${s.apps.join(", ")})` : ""}; stack services: ${s.service}`,
  );
  if (api !== null) say(`api         requests in the last ${win} minute(s): ${api}`);
  return { rows, m, s, api, win };
}

async function precheck(t, a, { forMigrate = false } = {}) {
  const r = await report(t, a);
  const checks = [];
  const add = (ok, what) => checks.push({ ok, what });
  add(r.m.prefix, "applied migrations are a prefix of the journal (no unknown or reordered row)");
  if (forMigrate) add(r.m.pending.length > 0, "there are pending migrations");
  add(r.s.direct === 0, "no direct client session on the database");
  if (t.label !== "disposable")
    add(r.api === 0, `no API request in the last ${r.win} minute(s) (no application connected)`);
  if (t.label !== "disposable" || a.backup) {
    const b = readBackup(a.backup);
    add(true, `backup checksums verified (dump sha256 ${b.dumpSha.slice(0, 12)}…)`);
    add(b.hash === t.hash, "backup was taken from THIS cluster");
    const list = docker(["exec", "-i", t.container, "pg_restore", "--list"], {
      input: fs.readFileSync(b.dump),
      encoding: undefined,
    });
    add(list.status === 0, "dump is readable (pg_restore --list)");
    add(
      fingerprint(t.container) === b.fingerprint,
      "current state = backup fingerprint (nothing changed since the backup)",
    );
    add(historyOf(r.rows) === b.history, "migration history = the backup's");
  }
  say("");
  for (const c of checks) say(`${c.ok ? "PASS" : "FAIL"}  ${c.what}`);
  return checks.every((c) => c.ok);
}

function requireConfirm(op, t, a, { always = false } = {}) {
  if (!always && t.label === "disposable") return;
  const expected = `${op}:${t.label}:${t.cluster}`;
  if (a.confirm !== expected)
    stop(
      `${op} on the ${t.label} cluster ${t.cluster} needs --confirm ${expected} (given: ${a.confirm ? "a different value" : "none"}). Nothing done.`,
    );
}

async function withLock(dbUrl, fn) {
  const { url } = describeDbUrl(dbUrl);
  url.pathname = "/template1"; // the lock must survive dropping and recreating the postgres database
  const sql = postgres(url.toString(), { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    const [{ ok }] = await deadline(
      sql`select pg_try_advisory_lock(hashtext(${LOCK_KEY})) as ok`,
      DB_DEADLINE,
      "lock",
    );
    if (!ok) stop("another db-ops operation holds the lock on this cluster; nothing done");
    return await fn();
  } finally {
    await sql.end({ timeout: 2 }).catch(() => {});
  }
}

async function migrate(t, a) {
  if (t.label !== "disposable" && !a.backup)
    stop("migrate on a non-disposable database needs --backup (the restore point)");
  requireConfirm("migrate", t, a);
  if (!(await precheck(t, a, { forMigrate: true }))) stop("precheck failed: nothing applied");
  await withLock(a["db-url"], async () => {
    say(`\napplying with drizzle-kit (one transaction) on ${t.label} cluster ${t.cluster} …`);
    const t0 = Date.now();
    const r = spawnSync(
      process.platform === "win32" ? "npx.cmd" : "npx",
      ["--no-install", "drizzle-kit", "migrate"],
      {
        cwd: ROOT,
        encoding: "utf8",
        shell: process.platform === "win32",
        // the migrate gate in drizzle.config.ts accepts this target only with this confirmation,
        // which was checked above against the target's own identity
        env: {
          ...process.env,
          LOVABLE_DB_MIGRATION_URL: a["db-url"],
          DQ_GUARD_CONFIRM: `migrate:${t.label}:${t.cluster}`,
        },
        timeout: 1_800_000,
      },
    );
    const out = `${r.stdout}\n${r.stderr}`
      .split("\n")
      .filter((l) => /applied|error|Error|migrat/i.test(l))
      .map((l) => l.replace(/postgres(ql)?:\/\/\S+/g, "<url>"));
    out.slice(0, 20).forEach((l) => say(`  ${l.trim()}`));
    const after = migrationState(await trackerRows(a["db-url"]));
    say(
      `  ${((Date.now() - t0) / 1000).toFixed(1)} s; now ${after.applied} applied, ${after.pending.length} pending`,
    );
    if (r.status !== 0)
      stop(
        "drizzle-kit failed. Its migrations run in ONE transaction, so nothing should be applied: confirm with `inspect` " +
          "(the applied count must equal the one before). A restore is a separate, manual decision (`recover`); it is never automatic.",
      );
    say(
      "migrate done. Next: check-migrations (DB mode), the preservation snapshot and the validation steps of the plan.",
    );
  });
}

async function backup(t, a) {
  if (!a.out) stop("--out NEW_DIR is required");
  fs.mkdirSync(a.out); // fails if it exists: a backup never overwrites anything
  const ts = new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d+Z$/, "Z");
  const p = `${t.project}_postgres_${ts}`;
  const fpBefore = fingerprint(t.container);
  fs.writeFileSync(path.join(a.out, `${p}.fingerprint-before.txt`), fpBefore, { flag: "wx" });
  const dumpFd = fs.openSync(path.join(a.out, `${p}.dump`), "wx");
  const d = docker(
    [
      "exec",
      "-e",
      "PGOPTIONS=-c default_transaction_read_only=on",
      t.container,
      "pg_dump",
      "-U",
      "supabase_admin",
      "-d",
      "postgres",
      "-Fc",
    ],
    { stdio: ["ignore", dumpFd, "pipe"], timeout: 1_800_000 },
  );
  fs.closeSync(dumpFd);
  if (d.status !== 0) stop("pg_dump failed; the folder is incomplete and must not be used");
  const gFd = fs.openSync(path.join(a.out, `${t.project}_globals_${ts}.sql`), "wx");
  const g = docker(
    [
      "exec",
      t.container,
      "pg_dumpall",
      "-U",
      "supabase_admin",
      "--globals-only",
      "--no-role-passwords",
    ],
    { stdio: ["ignore", gFd, "pipe"], timeout: 600_000 },
  );
  fs.closeSync(gFd);
  if (g.status !== 0) stop("pg_dumpall failed; the folder is incomplete and must not be used");
  const list = docker(["exec", "-i", t.container, "pg_restore", "--list"], {
    input: fs.readFileSync(path.join(a.out, `${p}.dump`)),
  });
  if (list.status !== 0) stop("the new dump is unreadable; the folder must not be used");
  fs.writeFileSync(path.join(a.out, `${p}.list.txt`), list.stdout, { flag: "wx" });
  const rows = await trackerRows(a["db-url"]);
  fs.writeFileSync(path.join(a.out, "migration-history.txt"), historyOf(rows) + "\n", {
    flag: "wx",
  });
  const fpAfter = fingerprint(t.container);
  fs.writeFileSync(path.join(a.out, `${p}.fingerprint-after.txt`), fpAfter, { flag: "wx" });
  const counts = cpsql(
    t.container,
    "select 'orgs=' || (select count(*) from public.organizations) || ' stores=' || (select count(*) from public.locations) || ' users=' || (select count(*) from auth.users) || ' orders=' || (select count(*) from public.orders)",
  );
  const manifest = [
    `created_utc=${ts}`,
    `cluster=${t.hash}`,
    `class=${t.label}`,
    `container=${t.container} database=postgres`,
    `server=${cpsql(t.container, "show server_version")}`,
    `tracker_rows=${rows.length}`,
    counts,
    `tool=scripts/ops/db-ops.mjs @ ${spawnSync("git", ["rev-parse", "HEAD"], { cwd: ROOT, encoding: "utf8" }).stdout.trim()}`,
    `unchanged_during_backup=${fpBefore === fpAfter}`,
  ].join("\n");
  fs.writeFileSync(path.join(a.out, "MANIFEST.txt"), manifest + "\n", { flag: "wx" });
  const files = fs.readdirSync(a.out).sort();
  fs.writeFileSync(
    path.join(a.out, "SHA256SUMS.txt"),
    files.map((f) => `${sha256(path.join(a.out, f))} *${f}`).join("\n") + "\n",
    { flag: "wx" },
  );
  say(
    `backup written to ${a.out}: dump sha256 ${sha256(path.join(a.out, `${p}.dump`)).slice(0, 12)}…, ${rows.length} migrations`,
  );
  if (fpBefore !== fpAfter)
    stop("the database changed DURING the backup: do not use this folder as a restore point");
}

async function recover(t, a) {
  requireConfirm("recover", t, a, { always: true });
  const b = readBackup(a.backup);
  if (t.protected && b.hash !== t.hash)
    stop(
      `the ${t.label} cluster can only be restored from one of ITS backups; this backup is from cluster ${short(b.hash)}`,
    );
  const ok = docker(["exec", "-i", t.container, "pg_restore", "--list"], {
    input: fs.readFileSync(b.dump),
  });
  if (ok.status !== 0) stop("dump unreadable; nothing done");
  const SU = { user: "supabase_admin", db: "template1", readOnly: false };
  // database-level settings, ACL and comment: kept in memory only (they include the stack's own secrets)
  const settings = cpsql(
    t.container,
    `
    select format('alter database postgres %s set %s = %L;', coalesce('in role ' || quote_ident(r.rolname), ''), split_part(s, '=', 1), substr(s, strpos(s, '=') + 1))
    from pg_db_role_setting d left join pg_roles r on r.oid = d.setrole, unnest(d.setconfig) s
    where d.setdatabase = (select oid from pg_database where datname = 'postgres') and split_part(s, '=', 1) ~ '^[a-z_][a-z0-9_.]*$'
    union all
    select format('grant %s on database postgres to %s%s;', x.privilege_type, case when x.grantee = 0 then 'public' else quote_ident(r.rolname) end, case when x.is_grantable then ' with grant option' else '' end)
    from pg_database d, aclexplode(d.datacl) x left join pg_roles r on r.oid = x.grantee where d.datname = 'postgres'
    union all
    select format('comment on database postgres is %L;', shobj_description(oid, 'pg_database')) from pg_database where datname = 'postgres' and shobj_description(oid, 'pg_database') is not null`,
    SU,
  );
  const total = cpsql(
    t.container,
    "select count(*) from pg_db_role_setting d, unnest(d.setconfig) s where d.setdatabase = (select oid from pg_database where datname = 'postgres')",
    SU,
  );
  if (settings.split("\n").filter((l) => l.startsWith("alter database")).length !== Number(total))
    stop("a database setting has an unexpected name; nothing done");
  const aclBefore = cpsql(
    t.container,
    "select array(select x::text from unnest(datacl) x order by 1) from pg_database where datname = 'postgres'",
    SU,
  );
  await withLock(a["db-url"], async () => {
    const services = docker([
      "ps",
      "--filter",
      `label=com.supabase.cli.project=${t.project}`,
      "--format",
      "{{.Names}}",
    ])
      .stdout.split("\n")
      .filter((n) => /_(rest|auth|realtime|storage)_/.test(n));
    say(
      `restoring ${path.basename(b.dump)} into the ${t.label} cluster ${t.cluster} (services stopped: ${services.length})`,
    );
    for (const s of services) docker(["stop", s]);
    try {
      cpsql(t.container, "drop database postgres with (force);", SU);
      cpsql(
        t.container,
        "create database postgres owner postgres template template0 encoding 'UTF8' lc_collate 'en_US.UTF-8' lc_ctype 'en_US.UTF-8';",
        SU,
      );
      const t0 = Date.now();
      const r = docker(
        [
          "exec",
          "-i",
          t.container,
          "pg_restore",
          "-U",
          "supabase_admin",
          "-d",
          "postgres",
          "--single-transaction",
          "--exit-on-error",
        ],
        { input: fs.readFileSync(b.dump), timeout: 1_800_000 },
      );
      if (r.status !== 0)
        stop(
          `pg_restore failed (single transaction: the postgres database is empty now). Stop here; do not retry blindly: ${(r.stderr || "").split("\n").slice(-2).join(" ").slice(0, 200)}`,
        );
      say(`  pg_restore OK in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      cpsql(t.container, settings, SU);
      const aclAfter = cpsql(
        t.container,
        "select array(select x::text from unnest(datacl) x order by 1) from pg_database where datname = 'postgres'",
        SU,
      );
      if (aclAfter !== aclBefore)
        stop("database ACL differs after the restore; services left stopped for inspection");
      // a CI/test stack exposes the dq_guard schema to PostgREST: recreate it EMPTY (no marker) so the API
      // starts; the restored copy stays unregistered until someone adopts it explicitly
      if (!t.protected)
        cpsql(
          t.container,
          "create schema if not exists dq_guard authorization postgres; revoke all on schema dq_guard from public;",
          { ...SU, db: "postgres" },
        );
      say("  database settings, ACL and comment re-applied (ACL identical)");
    } finally {
      for (const s of services) docker(["start", s]);
    }
    const fp = fingerprint(t.container);
    const after = await identity(a["db-url"]);
    say(
      `  restored state = backup fingerprint: ${fp === b.fingerprint ? "yes" : "NO"}; class now ${after.protected ?? (after.markerValid ? "disposable" : "unregistered")}`,
    );
    if (fp !== b.fingerprint)
      stop(
        "the restored state differs from the backup fingerprint: investigate before using the database",
      );
  });
}

async function main(argv) {
  const a = parse(argv);
  const cmd = a._[0];
  try {
    if (!["inspect", "precheck", "backup", "migrate", "recover"].includes(cmd)) {
      console.error(
        "usage: db-ops.mjs inspect|precheck|backup|migrate|recover --db-url URL --container supabase_db_<project> [...] (see the header)",
      );
      return 2;
    }
    const t = await target(a, { needContainer: cmd !== "inspect" });
    if (cmd === "inspect") await report(t, a);
    else if (cmd === "precheck") {
      if (!(await precheck(t, a, { forMigrate: true }))) return 4;
    } else if (cmd === "backup") await backup(t, a);
    else if (cmd === "migrate") await migrate(t, a);
    else await recover(t, a);
    return 0;
  } catch (e) {
    if (e instanceof Stop || e instanceof GuardRefusal) {
      console.error(`STOPPED: ${e.message}`);
      return 3;
    }
    console.error(
      `STOPPED (unexpected): ${String(e?.message ?? e)
        .replace(/postgres(ql)?:\/\/\S+/g, "<url>")
        .slice(0, 300)}`,
    );
    return 1;
  }
}

process.exit(await main(process.argv.slice(2)));
