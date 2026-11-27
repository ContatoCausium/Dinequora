// Check payment reversal reasons (0041). LOCAL/CI QA stack ONLY (the target guard refuses any other
// database). Reads and RPC calls as each member, in real PostgreSQL sessions.
//
//   C  columns: no member reads dining_check_payments.reversal_reason through the API (staff with a
//      tables permission, managers, owners); every other column still reads; SELECT * is refused
//   R  list_check_reversal_reasons(): who holds orders.refund at the store (owner, manager) gets the
//      reasons of that check's reversed tenders only; staff, another organization, a store of another
//      organization and anon are refused
//
//   QA_DB_URL=postgresql://...@127.0.0.1:<port>/postgres node scripts/security/check_reversal_reason_privacy.mjs
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
await assertDisposableDb(DB_URL, "test:reversal-reasons").catch(exitOnRefusal);

const KEYS = ["OWNER", "MGR", "STAFF", "OWNERB"];
const U = Object.fromEntries(KEYS.map((k) => [k, crypto.randomUUID()]));
const A = isolatedOrg("rr-a", {
  members: [
    { userId: U.OWNER, role: "owner" },
    { userId: U.MGR, role: "manager", store: true },
    { userId: U.STAFF, role: "staff", store: true },
  ],
});
const B = isolatedOrg("rr-b", { members: [{ userId: U.OWNERB, role: "owner" }] });
const ORG = A.orgId;
const LOC = A.locationId;
const ORGS = [A.orgId, B.orgId];
const mid = (uid) => A.members.find((m) => m.userId === uid).memberId;
const REASON = "Customer charged twice — card 1234";

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
const reasons = (c, { org = ORG, loc = LOC, checkId } = {}) =>
  c`select payment_id::text, reason from public.list_check_reversal_reasons(${org}, ${loc}, ${checkId})`;

const C1 = crypto.randomUUID();
const C2 = crypto.randomUUID();
const P_REV = crypto.randomUUID();
const P_OK = crypto.randomUUID();
const P_OTHER = crypto.randomUUID();

try {
  await sql.unsafe(
    createTestUsersSql(
      KEYS.map((k) => ({ userId: U[k], email: `${A.key}-${k.toLowerCase()}@example.test` })),
    ),
  );
  await sql.unsafe(createIsolatedOrgSql(A));
  await sql.unsafe(createIsolatedOrgSql(B));
  await sql`insert into public.org_features (org_id, feature, enabled) values (${ORG}, 'table_service', true)`;
  await sql`update public.organization_members set extra_permissions = array['tables.view','tables.serve'] where id = ${mid(U.STAFF)}`;
  await sql`update public.organization_members
               set effective_permissions = public.effective_permissions_for(role, profile_id, extra_permissions, revoked_permissions)
             where org_id = ${ORG}`;
  // one table, one session, two checks: C1 with a reversed and a recorded tender, C2 with a reversed one
  const [{ id: T }] = await sql`insert into public.dining_tables (org_id, location_id, label, seats)
                                 values (${ORG}, ${LOC}, 'RR1', 4) returning id`;
  const [{ id: S }] =
    await sql`insert into public.dining_sessions (org_id, location_id, table_id, guests, server_id, client_key, opened_by)
                                 values (${ORG}, ${LOC}, ${T}, 2, ${U.MGR}, ${"rr-s-" + C1}, ${U.MGR}) returning id`;
  await sql`insert into public.dining_checks (id, org_id, location_id, session_id, number, opened_by)
            values (${C1}, ${ORG}, ${LOC}, ${S}, 1, ${U.MGR}), (${C2}, ${ORG}, ${LOC}, ${S}, 2, ${U.MGR})`;
  await sql`insert into public.dining_check_payments
              (id, org_id, location_id, check_id, method, amount_cents, client_key, created_by,
               status, reversed_by, reversed_at, reversal_reason)
            values
              (${P_REV}, ${ORG}, ${LOC}, ${C1}, 'card', 500, ${"rr-1-" + P_REV}, ${U.MGR}, 'reversed', ${U.MGR}, now(), ${REASON}),
              (${P_OK}, ${ORG}, ${LOC}, ${C1}, 'cash', 700, ${"rr-2-" + P_OK}, ${U.MGR}, 'recorded', null, null, null),
              (${P_OTHER}, ${ORG}, ${LOC}, ${C2}, 'card', 300, ${"rr-3-" + P_OTHER}, ${U.MGR}, 'reversed', ${U.MGR}, now(), 'Other check reason')`;

  // ---------------------------------------------------------------- C. columns
  for (const [who, uid] of [
    ["staff with tables.view", U.STAFF],
    ["the manager", U.MGR],
    ["the owner", U.OWNER],
  ]) {
    const r = await as(
      uid,
      (c) => c`select reversal_reason from public.dining_check_payments where check_id = ${C1}`,
    );
    check(`C1 ${who} cannot read reversal_reason`, /permission denied/.test(String(r)), String(r));
  }
  const cols = await as(
    U.STAFF,
    (c) =>
      c`select id, status, amount_cents, reversed_at, reversed_by from public.dining_check_payments where check_id = ${C1} order by amount_cents`,
  );
  check(
    "C2 staff still reads the other columns of the store's tenders",
    Array.isArray(cols) && cols.length === 2 && cols[0].status === "reversed",
    Array.isArray(cols) ? `${cols.length} rows` : String(cols),
  );
  const star = await as(U.OWNER, (c) => c`select * from public.dining_check_payments`);
  check(
    "C3 select * is refused (the column is not granted)",
    /permission denied/.test(String(star)),
  );

  // ---------------------------------------------------------------- R. the reasons function
  const mgr = await as(U.MGR, (c) => reasons(c, { checkId: C1 }));
  check(
    "R1 the manager (orders.refund at the store) reads the check's reversal reason",
    Array.isArray(mgr) &&
      mgr.length === 1 &&
      mgr[0].payment_id === P_REV &&
      mgr[0].reason === REASON,
    Array.isArray(mgr) ? JSON.stringify(mgr.map((x) => x.payment_id)) : String(mgr),
  );
  const own = await as(U.OWNER, (c) => reasons(c, { checkId: C1 }));
  check(
    "R2 the owner reads it; only reversed tenders of that check (not C2's)",
    Array.isArray(own) && own.length === 1 && own[0].payment_id === P_REV,
  );
  check(
    "R3 staff without orders.refund is refused",
    (await as(U.STAFF, (c) => reasons(c, { checkId: C1 }))) === "permission_denied",
  );
  check(
    "R4 another organization's owner is refused",
    (await as(U.OWNERB, (c) => reasons(c, { checkId: C1 }))) === "forbidden",
  );
  const r5 = await as(U.OWNER, (c) => reasons(c, { loc: B.locationId, checkId: C1 }));
  check("R5 a store of another organization is refused", r5 === "forbidden", String(r5));
  const bOwn = await as(U.OWNERB, (c) =>
    reasons(c, { org: B.orgId, loc: B.locationId, checkId: C1 }),
  );
  check(
    "R6 B's owner asking in B for A's check gets nothing",
    Array.isArray(bOwn) ? bOwn.length === 0 : /permission_denied/.test(String(bOwn)),
    Array.isArray(bOwn) ? `${bOwn.length} rows` : String(bOwn),
  );
  check(
    "R7 anon cannot call it",
    /permission denied for function/.test(
      String(await as(null, (c) => reasons(c, { checkId: C1 }), "anon")),
    ),
  );
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
console.log(`Reversal reasons: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
