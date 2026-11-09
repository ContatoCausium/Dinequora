// Migration journal integrity check (CI gate; read-only).
//
//   node scripts/qa/check-migrations.mjs                 # files vs journal only
//   DB_URL=postgresql://... node scripts/qa/check-migrations.mjs   # + applied tracker vs journal
//
// Fails (exit 1) when:
//  - a journal entry has no .sql file, tags/idx are duplicated or out of order, `when` decreases;
//  - a .sql file in drizzle/migrations is not in the journal and is not a known, documented orphan
//    (see docs/operations/phase0-migration-reconciliation.md);
//  - with DB_URL: the tracker has rows the journal does not know, a journal entry is not applied,
//    or an applied hash differs from the LF-normalized file hash (drizzle hashes file contents,
//    so CRLF checkouts must never be what gets applied).
// Never writes to the database.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const DIR = path.join(ROOT, "drizzle/migrations");
// Files that were committed (and published) outside the journal. Superseded: their content is
// part of 0013 (create_pos_sale + orders_org_client_order_id_uniq) and 0017 (realtime) and
// 0011 (admin_list_platform_admins). Drizzle never applies them. Do not add new entries here.
const KNOWN_ORPHANS = new Set([
  "0010_fix_admin_list_platform_admins.sql",
  "0011_create_pos_sale_and_idempotency.sql",
  "0012_enable_realtime_orders.sql",
]);

const problems = [];
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

const lfHash = (tag) =>
  crypto
    .createHash("sha256")
    .update(fs.readFileSync(path.join(DIR, `${tag}.sql`), "utf8").replace(/\r\n/g, "\n"))
    .digest("hex");

let applied = null;
if (process.env.DB_URL) {
  const require = createRequire(path.join(ROOT, "package.json"));
  const postgres = require("postgres");
  const sql = postgres(process.env.DB_URL, { max: 1, onnotice: () => {} });
  // Tenant RPCs that must enforce a permission check (0018+). A manual run of the orphan
  // 0011_create_pos_sale_and_idempotency.sql silently REPLACES create_pos_sale (same signature)
  // with an unchecked SECURITY DEFINER version; this catches that and any similar downgrade.
  const GUARDED = [
    "archive_operational_menu",
    "cancel_operational_purchase",
    "cancel_order_with_reversal",
    "create_pos_sale",
    "finalize_pos_sale_atomic",
    "inventory_item_costs",
    "receive_operational_purchase",
    "record_operational_movement",
    "save_operational_menu",
    "save_operational_record",
    "set_member_access",
    "set_order_item_ready",
    "update_order_status",
  ];
  let guards;
  try {
    applied = await sql`select hash, created_at from drizzle.__drizzle_migrations order by id`;
    guards = await sql`select p.proname as name,
        bool_and(p.prosrc ~ 'assert_permission|has_permission|has_any_permission') as guarded,
        count(*)::int as defs
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any(${GUARDED})
      group by p.proname`;
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
  const orphanHashes = new Map();
  for (const f of KNOWN_ORPHANS) {
    const raw = fs.readFileSync(path.join(DIR, f), "utf8");
    for (const variant of [raw, raw.replace(/\r\n/g, "\n"), raw.replace(/\r?\n/g, "\r\n")])
      orphanHashes.set(crypto.createHash("sha256").update(variant).digest("hex"), f);
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

console.log(
  `journal: ${entries.length} entries (${entries[0]?.tag} .. ${entries.at(-1)?.tag}); ` +
    `known orphans: ${orphans.filter((f) => KNOWN_ORPHANS.has(f)).length}` +
    (applied ? `; applied rows: ${applied.length}` : ""),
);
if (problems.length) {
  console.error(problems.map((p) => `FAIL ${p}`).join("\n"));
  process.exit(1);
}
console.log("PASS migration journal integrity");
