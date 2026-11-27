// Sales tax summary (0045). LOCAL/CI QA stack ONLY (the target guard refuses any other database).
// Calls as each member, in real PostgreSQL sessions.
//
//   T  counting per store and local month: orders, taxable sales (subtotal - discount), tax, total;
//      cancelled and simulated orders left out; the window is the last N months (an order 5 months old
//      counts at 6 months, not at 3)
//   I  isolation (SECURITY INVOKER, RLS): another organization's owner and anon get nothing of A
//
//   QA_DB_URL=postgresql://...@127.0.0.1:<port>/postgres node scripts/security/sales_tax_integrity.mjs
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
await assertDisposableDb(DB_URL, "test:sales-tax").catch(exitOnRefusal);

const KEYS = ["OWNER", "OWNERB"];
const U = Object.fromEntries(KEYS.map((k) => [k, crypto.randomUUID()]));
const A = isolatedOrg("st-a", { members: [{ userId: U.OWNER, role: "owner" }] });
const B = isolatedOrg("st-b", { members: [{ userId: U.OWNERB, role: "owner" }] });
const ORG = A.orgId;
const LOC = A.locationId;
const ORGS = [A.orgId, B.orgId];

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
const summary = (c, { org = ORG, locs = null, months = 3 } = {}) =>
  c`select location_id::text, month, orders::int orders, taxable_cents::int taxable,
           tax_cents::int tax, total_cents::int total
      from public.sales_tax_summary(${org}, ${locs}, ${months}) order by month`;

async function order({
  age,
  status = "delivered",
  subtotal,
  discount = 0,
  tax,
  simulation = false,
}) {
  const id = crypto.randomUUID();
  await sql`insert into public.orders (id, org_id, location_id, order_number, type, status,
              subtotal_cents, discount_cents, tax_cents, total_cents, is_simulation,
              client_order_id, request_hash, created_by, created_at)
            values (${id}, ${ORG}, ${LOC}, ${"ST-" + id.slice(0, 8)}, 'dine_in', ${status},
              ${subtotal}, ${discount}, ${tax}, ${subtotal - discount + tax}, ${simulation},
              ${"st-" + id}, ${"h-" + id}, ${U.OWNER}, now() - ${age}::interval)`;
}

try {
  await sql.unsafe(
    createTestUsersSql(
      KEYS.map((k) => ({ userId: U[k], email: `${A.key}-${k.toLowerCase()}@example.test` })),
    ),
  );
  await sql.unsafe(createIsolatedOrgSql(A));
  await sql.unsafe(createIsolatedOrgSql(B));
  // this month: 2 orders (one with a discount), one cancelled, one simulated
  await order({ age: "5 seconds", subtotal: 1000, tax: 63 });
  await order({ age: "6 seconds", subtotal: 2000, discount: 200, tax: 113 });
  await order({ age: "7 seconds", status: "cancelled", subtotal: 5000, tax: 313 });
  await order({ age: "8 seconds", subtotal: 9000, tax: 563, simulation: true });
  // last month and 5 months ago
  await order({ age: "1 month 1 day", subtotal: 4000, tax: 250 });
  await order({ age: "5 months", subtotal: 7000, tax: 438 });

  // ---------------------------------------------------------------- T. counting
  const r3 = await as(U.OWNER, (c) => summary(c));
  const current = Array.isArray(r3) ? r3.at(-1) : null;
  check(
    "T1 this month: 2 orders, taxable 1000 + 1800, tax 63 + 113 (cancelled and simulated left out)",
    current?.orders === 2 &&
      current?.taxable === 2800 &&
      current?.tax === 176 &&
      current?.total === 2976,
    JSON.stringify(current ?? r3),
  );
  check(
    "T2 last month is its own row; the 5-month-old order is outside 3 months",
    Array.isArray(r3) && r3.length === 2 && r3[0].orders === 1 && r3[0].tax === 250,
    JSON.stringify(r3),
  );
  check(
    "T3 rows name the store and a YYYY-MM month",
    Array.isArray(r3) && r3.every((r) => r.location_id === LOC && /^\d{4}-\d{2}$/.test(r.month)),
  );
  const r6 = await as(U.OWNER, (c) => summary(c, { months: 6 }));
  check("T4 at 6 months the old order counts (3 rows)", Array.isArray(r6) && r6.length === 3);
  const other = await as(U.OWNER, (c) => summary(c, { locs: [B.locationId] }));
  check(
    "T5 a store of another organization returns nothing",
    Array.isArray(other) && other.length === 0,
  );

  // ---------------------------------------------------------------- I. isolation
  const b = await as(U.OWNERB, (c) => summary(c));
  check(
    "I1 another organization's owner gets nothing of A",
    Array.isArray(b) && b.length === 0,
    String(Array.isArray(b) ? b.length : b),
  );
  check(
    "I2 anon cannot call it",
    /permission denied for function/.test(String(await as(null, (c) => summary(c), "anon"))),
  );
  const [{ prosecdef }] =
    await sql`select prosecdef from pg_proc where proname = 'sales_tax_summary' and pronamespace = 'public'::regnamespace`;
  check("I3 it runs as the caller (SECURITY INVOKER: RLS applies)", prosecdef === false);
} catch (e) {
  check("run", false, code(e));
} finally {
  try {
    await sql`delete from public.orders where org_id = any(${ORGS})`;
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
console.log(`Sales tax summary: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
