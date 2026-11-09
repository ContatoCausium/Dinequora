// Migration integrity and policy gate (CI; read-only). Policy: docs/operations/migration-policy.md
//
//   node scripts/qa/check-migrations.mjs                           # files: journal, history, policy
//   DB_URL=postgresql://... node scripts/qa/check-migrations.mjs   # + applied database
//   node scripts/qa/check-migrations.mjs --add-new-hashes          # record hashes of NEW entries
//
// Files mode fails (exit 1) when:
//  - a journal entry has no .sql file, tags/idx/numbers are duplicated or out of order, `when`
//    decreases;
//  - a .sql file is not in the journal and is not a known, documented orphan (or an orphan
//    vanished);
//  - history changed: a journal migration or a known orphan no longer matches the hash recorded in
//    scripts/qa/migration-hashes.json (LF-normalized), a journal entry has no recorded hash, or the
//    manifest lists something that is not in the journal;
//  - the SQL-first policy is broken: drizzle/schema.ts is no longer blank, a Drizzle snapshot
//    describes tables/enums/etc. (sign that `drizzle-kit generate` ran), or drizzle-kit/drizzle-orm
//    are not pinned to an exact version equal to package-lock.json.
// With DB_URL it also fails when:
//  - the tracker has rows the journal does not know, a journal entry is not applied, an applied
//    hash differs from the LF-normalized file, or an orphan is recorded as applied;
//  - a guarded RPC lost its permission check or has more than one definition (e.g. the orphan
//    0011_create_pos_sale_and_idempotency.sql run by hand);
//  - a public table has RLS disabled, a SECURITY DEFINER function has no fixed search_path, a
//    data-writing SECURITY DEFINER function is executable by anon, or a data-writing SECURITY
//    DEFINER function executable by authenticated is neither GUARDED nor REVIEWED (fail closed: a
//    new RPC must be classified before it can merge).
// --add-new-hashes only appends hashes for journal entries that have none; it never rewrites a
// recorded hash, so an edited historical migration keeps failing.
// Never writes to the database.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("../..", import.meta.url));
// Tests point the checker at a temporary copy; CI and developers use the repository itself.
const ROOT = process.env.CHECK_MIGRATIONS_ROOT
  ? path.resolve(process.env.CHECK_MIGRATIONS_ROOT)
  : REPO;
const DIR = path.join(ROOT, "drizzle/migrations");
const MANIFEST = path.join(ROOT, "scripts/qa/migration-hashes.json");
const ADD_NEW = process.argv.includes("--add-new-hashes");

// Files that were committed (and published) outside the journal. Superseded: their content is
// part of 0013 (create_pos_sale + orders_org_client_order_id_uniq) and 0017 (realtime) and
// 0011 (admin_list_platform_admins). Drizzle never applies them. Do not add new entries here.
const KNOWN_ORPHANS = new Set([
  "0010_fix_admin_list_platform_admins.sql",
  "0011_create_pos_sale_and_idempotency.sql",
  "0012_enable_realtime_orders.sql",
]);
// The migration runner must not change under us: exact versions, equal to the lockfile.
const PINNED = ["drizzle-kit", "drizzle-orm"];

const problems = [];
const lf = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");

// ---- journal ---------------------------------------------------------------------------------
const journal = JSON.parse(fs.readFileSync(path.join(DIR, "meta/_journal.json"), "utf8"));
const entries = journal.entries;
const tags = new Set();
entries.forEach((e, i) => {
  if (e.idx !== i) problems.push(`journal idx ${e.idx} at position ${i}`);
  if (tags.has(e.tag)) problems.push(`duplicated tag ${e.tag}`);
  tags.add(e.tag);
  if (i > 0 && e.when <= entries[i - 1].when) problems.push(`'when' not increasing at ${e.tag}`);
  if (!fs.existsSync(path.join(DIR, `${e.tag}.sql`))) problems.push(`missing file ${e.tag}.sql`);
});
const prefixes = new Map();
for (const e of entries) {
  const p = e.tag.slice(0, 4);
  if (prefixes.has(p))
    problems.push(`duplicated number ${p} in journal (${prefixes.get(p)}, ${e.tag})`);
  prefixes.set(p, e.tag);
}
const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql"));
const orphans = files.filter((f) => !tags.has(f.replace(/\.sql$/, "")));
for (const f of orphans)
  if (!KNOWN_ORPHANS.has(f)) problems.push(`new migration outside the journal: ${f}`);
for (const f of KNOWN_ORPHANS)
  if (!files.includes(f))
    problems.push(`known orphan ${f} disappeared (update the reconciliation doc)`);

const lfHash = (tag) => sha(lf(path.join(DIR, `${tag}.sql`)));

