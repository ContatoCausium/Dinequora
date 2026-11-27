// Tenant isolation sweep, driven by the catalog. LOCAL/CI QA stack ONLY (the target guard refuses any
// other database). Runs after the QA tenant and the second tenant are seeded (security suite step 5r).
//
// For EVERY table and view of schema public that has an org_id column (so new tables are covered the
// day they are created, without editing this file), and for every organization X with rows in it:
//   R  the owner of ANOTHER organization (not a member of X, not a platform admin), signed in as
//      authenticated, reads 0 rows of X (a "permission denied" also counts as isolated);
//   W  in a transaction that is always rolled back, the same owner updates 0 rows of X and deletes 0
//      rows of X (or is refused).
// A view that is not security_invoker bypasses RLS (it runs as its owner): it shows up here as a leak.
// Tables with no rows of any organization are listed as "not exercised" (informational), so a gap in
// the seed is visible instead of silently passing.
//
//   QA_DB_URL=postgresql://...@127.0.0.1:<port>/postgres node scripts/security/tenant_isolation_sweep.mjs
import { createRequire } from "node:module";
import { assertDisposableDb, exitOnRefusal } from "../guard/target-guard.mjs";
const require = createRequire(new URL("../../package.json", import.meta.url));
const postgres = require("postgres");

const DB_URL = process.env.QA_DB_URL ?? process.env.DB_URL;
await assertDisposableDb(DB_URL, "test:tenant-isolation-sweep").catch(exitOnRefusal);

const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const code = (e) => String(e?.message ?? e).split("\n")[0];
const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;

/** One session as `uid` (authenticated). fn gets the session; errors come back as their message. */
async function as(uid, fn) {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {} });
  try {
    await c`select set_config('request.jwt.claim.sub', ${uid}, false)`;
    await c`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, false)`;
    await c.unsafe("set role authenticated");
    return await fn(c);
  } catch (e) {
    return code(e);
  } finally {
    await c.end({ timeout: 5 });
  }
}
const denied = (r) => typeof r === "string" && /permission denied/.test(r);

try {
  const relations = await sql`
    select c.relname as name, c.relkind as kind,
           coalesce((select option_value from pg_options_to_table(c.reloptions)
                      where option_name = 'security_invoker'), 'false') as invoker
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join pg_attribute a on a.attrelid = c.oid and a.attname = 'org_id' and not a.attisdropped
     where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
     order by c.relname`;
  // Owners and their organizations; platform admins never act as the "foreign" reader.
  const owners = await sql`
    select m.org_id::text org, m.user_id::text uid
      from public.organization_members m
     where m.role = 'owner'
       and not exists (select 1 from public.user_roles r where r.user_id = m.user_id)`;
  const membership =
    await sql`select org_id::text org, user_id::text uid from public.organization_members`;
  const memberOf = new Map();
  for (const m of membership) {
    if (!memberOf.has(m.uid)) memberOf.set(m.uid, new Set());
    memberOf.get(m.uid).add(m.org);
  }
  const orgCount = new Set(owners.map((o) => o.org)).size;
  check("at least two organizations with an owner to compare", orgCount >= 2, `${orgCount}`);
  check(
    "the catalog lists the tenant tables",
    relations.length >= 20,
    `${relations.length} relations`,
  );

  const notExercised = [];
  let pairs = 0;
  for (const rel of relations) {
    const t = `public.${ident(rel.name)}`;
    const present = await sql.unsafe(
      `select org_id::text org, count(*)::int n from ${t} where org_id is not null group by org_id`,
    );
    if (present.length === 0) {
      notExercised.push(rel.name);
      continue;
    }
    for (const { org, n } of present) {
      const foreign = owners.find((o) => o.org !== org && !memberOf.get(o.uid)?.has(org));
      if (!foreign) {
        check(`${rel.name}: a foreign owner exists for organization ${org.slice(0, 8)}`, false);
        continue;
      }
      pairs += 1;
      const label = `${rel.name} (${rel.kind === "r" || rel.kind === "p" ? "table" : "view"}, ${n} rows of one organization)`;
      const read = await as(foreign.uid, (c) =>
        c.unsafe(`select count(*)::int n from ${t} where org_id = $1`, [org]).then((r) => r[0].n),
      );
      check(
        `R ${label}: another organization's owner reads none`,
        read === 0 || denied(read),
        String(read),
      );
      if (rel.kind !== "r" && rel.kind !== "p") {
        if (rel.invoker !== "true" && read !== 0 && !denied(read))
          check(`R ${rel.name}: the view is not security_invoker`, false);
        continue;
      }
      // Writes, always rolled back: an UPDATE that touches nothing and a DELETE.
      const write = await as(foreign.uid, async (c) => {
        const out = {};
        try {
          await c.begin(async (tx) => {
            const u = await tx.unsafe(`update ${t} set org_id = org_id where org_id = $1`, [org]);
            out.updated = u.count;
            const d = await tx.unsafe(`delete from ${t} where org_id = $1`, [org]);
            out.deleted = d.count;
            throw new Error("__rollback__");
          });
        } catch (e) {
          if (code(e) !== "__rollback__") out.error = code(e);
        }
        return out;
      });
      const ok =
        typeof write === "object" &&
        (write.error
          ? denied(write.error) || /row-level security|violates/.test(write.error)
          : true) &&
        (write.updated ?? 0) === 0 &&
        (write.deleted ?? 0) === 0;
      check(
        `W ${label}: another organization's owner changes and deletes none`,
        ok,
        JSON.stringify(write),
      );
    }
  }
  check("organization/table pairs swept", pairs > 0, `${pairs}`);
  console.log(
    `INFO not exercised (no rows of any organization at this point): ${notExercised.join(", ") || "none"}`,
  );
} catch (e) {
  check("run", false, code(e));
} finally {
  await sql.end({ timeout: 5 });
}
const failed = results.filter((r) => !r.ok);
console.log(`Tenant isolation sweep: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
