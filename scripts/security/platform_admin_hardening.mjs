// Platform-admin hardening (0043). LOCAL/CI QA stack ONLY (the target guard refuses any other database).
// Direct RPC calls and writes as each account, in real PostgreSQL sessions (two for the race).
//
//   S  separation in any role: a platform role is refused for a manager of a customer organization;
//      a manager membership of a customer organization is refused at commit for an account with a
//      platform role; a demo organization is still allowed; an owner keeps the 0034 code
//   L  platform role changes are serialized: an admin revoking another while that one revokes it back
//      waits, then is refused because it lost its own role; never zero admins
//   A  the audit records only real changes (granting a role already held writes nothing)
//   G  the 7-day grace window starts only when the status changes to grace
//   R  the suspension text changes only when a status is passed
//
//   QA_DB_URL=postgresql://...@127.0.0.1:<port>/postgres node scripts/security/platform_admin_hardening.mjs
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
await assertDisposableDb(DB_URL, "test:platform-admin-hardening").catch(exitOnRefusal);

const KEYS = ["OWNER", "MGR", "X", "Y", "Z", "SUP"];
const U = Object.fromEntries(KEYS.map((k) => [k, crypto.randomUUID()]));
const A = isolatedOrg("pah-a", {
  members: [
    { userId: U.OWNER, role: "owner" },
    { userId: U.MGR, role: "manager", store: true },
  ],
});
const ORGS = [A.orgId];
const email = (k) => `${A.key}-${k.toLowerCase()}@example.test`;

const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const code = (e) => String(e?.message ?? e).split("\n")[0];
async function session(uid) {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {} });
  await c`select set_config('request.jwt.claim.sub', ${uid}, false)`;
  await c`select set_config('request.jwt.claims', ${JSON.stringify({ sub: uid, role: "authenticated" })}, false)`;
  await c.unsafe("set role authenticated");
  return c;
}
async function as(uid, fn) {
  const c = await session(uid);
  try {
    return await fn(c);
  } catch (e) {
    return code(e);
  } finally {
    await c.end({ timeout: 5 });
  }
}
const setRole = (c, who, grant, role = "platform_admin") =>
  c`select public.admin_set_platform_role(${email(who)}, ${role}, ${grant}, 'hardening test')`.then(
    () => "ok",
  );
const audits = async (target, action) =>
  (
    await sql`select count(*)::int n from public.audit_logs where target = ${target} and action = ${action}`
  )[0].n;