// ---- history: recorded hashes ----------------------------------------------------------------
const hasManifest = fs.existsSync(MANIFEST);
const manifest = hasManifest ? JSON.parse(fs.readFileSync(MANIFEST, "utf8")) : {};
const recorded = { ...(manifest.migrations ?? {}) };
const recordedOrphans = manifest.orphans ?? {};
if (!hasManifest) problems.push("missing scripts/qa/migration-hashes.json");
const added = [];
for (const e of entries) {
  if (!fs.existsSync(path.join(DIR, `${e.tag}.sql`))) continue;
  const h = lfHash(e.tag);
  if (!(e.tag in recorded)) {
    if (ADD_NEW) {
      recorded[e.tag] = h;
      added.push(e.tag);
    } else problems.push(`no recorded hash for ${e.tag} (new migration: run --add-new-hashes)`);
  } else if (recorded[e.tag] !== h)
    problems.push(
      `history changed: ${e.tag}.sql differs from its recorded hash ` +
        `(never edit an applied migration; write a new one)`,
    );
}
for (const tag of Object.keys(recorded))
  if (!tags.has(tag)) problems.push(`hash manifest lists ${tag}, which is not in the journal`);
for (const f of KNOWN_ORPHANS) {
  if (!files.includes(f)) continue;
  if (recordedOrphans[f] !== sha(lf(path.join(DIR, f))))
    problems.push(`known orphan ${f} was edited or has no recorded hash`);
}

// ---- SQL-first policy -------------------------------------------------------------------------
const schemaFile = path.join(ROOT, "drizzle/schema.ts");
if (fs.existsSync(schemaFile)) {
  const code = lf(schemaFile)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .trim();
  if (code)
    problems.push("drizzle/schema.ts is not blank (SQL-first: the schema lives in migrations)");
}
const metaDir = path.join(DIR, "meta");
const SNAPSHOT_KEYS = ["tables", "enums", "schemas", "sequences", "views", "roles", "policies"];
for (const f of fs.readdirSync(metaDir).filter((n) => n.endsWith("_snapshot.json"))) {
  let snap;
  try {
    snap = JSON.parse(fs.readFileSync(path.join(metaDir, f), "utf8"));
  } catch {
    problems.push(`snapshot ${f} is not valid JSON`);
    continue;
  }
  const filled = SNAPSHOT_KEYS.filter((k) => snap[k] && Object.keys(snap[k]).length > 0);
  if (filled.length)
    problems.push(
      `snapshot ${f} describes ${filled.join("/")} (drizzle-kit generate is not allowed)`,
    );
}
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
for (const name of PINNED) {
  const spec = pkg.dependencies?.[name] ?? pkg.devDependencies?.[name];
  const locked = lock.packages?.[`node_modules/${name}`]?.version;
  if (!spec) problems.push(`${name} is not declared in package.json`);
  else if (!/^\d+\.\d+\.\d+$/.test(spec))
    problems.push(`${name} must be pinned to an exact version (found "${spec}")`);
  else if (spec !== locked)
    problems.push(`${name} ${spec} in package.json differs from package-lock.json (${locked})`);
}

// ---- applied database (read-only) ------------------------------------------------------------
// Tenant RPCs that must enforce a permission check (0018+). A manual run of the orphan
// 0011_create_pos_sale_and_idempotency.sql silently REPLACES create_pos_sale (same signature)
// with an unchecked SECURITY DEFINER version; this catches that and any similar downgrade.
const GUARDED = [
  "archive_operational_menu",
  "cancel_operational_purchase",
  "cancel_order_with_reversal",
  "create_invitation",
  "create_pos_sale",
  "finalize_pos_sale_atomic",
  "inventory_item_costs",
  "receive_operational_purchase",
  "record_operational_movement",
  "remove_member",
  "revoke_invitation",
  "save_operational_menu",
  "save_operational_record",
  "set_member_access",
  "set_member_locations",
  "set_order_item_ready",
  "update_location",
  "update_order_status",
];
// Data-writing SECURITY DEFINER functions callable by signed-in users that authorize WITHOUT the
// permission catalog (reviewed 2026-11-09 against the definitions in 0000-0020). Each one checks
// something else. Do not add a function here without the same review; prefer GUARDED.
const REVIEWED = {
  accept_invitation: "auth.uid() must match the invitation",
  admin_assign_owner: "platform admin only",
  admin_set_platform_role: "platform admin only",
  admin_set_subscription: "platform admin only",
  admin_update_organization: "platform admin only",
  archive_permission_profile: "organization owner only",
  create_location: "organization owner only",
  create_organization: "signed-in user creates an organization they own",
  create_test_restaurant: "signed-in user creates their own demo organization",
  log_access_denied: "records a denial for the caller in their own organization",
  save_location_with_managers: "delegates to update_location and set_location_managers",
  save_org_brand: "caller's own organization",
  save_permission_profile: "organization owner only",
  set_location_managers: "organization owner only",
  set_location_status: "organization owner only",
  set_member_role: "organization owner only",
  set_onboarding_step: "caller's own organization onboarding",
  transfer_ownership: "current owner only",
};

