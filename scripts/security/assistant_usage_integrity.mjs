// Management assistant usage ledger (0040). LOCAL/CI QA stack ONLY (the target guard refuses any other
// database). Direct RPC calls and reads as each member, in real PostgreSQL sessions.
//
//   F  the ai_assistant feature: off by default (nobody records or reads the month's tokens, owners
//      included; assistant.use hidden); on for one organization only
//   P  who: owner and manager (default); staff only by grant; another organization; anon; a store of
//      another organization; invalid values refused; no direct writes
//   R  reads: the owner sees the organization's usage, a manager only their own rows; the month total
//      sums the organization's rows only; the audit records the size, never the question
//
//   QA_DB_URL=postgresql://...@127.0.0.1:<port>/postgres node scripts/security/assistant_usage_integrity.mjs
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
await assertDisposableDb(DB_URL, "test:assistant-usage").catch(exitOnRefusal);

const KEYS = ["OWNER", "MGR", "STAFF", "STAFFG", "OWNERB"];
const U = Object.fromEntries(KEYS.map((k) => [k, crypto.randomUUID()]));
const A = isolatedOrg("ai-a", {
  members: [
    { userId: U.OWNER, role: "owner" },
    { userId: U.MGR, role: "manager", store: true },
    { userId: U.STAFF, role: "staff", store: true },
    { userId: U.STAFFG, role: "staff", store: true },
  ],
});
const B = isolatedOrg("ai-b", { members: [{ userId: U.OWNERB, role: "owner" }] });
const ORG = A.orgId;
const ORGS = [A.orgId, B.orgId];
const mid = (uid) => A.members.find((m) => m.userId === uid).memberId;

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
const record = (
  c,
  { org = ORG, store = null, tokens = [100, 20], chars = 42, model = "claude-opus-5-5" } = {},
) =>
  c`select public.record_assistant_usage(${org}, ${model}, ${tokens[0]}, ${tokens[1]}, ${chars}, ${store})`.then(
    () => "ok",
  );
const month = (c, org = ORG) =>
  c`select public.assistant_month_tokens(${org}) as n`.then((r) => Number(r[0].n));
const rows = async () =>
  (await sql`select count(*)::int n from public.assistant_usage where org_id = any(${ORGS})`)[0].n;
async function refused(name, expected, uid, fn, role) {
  const before = await rows();
  const r = await as(uid, fn, role);
  const same = (await rows()) === before;
  const ok = (expected instanceof RegExp ? expected.test(String(r)) : r === expected) && same;
  check(name, ok, `${r}${same ? "" : " — ROWS CHANGED"}`);
}

try {
  await sql.unsafe(
    createTestUsersSql(
      KEYS.map((k) => ({ userId: U[k], email: `${A.key}-${k.toLowerCase()}@example.test` })),
    ),
  );
  await sql.unsafe(createIsolatedOrgSql(A));
  await sql.unsafe(createIsolatedOrgSql(B));
  await sql`update public.organization_members set extra_permissions = array['assistant.use'] where id = ${mid(U.STAFFG)}`;
  await sql`update public.organization_members
               set effective_permissions = public.effective_permissions_for(role, profile_id, extra_permissions, revoked_permissions)
             where org_id = ${ORG}`;

  // ---------------------------------------------------------------- F. feature
  const [{ def }] =
    await sql`select default_enabled as def from public.feature_catalog where key = 'ai_assistant'`;
  check("F1 ai_assistant exists and is off by default", def === false);
  await refused(
    "F2 feature off: the owner cannot record usage",
    "permission_denied",
    U.OWNER,
    (c) => record(c),
  );
  check(
    "F2 feature off: the month total is refused too",
    (await as(U.OWNER, (c) => month(c))) === "permission_denied",
  );
  const perms = await as(
    U.OWNER,
    async (c) => (await c`select public.my_permissions(${ORG}) as p`)[0].p,
  );
  check("F3 feature off: assistant.use is not shown", !perms.includes("assistant.use"));
  await sql`insert into public.org_features (org_id, feature, enabled) values (${ORG}, 'ai_assistant', true)`;
  const perms2 = await as(
    U.OWNER,
    async (c) => (await c`select public.my_permissions(${ORG}) as p`)[0].p,
  );
  check("F4 feature on for A: the owner holds assistant.use", perms2.includes("assistant.use"));

  // ---------------------------------------------------------------- P. who
  check(
    "P1 the owner records a question (all stores)",
    (await as(U.OWNER, (c) => record(c))) === "ok",
  );
  check(
    "P2 the manager records one at the store (default permission)",
    (await as(U.MGR, (c) => record(c, { store: A.locationId, tokens: [300, 50] }))) === "ok",
  );
  await refused("P3 staff without a grant is refused", "permission_denied", U.STAFF, (c) =>
    record(c),
  );
  check(
    "P4 staff granted assistant.use records one",
    (await as(U.STAFFG, (c) => record(c, { tokens: [10, 5] }))) === "ok",
  );
  await refused("P5 another organization's owner is refused", "forbidden", U.OWNERB, (c) =>
    record(c),
  );
  await refused("P5 ...and cannot read A's month total", /forbidden/, U.OWNERB, (c) => month(c));
  await refused(
    "P6 a store of another organization is refused",
    "location_forbidden",
    U.OWNER,
    (c) => record(c, { store: B.locationId }),
  );
  await refused(
    "P6 feature off for B: B's owner cannot record in B",
    "permission_denied",
    U.OWNERB,
    (c) => record(c, { org: B.orgId }),
  );
  await refused("P7 negative tokens are refused", "invalid_usage", U.OWNER, (c) =>
    record(c, { tokens: [-1, 0] }),
  );
  await refused("P7 an empty question is refused", "invalid_usage", U.OWNER, (c) =>
    record(c, { chars: 0 }),
  );
  await refused(
    "P8 anon cannot call it",
    /permission denied for function/,
    null,
    (c) => record(c),
    "anon",
  );
  await refused(
    "P9 no direct insert, even for the owner",
    /permission denied/,
    U.OWNER,
    (c) =>
      c`insert into public.assistant_usage (org_id, user_id, model, input_tokens, output_tokens, question_chars)
      values (${ORG}, ${U.OWNER}, 'x', 1, 1, 1)`,
  );

  // ---------------------------------------------------------------- R. reads
  check(
    "R1 the month total sums the organization's rows (120 + 350 + 15)",
    (await as(U.OWNER, (c) => month(c))) === 485,
  );
  const ownerRows = await as(
    U.OWNER,
    (c) => c`select user_id::text from public.assistant_usage where org_id = ${ORG}`,
  );
  check("R2 the owner reads every row of the organization", ownerRows.length === 3);
  const mgrRows = await as(
    U.MGR,
    (c) => c`select user_id::text u from public.assistant_usage where org_id = ${ORG}`,
  );
  check("R3 a manager reads only their own row", mgrRows.length === 1 && mgrRows[0].u === U.MGR);
  const audit =
    await sql`select metadata from public.audit_logs where org_id = ${ORG} and action = 'assistant.asked'`;
  check(
    "R4 audited with the size only, never the question",
    audit.length === 3 &&
      audit.every((a) => Object.keys(a.metadata).sort().join() === "question_chars,tokens"),
  );
} catch (e) {
  check("run", false, code(e));
} finally {
  try {
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
console.log(`Assistant usage: ${results.length - failed.length}/${results.length} passed`);
if (failed.length) process.exit(1);