let DEMO = null;
try {
  await sql.unsafe(createTestUsersSql(KEYS.map((k) => ({ userId: U[k], email: email(k) }))));
  await sql.unsafe(createIsolatedOrgSql(A));
  await sql`insert into public.user_roles (user_id, role) values
              (${U.X}, 'platform_admin'), (${U.Y}, 'platform_admin'), (${U.Z}, 'platform_admin'),
              (${U.SUP}, 'support')`;

  // ---------------------------------------------------------------- S. separation in any role
  check(
    "S1 a platform role is refused for a manager of a customer organization",
    (await as(U.X, (c) => setRole(c, "MGR", true, "support"))) === "platform_role_member_conflict",
  );
  check(
    "S2 ...and for its owner, with the 0034 code",
    (await as(U.X, (c) => setRole(c, "OWNER", true, "support"))) === "platform_role_owner_conflict",
  );
  let s3;
  try {
    await sql.begin(
      (tx) =>
        tx`insert into public.organization_members (org_id, user_id, role) values (${A.orgId}, ${U.SUP}, 'manager')`,
    );
    s3 = "committed";
  } catch (e) {
    s3 = code(e);
  }
  check(
    "S3 an account with a platform role cannot become a manager of a customer organization (at commit)",
    s3 === "platform_role_member_conflict",
    s3,
  );
  DEMO = crypto.randomUUID();
  await sql`insert into public.organizations (id, slug, name, plan, status, is_demo)
            values (${DEMO}, ${"t_" + A.key + "_demo"}, 'Demo for hardening test', 'growth', 'active', true)`;
  let s4;
  try {
    await sql.begin(
      (tx) =>
        tx`insert into public.organization_members (org_id, user_id, role) values (${DEMO}, ${U.SUP}, 'staff')`,
    );
    s4 = "committed";
  } catch (e) {
    s4 = code(e);
  }
  check("S4 a demo organization still accepts it", s4 === "committed", s4);

  // ---------------------------------------------------------------- A. audit only real changes
  const before = await audits(email("Z"), "platform.role_granted");
  check(
    "A1 granting a role the account already holds succeeds",
    (await as(U.X, (c) => setRole(c, "Z", true))) === "ok",
  );
  check(
    "A1 ...and writes no audit entry",
    (await audits(email("Z"), "platform.role_granted")) === before,
  );

  // ---------------------------------------------------------------- L. serialized role changes
  const cx = await session(U.X);
  const cy = await session(U.Y);
  let second;
  try {
    await cx.begin(async (tx) => {
      await tx`select public.admin_set_platform_role(${email("Y")}, 'platform_admin', false, 'race test')`;
      // Y revokes X while X's revocation of Y is not committed: it must wait for it
      second = setRole(cy, "X", false).catch((e) => code(e));
      await new Promise((r) => setTimeout(r, 400));
    });
    const r = await second;
    check(
      "L1 the second revocation waited and was refused: its caller lost the role",
      r === "forbidden",
      r,
    );
  } finally {
    await cx.end({ timeout: 5 });
    await cy.end({ timeout: 5 });
  }
  const [{ x, y }] = await sql`
    select exists (select 1 from public.user_roles where user_id = ${U.X} and role = 'platform_admin') x,
           exists (select 1 from public.user_roles where user_id = ${U.Y} and role = 'platform_admin') y`;
  check("L2 X is still an admin, Y is not", x === true && y === false);

  // ---------------------------------------------------------------- G. grace window
  const sub = (c, plan, status) =>
    c`select public.admin_set_subscription(${A.orgId}, ${plan}, ${status}, 'hardening test')`.then(
      () => "ok",
    );
  check("G1 status set to grace", (await as(U.X, (c) => sub(c, null, "grace"))) === "ok");
  await sql`update public.subscriptions set grace_ends_at = now() + interval '1 day' where org_id = ${A.orgId}`;
  const graceOf = async () =>
    (await sql`select grace_ends_at from public.subscriptions where org_id = ${A.orgId}`)[0]
      .grace_ends_at;
  const g0 = String(await graceOf());
  await as(U.X, (c) => sub(c, "growth", null));
  check("G2 changing only the plan keeps the grace end", String(await graceOf()) === g0);
  await as(U.X, (c) => sub(c, null, "grace"));
  check("G3 passing grace again (no change) keeps it too", String(await graceOf()) === g0);

  // ---------------------------------------------------------------- R. suspension text
  const upd = (c, status, reason) =>
    c`select public.admin_update_organization(${A.orgId}, ${status}, null, null, ${reason})`.then(
      () => "ok",
    );
  await as(U.X, (c) => upd(c, "suspended", "Unpaid invoice"));
  const reason = async () =>
    (await sql`select suspended_reason r from public.organizations where id = ${A.orgId}`)[0].r;
  check("R1 suspending stores its reason", (await reason()) === "Unpaid invoice");
  await as(
    U.X,
    (c) =>
      c`select public.admin_update_organization(${A.orgId}, null, null, 3, 'internal note about limits')`,
  );
  check("R2 a store-limit change keeps the suspension text", (await reason()) === "Unpaid invoice");
  await as(U.X, (c) => upd(c, "active", "Paid"));
  check("R3 reactivating clears it", (await reason()) === null);
} catch (e) {
  check("run", false, code(e));
} finally {
  try {
    await sql`delete from public.user_roles where user_id = any(${Object.values(U)})`;
    if (DEMO) {
      await sql`delete from public.organization_members where org_id = ${DEMO}`;
      await sql`delete from public.audit_logs where org_id = ${DEMO}`;
      await sql`delete from public.organizations where id = ${DEMO}`;
    }
    await sql`delete from public.audit_logs where target = any(${KEYS.map(email)})`;
    await sql.unsafe(dropIsolatedOrgsSql(ORGS));
    await sql.unsafe(dropTestUsersSql(Object.values(U)));
    const [{ n }] = await sql.unsafe(
      `select * from (${countOrgRowsSql(ORGS).replace(/;\s*$/, "")}) x(n)`,
    );
    check("cleanup: nothing of the isolated organization is left", Number(n) === 0, `${n} rows`);
  } catch (e) {
    check("cleanup", false, code(e));
  }
  await sql.end({ timeout: 5 });
}
const failed = results.filter((r) => !r.ok);
console.log(`Platform admin hardening: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
