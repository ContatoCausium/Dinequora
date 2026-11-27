// Tips by server (0046). LOCAL/CI QA stack ONLY (the target guard refuses any other database).
// Calls as each member, in real PostgreSQL sessions.
//
//   T  counting per server and store: recorded tenders only (a reversed tip is left out), cash tips apart,
//      the server of the table's session, the store's last N local days (a tip 20 days old counts at 30
//      days, not at 14)
//   I  isolation (SECURITY INVOKER, RLS): another organization's owner and anon get nothing of A
//
//   QA_DB_URL=postgresql://...@127.0.0.1:<port>/postgres node scripts/security/tips_by_server_integrity.mjs
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
await assertDisposableDb(DB_URL, "test:tips-by-server").catch(exitOnRefusal);

const KEYS = ["OWNER", "MGR", "OWNERB"];
const U = Object.fromEntries(KEYS.map((k) => [k, crypto.randomUUID()]));
const A = isolatedOrg("tips-a", {
  members: [
    { userId: U.OWNER, role: "owner" },
    { userId: U.MGR, role: "manager", store: true },
  ],
});
const B = isolatedOrg("tips-b", { members: [{ userId: U.OWNERB, role: "owner" }] });
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
const tips = (c, { org = ORG, locs = null, days = 14 } = {}) =>
  c`select location_id::text, server_id::text server, tenders::int tenders, tips_cents::int tips,
           cash_tips_cents::int cash, paid_cents::int paid
      from public.tips_by_server(${org}, ${locs}, ${days})`;
const byServer = (rows) =>
  Array.isArray(rows) ? Object.fromEntries(rows.map((r) => [r.server, r])) : {};

async function session(server, n) {
  const [{ id: T }] = await sql`insert into public.dining_tables (org_id, location_id, label, seats)
                                 values (${ORG}, ${LOC}, ${"TP" + n}, 4) returning id`;
  const [{ id: S }] =
    await sql`insert into public.dining_sessions (org_id, location_id, table_id, guests, server_id, client_key, opened_by)
                                 values (${ORG}, ${LOC}, ${T}, 2, ${server}, ${"tips-s-" + crypto.randomUUID()}, ${server}) returning id`;
  const [{ id: C }] =
    await sql`insert into public.dining_checks (org_id, location_id, session_id, opened_by)
                                 values (${ORG}, ${LOC}, ${S}, ${server}) returning id`;
  return C;
}
async function tender(
  check,
  { method = "card", amount = 1000, tip, status = "recorded", age = "1 hour" },
) {
  const id = crypto.randomUUID();
  const reversed = status === "reversed";
  await sql`insert into public.dining_check_payments
              (id, org_id, location_id, check_id, method, amount_cents, tip_cents, client_key, created_by,
               created_at, status, reversed_by, reversed_at, reversal_reason)
            values (${id}, ${ORG}, ${LOC}, ${check}, ${method}, ${amount}, ${tip}, ${"tips-" + id}, ${U.OWNER},
              now() - ${age}::interval, ${status}, ${reversed ? U.OWNER : null},
              ${reversed ? sql`now()` : null}, ${reversed ? "test reversal" : null})`;
}

try {
  await sql.unsafe(
    createTestUsersSql(
      KEYS.map((k) => ({ userId: U[k], email: `${A.key}-${k.toLowerCase()}@example.test` })),
    ),
  );
  await sql.unsafe(createIsolatedOrgSql(A));
  await sql.unsafe(createIsolatedOrgSql(B));
  await sql`insert into public.org_features (org_id, feature, enabled) values (${ORG}, 'table_service', true)`;
  const cMgr = await session(U.MGR, 1);
  const cOwner = await session(U.OWNER, 2);
  await tender(cMgr, { method: "card", tip: 300 });
  await tender(cMgr, { method: "cash", tip: 200 });
  await tender(cMgr, { method: "card", tip: 999, status: "reversed" });
  await tender(cMgr, { method: "card", tip: 500, age: "20 days" });
  await tender(cOwner, { method: "digital", tip: 100, amount: 500 });

  // ---------------------------------------------------------------- T. counting
  const r14 = byServer(await as(U.OWNER, (c) => tips(c)));
  check(
    "T1 the manager's tables: 2 tenders, tips 300 + 200, 200 in cash (the reversed tip left out)",
    r14[U.MGR]?.tenders === 2 &&
      r14[U.MGR]?.tips === 500 &&
      r14[U.MGR]?.cash === 200 &&
      r14[U.MGR]?.paid === 2000,
    JSON.stringify(r14[U.MGR] ?? null),
  );
  check(
    "T2 the owner's own table is its own row",
    r14[U.OWNER]?.tenders === 1 && r14[U.OWNER]?.tips === 100 && r14[U.OWNER]?.cash === 0,
    JSON.stringify(r14[U.OWNER] ?? null),
  );
  const r30 = byServer(await as(U.OWNER, (c) => tips(c, { days: 30 })));
  check("T3 at 30 days the 20-day-old tip counts (manager 1000)", r30[U.MGR]?.tips === 1000);
  const other = await as(U.OWNER, (c) => tips(c, { locs: [B.locationId] }));
  check(
    "T4 a store of another organization returns nothing",
    Array.isArray(other) && other.length === 0,
  );

  // ---------------------------------------------------------------- I. isolation
  const b = await as(U.OWNERB, (c) => tips(c));
  check(
    "I1 another organization's owner gets nothing of A",
    Array.isArray(b) && b.length === 0,
    String(Array.isArray(b) ? b.length : b),
  );
  check(
    "I2 anon cannot call it",
    /permission denied for function/.test(String(await as(null, (c) => tips(c), "anon"))),
  );
  const [{ prosecdef }] =
    await sql`select prosecdef from pg_proc where proname = 'tips_by_server' and pronamespace = 'public'::regnamespace`;
  check("I3 it runs as the caller (SECURITY INVOKER: RLS applies)", prosecdef === false);
} catch (e) {
  check("run", false, code(e));
} finally {
  try {
    await sql`delete from public.dining_check_payments where org_id = any(${ORGS})`;
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
console.log(`Tips by server: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