let applied = null;
if (process.env.DB_URL) {
  const require = createRequire(path.join(REPO, "package.json"));
  const postgres = require("postgres");
  const sql = postgres(process.env.DB_URL, { max: 1, onnotice: () => {} });
  let guards, noRls, noSearchPath, writers;
  try {
    applied = await sql`select hash, created_at from drizzle.__drizzle_migrations order by id`;
    guards = await sql`select p.proname as name,
        bool_and(p.prosrc ~ 'assert_permission|has_permission|has_any_permission') as guarded,
        count(*)::int as defs
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any(${GUARDED})
      group by p.proname`;
    noRls = await sql`select c.relname as name from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity
      order by 1`;
    noSearchPath = await sql`select p.proname as name from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef
        and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c
                        where c like 'search_path=%')
      order by 1`;
    writers = await sql`select p.proname as name,
        has_function_privilege('anon', p.oid, 'EXECUTE') as anon,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prosecdef and p.prorettype <> 'trigger'::regtype
        and p.prosrc ~* '\\m(insert|update|delete)\\M'
      order by 1`;
  } finally {
    await sql.end();
  }
  const g = new Map(guards.map((r) => [r.name, r]));
  for (const name of GUARDED) {
    const r = g.get(name);
    if (!r) problems.push(`missing function public.${name}`);
    else if (!r.guarded || r.defs !== 1)
      problems.push(
        `public.${name} lost its permission check or has ${r.defs} definitions ` +
          `(was an orphan migration such as 0011_create_pos_sale_and_idempotency.sql run by hand?)`,
      );
  }
  for (const r of noRls) problems.push(`table public.${r.name} has row level security disabled`);
  for (const r of noSearchPath)
    problems.push(`SECURITY DEFINER function public.${r.name} has no fixed search_path`);
  const guardedSet = new Set(GUARDED);
  for (const w of writers) {
    if (w.anon)
      problems.push(`data-writing SECURITY DEFINER public.${w.name} is executable by anon`);
    if (w.authenticated && !guardedSet.has(w.name) && !(w.name in REVIEWED))
      problems.push(
        `data-writing SECURITY DEFINER public.${w.name} is callable by authenticated but is ` +
          `neither GUARDED nor REVIEWED in scripts/qa/check-migrations.mjs`,
      );
  }
  const orphanHashes = new Map();
  for (const f of KNOWN_ORPHANS) {
    const raw = fs.readFileSync(path.join(DIR, f), "utf8");
    for (const variant of [raw, raw.replace(/\r\n/g, "\n"), raw.replace(/\r?\n/g, "\r\n")])
      orphanHashes.set(sha(variant), f);
  }
  for (const r of applied)
    if (orphanHashes.has(r.hash))
      problems.push(`orphan recorded as applied: ${orphanHashes.get(r.hash)}`);
  const byWhen = new Map(applied.map((r) => [String(r.created_at), r.hash]));
  for (const e of entries) {
    const h = byWhen.get(String(e.when));
    if (!h) problems.push(`not applied: ${e.tag}`);
    else if (h !== lfHash(e.tag)) problems.push(`applied hash differs from file: ${e.tag}`);
  }
  const known = new Set(entries.map((e) => String(e.when)));
  for (const r of applied)
    if (!known.has(String(r.created_at)))
      problems.push(`tracker row unknown to journal: ${r.created_at}`);
}

if (ADD_NEW && added.length) {
  const migrations = Object.fromEntries(
    entries.filter((e) => e.tag in recorded).map((e) => [e.tag, recorded[e.tag]]),
  );
  fs.writeFileSync(
    MANIFEST,
    JSON.stringify({ ...manifest, migrations, orphans: recordedOrphans }, null, 2) + "\n",
  );
  console.log(`recorded hashes for: ${added.join(", ")}`);
}

console.log(
  `journal: ${entries.length} entries (${entries[0]?.tag} .. ${entries.at(-1)?.tag}); ` +
    `known orphans: ${orphans.filter((f) => KNOWN_ORPHANS.has(f)).length}; ` +
    `recorded hashes: ${Object.keys(recorded).length}` +
    (applied ? `; applied rows: ${applied.length}` : ""),
);
if (problems.length) {
  console.error(problems.map((p) => `FAIL ${p}`).join("\n"));
  process.exit(1);
}
console.log("PASS migration integrity and SQL-first policy");
