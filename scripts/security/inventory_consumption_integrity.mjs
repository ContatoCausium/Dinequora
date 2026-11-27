// Inventory consumption (0044). LOCAL/CI QA stack ONLY (the target guard refuses any other database).
// Calls as each member, in real PostgreSQL sessions.
//
//   C  counting: sales minus the reversals of sales, per item and store, in the item's unit; manual
//      adjustments and reversals of anything else are not consumption; the window is the store's last N
//      local days (a sale 40 days old counts at 60 days, not at 30)
//   I  isolation (SECURITY INVOKER, RLS): another organization's owner and anon get nothing of A
//
//   QA_DB_URL=postgresql://...@127.0.0.1:<port>/postgres node scripts/security/inventory_consumption_integrity.mjs
import crypto from "node:crypto";
import { createRequire } from "node:module";
import {
  countOrgRowsSql,
  createIsolatedOrgSql,
  createTestUsersSql,
  dropIsolatedOrgsSql,
  dropTestUsersSql,
  isolatedOrg,
} from "../qa/isolated-org.mjs";
import { assertDisposableDb, exitOnRefusal } from "../guard/target-guard.mjs";
const require = createRequire(new URL("../../package.json", import.meta.url));
const postgres = require("postgres");

const DB_URL = process.env.QA_DB_URL ?? process.env.DB_URL;
await assertDisposableDb(DB_URL, "test:inventory-consumption").catch(exitOnRefusal);

const KEYS = ["OWNER", "OWNERB"];
const U = Object.fromEntries(KEYS.map((k) => [k, crypto.randomUUID()]));
const A = isolatedOrg("ic-a", { members: [{ userId: U.OWNER, role: "owner" }] });
const B = isolatedOrg("ic-b", { members: [{ userId: U.OWNERB, role: "owner" }] });
const ORG = A.orgId;
const LOC = A.locationId;
const ORGS = [A.orgId, B.orgId];
const BUNS = crypto.randomUUID();
const BEEF = crypto.randomUUID();

const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const code = (e) => String(e?.message ?? e).split("\n")[0];
async function as(uid, fn, role = "authenticated") {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {} });
  try {
    if (uid) {
      await c`select set_config('request.jwt.claim.sub', ${uid}, false)`;
      await c`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role })}, false)`;
    }
    await c.unsafe(`set role ${role}`);
    return await fn(c);
  } catch (e) {
    return code(e);
  } finally {
    await c.end({ timeout: 5 });
  }
}
const consumption = (c, { org = ORG, locs = null, days = 30 } = {}) =>
  c`select location_id::text, inventory_item_id::text item, consumed::float8 consumed
      from public.inventory_consumption(${org}, ${locs}, ${days})`;
const byItem = (rows) =>
  Array.isArray(rows) ? Object.fromEntries(rows.map((r) => [r.item, r.consumed])) : {};
async function move(item, delta, kind, age, reverses = null) {
  const id = crypto.randomUUID();
  await sql`insert into public.inventory_movements (id, org_id, location_id, inventory_item_id, delta,
              unit_cost_cents, kind, client_event_id, reverses_id, reason, actor_id, created_at)
            values (${id}, ${ORG}, ${LOC}, ${item}, ${delta}, 100, ${kind}, ${"ic-" + id}, ${reverses},
              'consumption test', ${U.OWNER}, now() - ${age}::interval)`;
  return id;
}

try {
  await sql.unsafe(
    createTestUsersSql(
      KEYS.map((k) => ({ userId: U[k], email: `${A.key}-${k.toLowerCase()}@example.test` })),
    ),
  );
  await sql.unsafe(createIsolatedOrgSql(A));
  await sql.unsafe(createIsolatedOrgSql(B));
  await sql`insert into public.inventory_items (id, org_id, location_id, client_id, name, unit, quantity)
            values (${BUNS}, ${ORG}, ${LOC}, ${"ic-buns-" + BUNS}, 'Buns', 'units', 50),
                   (${BEEF}, ${ORG}, ${LOC}, ${"ic-beef-" + BEEF}, 'Beef', 'lb', 20)`;
  await move(BUNS, -2, "sale", "5 seconds");
  const s2 = await move(BUNS, -3, "sale", "2 days");
  await move(BUNS, 3, "reversal", "1 day", s2);
  await move(BUNS, -10, "adjustment", "1 day");
  await move(BUNS, -5, "sale", "40 days");
  await move(BEEF, -1.5, "sale", "3 days");
  const adj = await move(BEEF, -4, "adjustment", "3 days");
  await move(BEEF, 4, "reversal", "2 days", adj);

  // ---------------------------------------------------------------- C. counting
  const r30 = await as(U.OWNER, (c) => consumption(c));
  const m30 = byItem(r30);
  check(
    "C1 Buns at 30 days: 2 + 3 sold, 3 reversed = 2 (adjustment and the 40-day sale left out)",
    m30[BUNS] === 2,
    JSON.stringify(r30),
  );
  check(
    "C2 Beef: 1.5 sold; the reversal of an adjustment is not consumption",
    m30[BEEF] === 1.5,
    String(m30[BEEF]),
  );
  check(
    "C3 each row names its store",
    Array.isArray(r30) && r30.length === 2 && r30.every((r) => r.location_id === LOC),
  );
  const m60 = byItem(await as(U.OWNER, (c) => consumption(c, { days: 60 })));
  check("C4 at 60 days the old sale counts (Buns 7)", m60[BUNS] === 7, String(m60[BUNS]));
  const other = await as(U.OWNER, (c) => consumption(c, { locs: [B.locationId] }));
  check(
    "C5 a store of another organization returns nothing",
    Array.isArray(other) && other.length === 0,
  );

  // ---------------------------------------------------------------- I. isolation
  const b = await as(U.OWNERB, (c) => consumption(c));
  check(
    "I1 another organization's owner gets nothing of A",
    Array.isArray(b) && b.length === 0,
    String(Array.isArray(b) ? b.length : b),
  );
  check(
    "I2 anon cannot call it",
    /permission denied for function/.test(String(await as(null, (c) => consumption(c), "anon"))),
  );
  const [{ prosecdef }] =
    await sql`select prosecdef from pg_proc where proname = 'inventory_consumption' and pronamespace = 'public'::regnamespace`;
  check("I3 it runs as the caller (SECURITY INVOKER: RLS applies)", prosecdef === false);
} catch (e) {
  check("run", false, code(e));
} finally {
  try {
    await sql`update public.inventory_movements set reverses_id = null where org_id = any(${ORGS})`;
    await sql`delete from public.inventory_movements where org_id = any(${ORGS})`;
    await sql`delete from public.inventory_items where org_id = any(${ORGS})`;
    await sql.unsafe(dropIsolatedOrgsSql(ORGS));
    await sql.unsafe(dropTestUsersSql(Object.values(U)));
    const [{ n }] = await sql.unsafe(
      `select * from (${countOrgRowsSql(ORGS).replace(/;\s*$/, "")}) x(n)`,
    );
    check("cleanup: nothing of the isolated organizations is left", Number(n) === 0, `${n} rows`);
  } catch (e) {
    check("cleanup", false, code(e));
  }
  await sql.end({ timeout: 5 });
}
const failed = results.filter((r) => !r.ok);
console.log(`Inventory consumption: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
