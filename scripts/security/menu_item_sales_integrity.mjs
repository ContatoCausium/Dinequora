// Menu item sales (0042). LOCAL/CI QA stack ONLY (the target guard refuses any other database).
// Calls as each member, in real PostgreSQL sessions.
//
//   S  counting: units, sales and orders per product and store; cancelled orders left out; the window
//      is the store's last N local days (an order 40 days old counts at 60 days, not at 30); a store
//      filter of another organization returns nothing
//   I  isolation (SECURITY INVOKER, RLS): another organization's owner and anon get nothing of A
//
//   QA_DB_URL=postgresql://...@127.0.0.1:<port>/postgres node scripts/security/menu_item_sales_integrity.mjs
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
await assertDisposableDb(DB_URL, "test:menu-item-sales").catch(exitOnRefusal);

const KEYS = ["OWNER", "OWNERB"];
const U = Object.fromEntries(KEYS.map((k) => [k, crypto.randomUUID()]));
const A = isolatedOrg("mis-a", { members: [{ userId: U.OWNER, role: "owner" }] });
const B = isolatedOrg("mis-b", { members: [{ userId: U.OWNERB, role: "owner" }] });
const ORG = A.orgId;
const LOC = A.locationId;
const ORGS = [A.orgId, B.orgId];
const P1 = crypto.randomUUID();
const P2 = crypto.randomUUID();

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
const sales = (c, { org = ORG, locs = null, days = 30 } = {}) =>
  c`select location_id::text, product_id::text, product_name, units::float8 units,
           sales_cents::int sales, orders::int orders
      from public.menu_item_sales(${org}, ${locs}, ${days})`;
const byProduct = (rows) =>
  Array.isArray(rows) ? Object.fromEntries(rows.map((r) => [r.product_id, r])) : {};

async function order({ age, status = "delivered", items }) {
  const id = crypto.randomUUID();
  const sub = items.reduce((n, [, q, p]) => n + q * p, 0);
  await sql`insert into public.orders (id, org_id, location_id, order_number, type, status,
              subtotal_cents, total_cents, client_order_id, request_hash, created_by, created_at)
            values (${id}, ${ORG}, ${LOC}, ${"MIS-" + id.slice(0, 8)}, 'dine_in', ${status},
              ${sub}, ${sub}, ${"mis-" + id}, ${"h-" + id}, ${U.OWNER}, now() - ${age}::interval)`;
  for (const [product, q, price] of items) {
    await sql`insert into public.order_items (org_id, location_id, order_id, product_id, product_name,
                unit_price_cents, quantity, subtotal_cents)
              values (${ORG}, ${LOC}, ${id}, ${product}, ${product === P1 ? "Burger" : "Soda"},
                ${price}, ${q}, ${q * price})`;
  }
}

try {
  await sql.unsafe(
    createTestUsersSql(
      KEYS.map((k) => ({ userId: U[k], email: `${A.key}-${k.toLowerCase()}@example.test` })),
    ),
  );
  await sql.unsafe(createIsolatedOrgSql(A));
  await sql.unsafe(createIsolatedOrgSql(B));
  await sql`insert into public.menu_products (id, org_id, client_id, name, price_cents)
            values (${P1}, ${ORG}, ${"mis-p1-" + P1}, 'Burger', 1000), (${P2}, ${ORG}, ${"mis-p2-" + P2}, 'Soda', 500)`;
  await order({
    age: "5 seconds",
    status: "new",
    items: [
      [P1, 2, 1000],
      [P2, 1, 500],
    ],
  });
  await order({ age: "2 days", items: [[P1, 1, 1000]] });
  await order({ age: "1 hour", status: "cancelled", items: [[P1, 5, 1000]] });
  await order({ age: "40 days", items: [[P2, 3, 500]] });

  // ---------------------------------------------------------------- S. counting
  const s30 = await as(U.OWNER, (c) => sales(c));
  const m30 = byProduct(s30);
  check(
    "S1 Burger: 3 units, $30.00, 2 orders (the cancelled order is left out)",
    m30[P1]?.units === 3 && m30[P1]?.sales === 3000 && m30[P1]?.orders === 2,
    JSON.stringify(m30[P1] ?? s30),
  );
  check(
    "S2 Soda at 30 days: the 40-day-old order is outside the window",
    m30[P2]?.units === 1 && m30[P2]?.sales === 500,
    JSON.stringify(m30[P2] ?? null),
  );
  check(
    "S3 each row names its store and product",
    Array.isArray(s30) && s30.length === 2 && s30.every((r) => r.location_id === LOC),
  );
  const m60 = byProduct(await as(U.OWNER, (c) => sales(c, { days: 60 })));
  check("S4 at 60 days the old order counts (Soda 4 units)", m60[P2]?.units === 4);
  const own = await as(U.OWNER, (c) => sales(c, { locs: [LOC] }));
  check("S5 filtered to the store: same two rows", Array.isArray(own) && own.length === 2);
  const other = await as(U.OWNER, (c) => sales(c, { locs: [B.locationId] }));
  check(
    "S6 a store of another organization returns nothing",
    Array.isArray(other) && other.length === 0,
  );

  // ---------------------------------------------------------------- I. isolation
  const b = await as(U.OWNERB, (c) => sales(c));
  check(
    "I1 another organization's owner gets nothing of A",
    Array.isArray(b) && b.length === 0,
    String(Array.isArray(b) ? b.length : b),
  );
  check(
    "I2 anon cannot call it",
    /permission denied for function/.test(String(await as(null, (c) => sales(c), "anon"))),
  );
  const [{ prosecdef }] =
    await sql`select prosecdef from pg_proc where proname = 'menu_item_sales' and pronamespace = 'public'::regnamespace`;
  check("I3 it runs as the caller (SECURITY INVOKER: RLS applies)", prosecdef === false);
} catch (e) {
  check("run", false, code(e));
} finally {
  try {
    await sql`delete from public.order_items where org_id = any(${ORGS})`;
    await sql`delete from public.orders where org_id = any(${ORGS})`;
    await sql`delete from public.menu_products where org_id = any(${ORGS})`;
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
console.log(`Menu item sales: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
