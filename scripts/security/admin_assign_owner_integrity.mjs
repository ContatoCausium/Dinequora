// Platform owner assignment (migration 0034). LOCAL/CI QA stack ONLY.
//
// Real PostgreSQL sessions impersonate each caller (request.jwt.claim.sub + role authenticated) and
// call public.admin_assign_owner directly, as a crafted API request would, to prove that:
//   legitimate  a platform admin assigns the first owner of an organization WITHOUT an active owner:
//               a new member, an existing member (promoted; the 0033 trigger clears its profile and
//               grants), an organization whose only owner's account was deleted (soft or hard): the
//               inactive owner row is kept; each assignment audited once with its context;
//   refused     an organization with an active owner (owner_exists), the caller itself
//               (self_assignment_forbidden), an account with a platform role, admin or support
//               (platform_user_forbidden), unknown/unconfirmed/deleted accounts, unknown organization,
//               short verification note, callers without the platform admin role (support, owners,
//               managers, anon), transactions above READ COMMITTED; every refusal changes nothing and
//               never touches an existing owner;
//   concurrent  two platform admins on the same ownerless organization in two sessions, both orders,
//               COMMIT and ROLLBACK: the second waits for the per-organization lock and then is
//               refused (or succeeds after a rollback): never two owners from this flow; an owner
//               invitation accepted at the same time is serialized by the same lock (trigger);
//   separation  a platform role is refused for an owner of a customer organization (any path,
//               direct writes included; test restaurants exempt), so revoke -> assign -> re-grant
//               fails; assignment and grant in two sessions are serialized by the account lock, both
//               orders; an e-mail matching two accounts is refused (user_ambiguous);
//   isolation   the assigned owner gets that organization only: nothing of another tenant through
//               permissions, store access or RLS reads.
// Isolation: own organizations, synthetic users and platform-role rows, all removed at the end.
//
//   QA_DB_URL=postgresql://...@127.0.0.1:<port>/postgres node scripts/security/admin_assign_owner_integrity.mjs
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
await assertDisposableDb(DB_URL, "test:admin-assign-owner").catch(exitOnRefusal);

const KEYS = [
  "PLAT",
  "PLAT2",
  "SUP",
  "OWNERA",
  "MGRA",
  "STAFFB",
  "NEW1",
  "NEW2",
  "NEW3",
  "INVITED",
  "GONE",
  "SOFT",
  "UNCONF",
  "DELTARGET",
  "OWNERE",
  "NEWX",
  "NEWY",
  "DUP1",
  "DUP2",
  "DEMOOWN",
  "SOCK",
];
const U = Object.fromEntries(KEYS.map((k) => [k, crypto.randomUUID()]));
const A = isolatedOrg("own-a", {
  members: [
    { userId: U.OWNERA, role: "owner" },
    { userId: U.MGRA, role: "manager", store: true },
  ],
});
const B = isolatedOrg("own-b", { members: [{ userId: U.STAFFB, role: "staff", store: true }] });
const C = isolatedOrg("own-c"); // concurrency, admin vs admin (COMMIT)
const C2 = isolatedOrg("own-c2"); // concurrency, admin vs admin (ROLLBACK)
const C3 = isolatedOrg("own-c3"); // concurrency, admin vs invitation acceptance
const C4 = isolatedOrg("own-c4"); // concurrency, invitation acceptance first
const D = isolatedOrg("own-d", { members: [{ userId: U.GONE, role: "owner" }] }); // hard-deleted owner
const D2 = isolatedOrg("own-d2", { members: [{ userId: U.SOFT, role: "owner" }] }); // soft-deleted owner
const E = isolatedOrg("own-e", { members: [{ userId: U.OWNERE, role: "owner" }] }); // other tenant
const C5 = isolatedOrg("own-c5"); // revoke -> assign -> re-grant
const C6 = isolatedOrg("own-c6"); // concurrency, assignment vs role grant (assignment first)
const C7 = isolatedOrg("own-c7"); // concurrency, role grant first
const C8 = isolatedOrg("own-c8"); // ambiguous e-mail
const DEMO = isolatedOrg("own-demo", { members: [{ userId: U.DEMOOWN, role: "owner" }] }); // test restaurant
const extraOrgs = []; // created by the code under test (X8)
const ORGS = [A, B, C, C2, C3, C4, D, D2, E, C5, C6, C7, C8, DEMO];
const email = (k) => `${A.key}-${k.toLowerCase()}@example.test`;

const sql = postgres(DB_URL, { max: 1, onnotice: () => {} });
const results = [];
const check = (name, ok, detail = "") => {
  results.push({ ok, name, detail });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const code = (e) => String(e?.message ?? e).split("\n")[0];

async function session(userId, { role = "authenticated", claims = true } = {}) {
  const c = postgres(DB_URL, { max: 1, onnotice: () => {} });
  if (claims) {
    await c`select set_config('request.jwt.claim.sub', ${userId}, false)`;
    await c`select set_config('request.jwt.claims', ${JSON.stringify({ sub: userId, role })}, false)`;
  }
  await c`set lock_timeout = '20s'`;
  await c.unsafe(`set role ${role}`);
  const [{ pid }] = await c`select pg_backend_pid() as pid`;
  return { c, pid, end: () => c.end({ timeout: 5 }) };
}
const assign = (
  s,
  org,
  target,
  note = "ID and business registration checked on call, ticket QA-1",
) => s.c`select public.admin_assign_owner(${org}, ${target}, ${note})`.then(() => "ok");
/** Runs one call as `uid` in its own session; "ok" or the error code. */
async function as(uid, fn, opts) {
  const s = await session(uid, opts);
  try {
    return await fn(s);
  } catch (e) {
    return code(e);
  } finally {
    await s.end();
  }
}
const members = async (org) =>
  JSON.stringify(
    await sql`select user_id::text, role, profile_id::text, extra_permissions from public.organization_members
               where org_id = ${org} order by user_id`,
  );
const audits = async (org) =>
  (
    await sql`select count(*)::int n from public.audit_logs where org_id = ${org} and action = 'platform.owner_assigned'`
  )[0].n;
const owners = async (org) =>
  (
    await sql`select user_id::text u from public.organization_members where org_id = ${org} and role = 'owner' order by 1`
  ).map((r) => r.u);
async function blockedBy(pid, byPid) {
  for (let i = 0; i < 100; i++) {
    const [row] =
      await sql`select wait_event_type as w, ${byPid}::int = any(pg_blocking_pids(${pid})) as by
                  from pg_stat_activity where pid = ${pid}`;
    if (row?.w === "Lock" && row.by) return true;
    await sleep(100);
  }
  return false;
}
/** A refusal must change nothing: same members, no new assignment audit, in every organization. */
async function refused(name, expected, uid, fn, opts) {
  const before = await Promise.all(
    ORGS.map(async (o) => [await members(o.orgId), await audits(o.orgId)]),
  );
  const r = await as(uid, fn, opts);
  const after = await Promise.all(
    ORGS.map(async (o) => [await members(o.orgId), await audits(o.orgId)]),
  );
  const same = JSON.stringify(before) === JSON.stringify(after);
  check(name, r === expected && same, `${r}${same ? "" : " — STATE CHANGED"}`);
}

let failedSetup = false;
try {
  // ---------------------------------------------------------------- fixture
  await sql.unsafe(
    createTestUsersSql(
      KEYS.filter((k) => !["UNCONF", "DUP1", "DUP2"].includes(k)).map((k) => ({
        userId: U[k],
        email: email(k),
      })),
    ),
  );
  await sql.unsafe(
    `insert into auth.users(id, email, email_confirmed_at) values ('${U.UNCONF}', '${email("UNCONF")}', null),
       ('${U.DUP1}', 'Dup-${A.key}@example.test', now()), ('${U.DUP2}', 'dup-${A.key}@example.test', now());`,
  );
  for (const o of ORGS) await sql.unsafe(createIsolatedOrgSql(o));
  const [{ id: CASHIER }] =
    await sql`select id from public.permission_profiles where is_system and key = 'cashier'`;
  await sql.unsafe(`begin;
    insert into public.user_roles(user_id, role) values ('${U.PLAT}', 'platform_admin'), ('${U.PLAT2}', 'platform_admin'), ('${U.SUP}', 'support');
    update public.organization_members set profile_id = '${CASHIER}', extra_permissions = array['inventory.adjust']
     where org_id = '${B.orgId}' and user_id = '${U.STAFFB}';
    update public.organization_members set effective_permissions = public.effective_permissions_for(role, profile_id, extra_permissions, revoked_permissions)
     where org_id = '${B.orgId}';
    update auth.users set deleted_at = now() where id in ('${U.SOFT}', '${U.DELTARGET}');
    update public.organizations set is_demo = true where id = '${DEMO.orgId}';
    commit;`);
  // the hard-deleted owner: the account row is gone, the membership row stays (no foreign key)
  await sql.unsafe(`delete from auth.users where id = '${U.GONE}';`);
  check(
    "fixture: 14 organizations (with/without active owners, a test restaurant), platform roles, users",
    true,
  );

  // ---------------------------------------------------------------- refused (nothing changes)
  await refused("N1 organization with an active owner: owner_exists", "owner_exists", U.PLAT, (s) =>
    assign(s, A.orgId, email("NEW1")),
  );
  check(
    "N1 the existing owner is untouched (still the only owner of A)",
    JSON.stringify(await owners(A.orgId)) === JSON.stringify([U.OWNERA]),
  );
  await refused(
    "N1b an existing manager of the owned organization cannot be promoted this way",
    "owner_exists",
    U.PLAT,
    (s) => assign(s, A.orgId, email("MGRA")),
  );
  await refused(
    "N2 the caller itself: self_assignment_forbidden",
    "self_assignment_forbidden",
    U.PLAT,
    (s) => assign(s, B.orgId, email("PLAT")),
  );
  await refused(
    "N2b the caller's own address in another case and with spaces",
    "self_assignment_forbidden",
    U.PLAT,
    (s) => assign(s, B.orgId, `  ${email("PLAT").toUpperCase()} `),
  );
  await refused(
    "N3 another platform admin as target: platform_user_forbidden",
    "platform_user_forbidden",
    U.PLAT,
    (s) => assign(s, B.orgId, email("PLAT2")),
  );
  await refused(
    "N3b a support account as target: platform_user_forbidden",
    "platform_user_forbidden",
    U.PLAT,
    (s) => assign(s, B.orgId, email("SUP")),
  );
  await refused("N4 a support account as caller: forbidden", "forbidden", U.SUP, (s) =>
    assign(s, B.orgId, email("NEW1")),
  );
  await refused(
    "N4b an owner of another organization as caller: forbidden",
    "forbidden",
    U.OWNERA,
    (s) => assign(s, B.orgId, email("NEW1")),
  );
  await refused(
    "N4c the owner of the organization itself as caller: forbidden",
    "forbidden",
    U.OWNERA,
    (s) => assign(s, A.orgId, email("NEW1")),
  );
  await refused("N4d a manager as caller: forbidden", "forbidden", U.MGRA, (s) =>
    assign(s, A.orgId, email("MGRA")),
  );
  await refused(
    "N4e anon cannot execute the function",
    "permission denied for function admin_assign_owner",
    U.NEW1,
    (s) => assign(s, B.orgId, email("NEW1")),
    { role: "anon", claims: false },
  );
  await refused(
    "N4f signed-in role without a user: forbidden",
    "forbidden",
    U.NEW1,
    (s) => assign(s, B.orgId, email("NEW1")),
    {
      claims: false,
    },
  );
  await refused("N5 unknown account: user_not_found", "user_not_found", U.PLAT, (s) =>
    assign(s, B.orgId, `nobody-${A.key}@example.test`),
  );
  await refused("N5b unconfirmed account: user_not_found", "user_not_found", U.PLAT, (s) =>
    assign(s, B.orgId, email("UNCONF")),
  );
  await refused("N5c deleted (soft) account: user_not_found", "user_not_found", U.PLAT, (s) =>
    assign(s, B.orgId, email("DELTARGET")),
  );
  await refused("N6 unknown organization: not_found", "not_found", U.PLAT, (s) =>
    assign(s, crypto.randomUUID(), email("NEW1")),
  );
  await refused("N6b no organization: not_found", "not_found", U.PLAT, (s) =>
    assign(s, null, email("NEW1")),
  );
  await refused(
    "N7 short verification note: verification_required",
    "verification_required",
    U.PLAT,
    (s) => assign(s, B.orgId, email("NEW1"), "ok ok"),
  );
  for (const level of ["repeatable read", "serializable"])
    await refused(
      `N8 ${level.toUpperCase()}: isolation_unsupported (it would read a snapshot older than the lock)`,
      "isolation_unsupported",
      U.PLAT,
      async (s) => {
        await s.c.unsafe(`begin isolation level ${level}`);
        try {
          return await assign(s, B.orgId, email("NEW1"));
        } finally {
          await s.c`rollback`;
        }
      },
    );

  // ---------------------------------------------------------------- legitimate
  {
    const r = await as(U.PLAT, (s) => assign(s, B.orgId, email("STAFFB")));
    const m = (
      await sql`select role, profile_id, extra_permissions from public.organization_members
                 where org_id = ${B.orgId} and user_id = ${U.STAFFB}`
    )[0];
    check(
      "L1 an existing member of an ownerless organization is promoted to owner",
      r === "ok" && m.role === "owner",
      r,
    );
    check(
      "L1 the 0033 trigger cleared its profile and grants (owners hold everything)",
      m.profile_id === null && m.extra_permissions.length === 0,
    );
    const [a] =
      await sql`select actor_id::text actor, metadata from public.audit_logs where org_id = ${B.orgId} and action = 'platform.owner_assigned'`;
    check(
      "L1 audited once, by the platform admin, with previous role, organization status and inactive owners",
      (await audits(B.orgId)) === 1 &&
        a.actor === U.PLAT &&
        a.metadata.previous_role === "staff" &&
        a.metadata.org_status === "active" &&
        a.metadata.inactive_owner_rows === 0 &&
        typeof a.metadata.verification === "string",
      JSON.stringify(a),
    );
    check(
      "L1 member.extras_pruned audited for the cleared grants",
      (
        await sql`select count(*)::int n from public.audit_logs where org_id = ${B.orgId} and action = 'member.extras_pruned' and target = ${U.STAFFB}`
      )[0].n === 1,
    );
    await refused(
      "L1 a second assignment on the now-owned organization: owner_exists",
      "owner_exists",
      U.PLAT2,
      (s) => assign(s, B.orgId, email("NEW2")),
    );
  }
  {
    const r = await as(U.PLAT, (s) => assign(s, D.orgId, email("NEW3")));
    check(
      "L2 the only owner's account was deleted (row gone): a new owner is assigned",
      r === "ok" && (await owners(D.orgId)).includes(U.NEW3),
      r,
    );
    check(
      "L2 the inactive owner row is kept (never removed or demoted by this flow)",
      (await owners(D.orgId)).includes(U.GONE),
    );
    const [a] =
      await sql`select metadata from public.audit_logs where org_id = ${D.orgId} and action = 'platform.owner_assigned'`;
    check(
      "L2 audited with previous role null and 1 inactive owner row",
      a.metadata.previous_role === null && a.metadata.inactive_owner_rows === 1,
    );
  }
  {
    const r = await as(U.PLAT2, (s) => assign(s, D2.orgId, email("NEW3")));
    check(
      "L3 the only owner's account was soft-deleted: a new owner is assigned, the old row kept",
      r === "ok" &&
        JSON.stringify(await owners(D2.orgId)) === JSON.stringify([U.SOFT, U.NEW3].sort()),
      r,
    );
  }

  // ---------------------------------------------------------------- concurrent (two real sessions)
  for (const [org, end, label] of [
    [C, "commit", "COMMIT"],
    [C2, "rollback", "ROLLBACK"],
  ]) {
    const first = await session(U.PLAT);
    const second = await session(U.PLAT2);
    await first.c`begin`;
    const r1 = await assign(first, org.orgId, email("NEW1")).catch(code);
    await second.c`begin`;
    const attempt = assign(second, org.orgId, email("NEW2")).catch(code);
    check(
      `C1 ${label}: the second admin waits for the organization lock`,
      await blockedBy(second.pid, first.pid),
    );
    await first.c.unsafe(end);
    const r2 = await attempt;
    await second.c`commit`;
    const own = await owners(org.orgId);
    if (end === "commit")
      check(
        `C1 ${label}: first assigned, second refused (owner_exists): exactly one owner`,
        r1 === "ok" &&
          r2 === "owner_exists" &&
          JSON.stringify(own) === JSON.stringify([U.NEW1]) &&
          (await audits(org.orgId)) === 1,
        `${r1}/${r2}/${own.length}`,
      );
    else
      check(
        `C1 ${label}: first rolled back, second assigned: exactly one owner, one audit`,
        r1 === "ok" &&
          r2 === "ok" &&
          JSON.stringify(own) === JSON.stringify([U.NEW2]) &&
          (await audits(org.orgId)) === 1,
        `${r1}/${r2}/${own.length}`,
      );
    await first.end();
    await second.end();
  }
  // the other way to become owner (an owner invitation from the former owner) takes the same lock
  for (const [org, adminFirst] of [
    [C3, true],
    [C4, false],
  ]) {
    const token = crypto.randomBytes(24).toString("hex");
    await sql.unsafe(`insert into public.invitations(org_id, email, role, token_hash, invited_by, location_ids)
      values ('${org.orgId}', '${email("INVITED")}', 'owner', encode(extensions.digest('${token}', 'sha256'), 'hex'), '${U.OWNERE}', '{}');`);
    const admin = await session(U.PLAT);
    const invited = await session(U.INVITED);
    const accept = (s) => s.c`select public.accept_invitation(${token})`.then(() => "ok");
    const [holder, waiter] = adminFirst ? [admin, invited] : [invited, admin];
    await holder.c`begin`;
    const r1 = await (adminFirst ? assign(admin, org.orgId, email("NEW1")) : accept(invited)).catch(
      code,
    );
    await waiter.c`begin`;
    const attempt = (adminFirst ? accept(invited) : assign(admin, org.orgId, email("NEW1"))).catch(
      code,
    );
    const waited = await blockedBy(waiter.pid, holder.pid);
    await holder.c`commit`;
    const r2 = await attempt;
    await waiter.c`commit`;
    const own = await owners(org.orgId);
    if (adminFirst)
      check(
        "C2 admin first, invitation accepted meanwhile: the acceptance waits, then both owners exist (the invited one was invited by the former owner)",
        waited && r1 === "ok" && r2 === "ok" && own.length === 2,
        `${waited}/${r1}/${r2}/${own.length}`,
      );
    else
      check(
        "C2 invitation accepted first: the admin waits, then is refused (owner_exists); only the invited owner",
        waited &&
          r1 === "ok" &&
          r2 === "owner_exists" &&
          JSON.stringify(own) === JSON.stringify([U.INVITED]) &&
          (await audits(org.orgId)) === 0,
        `${waited}/${r1}/${r2}/${own.length}`,
      );
    await admin.end();
    await invited.end();
  }

  // ---------------------------------------------------------------- isolation between organizations
  {
    const s = await session(U.NEW3); // owner of D and D2 now
    const [p] = await s.c`select public.has_permission(${E.orgId}, 'orders.view') as e,
                                 public.has_permission(${D.orgId}, 'orders.view') as d,
                                 public.can_access_location(${E.locationId}) as eloc,
                                 public.can_access_location(${D.locationId}) as dloc`;
    const [r] =
      await s.c`select (select count(*) from public.organizations where id = ${E.orgId})::int as orgs,
                                 (select count(*) from public.locations where org_id = ${E.orgId})::int as locs,
                                 (select count(*) from public.organization_members where org_id = ${E.orgId})::int as mems,
                                 (select count(*) from public.audit_logs where org_id = ${E.orgId})::int as aud,
                                 (select count(*) from public.locations where org_id = ${D.orgId})::int as own_locs`;
    await s.end();
    check(
      "I1 the assigned owner holds its own organization and nothing of another tenant (permissions, stores)",
      p.d === true && p.dloc === true && p.e === false && p.eloc === false,
      JSON.stringify(p),
    );
    check(
      "I1 RLS: another tenant's organization, stores, members and audit read as empty",
      r.orgs === 0 && r.locs === 0 && r.mems === 0 && r.aud === 0 && r.own_locs === 1,
      JSON.stringify(r),
    );
    const mine =
      await sql`select org_id::text o from public.organization_members where user_id = ${U.NEW3} order by 1`;
    check(
      "I2 memberships created only in the organizations it was assigned to",
      JSON.stringify(mine.map((m) => m.o)) === JSON.stringify([D.orgId, D2.orgId].sort()),
    );
    check(
      "I3 the other tenant is untouched (same single owner, no assignment audit)",
      JSON.stringify(await owners(E.orgId)) === JSON.stringify([U.OWNERE]) &&
        (await audits(E.orgId)) === 0,
    );
  }
  // ---------------------------------------------------------------- operators never own customer organizations
  const grantRole = (s, target, role, grant = true) =>
    s.c`select public.admin_set_platform_role(${target}, ${role}::public.platform_role, ${grant}, 'QA separation check')`.then(
      () => "ok",
    );
  const roles = async (uid) =>
    (await sql`select role::text r from public.user_roles where user_id = ${uid} order by 1`).map(
      (r) => r.r,
    );
  {
    const r = await as(U.PLAT, (s) => grantRole(s, email("OWNERA"), "support"));
    check(
      "X1 a platform role for an owner of a customer organization: platform_role_owner_conflict, nothing granted",
      r === "platform_role_owner_conflict" && (await roles(U.OWNERA)).length === 0,
      r,
    );
    const direct = await sql
      .unsafe(
        `insert into public.user_roles(user_id, role) values ('${U.OWNERE}', 'platform_admin')`,
      )
      .then(() => "ok", code);
    check(
      "X2 the same refusal on a direct write by the database owner (trigger: every path)",
      direct === "platform_role_owner_conflict" && (await roles(U.OWNERE)).length === 0,
      direct,
    );
    const demo = await as(U.PLAT, (s) => grantRole(s, email("DEMOOWN"), "support"));
    check(
      "X3 the owner of a test restaurant (demo organization) can hold a platform role",
      demo === "ok" && JSON.stringify(await roles(U.DEMOOWN)) === JSON.stringify(["support"]),
      demo,
    );
  }
  {
    // revoke an admin's role, make it owner of an ownerless organization, grant the role back
    const revoke = await as(U.PLAT, (s) => grantRole(s, email("PLAT2"), "platform_admin", false));
    const owner = await as(U.PLAT, (s) => assign(s, C5.orgId, email("PLAT2")));
    const regrant = await as(U.PLAT, (s) => grantRole(s, email("PLAT2"), "platform_admin"));
    check(
      "X4 revoke -> assign as owner -> grant back: the grant is refused (the account stays an owner without a platform role)",
      revoke === "ok" &&
        owner === "ok" &&
        regrant === "platform_role_owner_conflict" &&
        (await roles(U.PLAT2)).length === 0 &&
        (await owners(C5.orgId)).includes(U.PLAT2),
      `${revoke}/${owner}/${regrant}`,
    );
  }
  for (const [org, target, assignFirst] of [
    [C6, U.NEWX, true],
    [C7, U.NEWY, false],
  ]) {
    const admin = await session(U.PLAT);
    const db = postgres(DB_URL, { max: 1, onnotice: () => {} });
    const [{ pid: dbPid }] = await db`select pg_backend_pid() as pid`;
    const targetEmail = email(target === U.NEWX ? "NEWX" : "NEWY");
    const grantDirect = () =>
      db
        .unsafe(`insert into public.user_roles(user_id, role) values ('${target}', 'support')`)
        .then(() => "ok");
    await (assignFirst ? admin.c`begin` : db`begin`);
    const r1 = await (assignFirst ? assign(admin, org.orgId, targetEmail) : grantDirect()).catch(
      code,
    );
    await (assignFirst ? db`begin` : admin.c`begin`);
    const attempt = (assignFirst ? grantDirect() : assign(admin, org.orgId, targetEmail)).catch(
      code,
    );
    const waited = assignFirst
      ? await blockedBy(dbPid, admin.pid)
      : await blockedBy(admin.pid, dbPid);
    await (assignFirst ? admin.c`commit` : db`commit`);
    const r2 = await attempt;
    await (assignFirst ? db`rollback` : admin.c`rollback`);
    if (assignFirst)
      check(
        "X5 assignment first, platform role granted meanwhile: the grant waits for the account lock, then is refused",
        waited &&
          r1 === "ok" &&
          r2 === "platform_role_owner_conflict" &&
          (await roles(target)).length === 0 &&
          (await owners(org.orgId)).includes(target),
        `${waited}/${r1}/${r2}`,
      );
    else
      check(
        "X5 platform role granted first: the assignment waits for the account lock, then is refused (platform_user_forbidden)",
        waited &&
          r1 === "ok" &&
          r2 === "platform_user_forbidden" &&
          (await owners(org.orgId)).length === 0,
        `${waited}/${r1}/${r2}`,
      );
    await admin.end();
    await db.end({ timeout: 5 });
  }
  await refused(
    "X6 an e-mail matching two accounts: user_ambiguous",
    "user_ambiguous",
    U.PLAT,
    (s) => assign(s, C8.orgId, `dup-${A.key}@example.test`),
  );
  {
    // X7: the chain the second review found: demote the operator, give it a role, promote it again
    const [{ mid: plat2InC5 }] =
      await sql`select id::text mid from public.organization_members where org_id = ${C5.orgId} and user_id = ${U.PLAT2}`;
    await sql.unsafe(
      `insert into public.organization_members(org_id, user_id, role) values ('${C5.orgId}', '${U.SOCK}', 'owner');`,
    );
    const demote = await as(U.SOCK, (s) =>
      s.c`select public.set_member_role(${plat2InC5}, 'manager')`.then(() => "ok"),
    );
    const regrant = await as(U.PLAT, (s) => grantRole(s, email("PLAT2"), "platform_admin"));
    const promote = await as(U.SOCK, (s) =>
      s.c`select public.set_member_role(${plat2InC5}, 'owner')`.then(() => "ok"),
    );
    const transfer = await as(U.SOCK, (s) =>
      s.c`select public.transfer_ownership(${C5.orgId}, ${U.PLAT2})`.then(() => "ok"),
    );
    const [{ role, platform }] = await sql`
      select m.role::text, exists (select 1 from public.user_roles r where r.user_id = m.user_id) platform
        from public.organization_members m where m.id = ${plat2InC5}`;
    // 0043: a manager of a customer organization cannot get a platform role at all, so the chain stops
    // at the grant; the promotion that follows is an ordinary member becoming owner, with no role.
    check(
      "X7 demote -> grant the role (refused since 0043: member of a customer organization) -> promote: never an owner with a platform role",
      demote === "ok" &&
        regrant === "platform_role_member_conflict" &&
        promote === "ok" &&
        platform === false,
      `${demote}/${regrant}/${promote}/${transfer}/${role}/platform=${platform}`,
    );
  }
  {
    // X8: a platform admin creating a customer organization (it would own it) vs a test restaurant
    const before = (
      await sql`select count(*)::int n from public.organizations where created_by = ${U.PLAT}`
    )[0].n;
    const real = await as(U.PLAT, (s) =>
      s.c`select public.create_organization('Operator restaurant', null, 'Main')`.then(() => "ok"),
    );
    const test = await as(U.PLAT, (s) =>
      s.c`select public.create_test_restaurant('Operator test', 'Demo Co', '1 Demo Street', 'Demo store') as id`.then(
        (r) => {
          extraOrgs.push(r[0].id);
          return "ok";
        },
      ),
    );
    const after = await sql`select is_demo from public.organizations where created_by = ${U.PLAT}`;
    check(
      "X8 a platform admin cannot create (and own) a customer organization; a test restaurant is allowed",
      before === 0 &&
        real === "platform_role_owner_conflict" &&
        test === "ok" &&
        after.length === 1 &&
        after[0].is_demo === true,
      `${real}/${test}/${JSON.stringify(after)}`,
    );
  }
  {
    // X9: an owner invitation accepted by an account with a platform role
    const token = crypto.randomBytes(24).toString("hex");
    await sql.unsafe(`insert into public.invitations(org_id, email, role, token_hash, invited_by, location_ids)
      values ('${E.orgId}', '${email("PLAT")}', 'owner', encode(extensions.digest('${token}', 'sha256'), 'hex'), '${U.OWNERE}', '{}');`);
    const r = await as(U.PLAT, (s) =>
      s.c`select public.accept_invitation(${token})`.then(() => "ok"),
    );
    const [{ n }] =
      await sql`select count(*)::int n from public.organization_members where org_id = ${E.orgId} and user_id = ${U.PLAT}`;
    check(
      "X9 an owner invitation accepted by a platform admin: refused, no membership",
      r === "platform_role_owner_conflict" && n === 0,
      r,
    );
  }
  {
    // X10: the role-side check refuses isolation levels above READ COMMITTED (it would miss a concurrent owner)
    const db = postgres(DB_URL, { max: 1, onnotice: () => {} });
    const r = await db
      .begin("isolation level repeatable read", (tx) =>
        tx.unsafe(`insert into public.user_roles(user_id, role) values ('${U.MGRA}', 'support')`),
      )
      .then(() => "ok", code);
    await db.end({ timeout: 5 });
    check(
      "X10 a platform role written in REPEATABLE READ: isolation_unsupported, nothing granted",
      r === "isolation_unsupported" && (await roles(U.MGRA)).length === 0,
      r,
    );
  }
  {
    // X11: an overlap that predates 0034 (here: a test restaurant reclassified directly); changing that
    // role row, or re-granting it, is refused
    await sql`update public.organizations set is_demo = false where id = ${DEMO.orgId}`;
    const upd =
      await sql`update public.user_roles set role = 'platform_admin' where user_id = ${U.DEMOOWN}`.then(
        () => "ok",
        code,
      );
    const again = await as(U.PLAT, (s) => grantRole(s, email("DEMOOWN"), "support"));
    check(
      "X11 an existing overlap: promoting its role row or re-granting it is refused (UPDATE OF role covered)",
      upd === "platform_role_owner_conflict" &&
        again === "platform_role_owner_conflict" &&
        JSON.stringify(await roles(U.DEMOOWN)) === JSON.stringify(["support"]),
      `${upd}/${again}`,
    );
  }
  {
    const r = await as(U.PLAT, (s) => grantRole(s, `dup-${A.key}@example.test`, "support"));
    check(
      "X12 admin_set_platform_role with an e-mail matching two accounts: user_ambiguous, nothing granted",
      r === "user_ambiguous" &&
        (await roles(U.DUP1)).length === 0 &&
        (await roles(U.DUP2)).length === 0,
      r,
    );
  }
  {
    const [f] =
      await sql`select prosecdef, proconfig, has_function_privilege('anon', p.oid, 'execute') as anon,
                                 has_function_privilege('authenticated', p.oid, 'execute') as auth
                            from pg_proc p where p.oid = 'public.admin_assign_owner(uuid,text,text)'::regprocedure`;
    const [t] =
      await sql`select has_function_privilege('authenticated', 'public.trg_member_owner_serialize()', 'execute')
                         or has_function_privilege('authenticated', 'public.trg_platform_role_separation()', 'execute') as auth,
                       (select count(*)::int from pg_trigger
                         where tgname in ('member_owner_serialize', 'platform_role_separation')) as triggers`;
    check(
      "P1 privileges: SECURITY DEFINER with fixed search_path, authenticated only; the two trigger functions are not callable",
      f.prosecdef &&
        String(f.proconfig).includes("search_path=public") &&
        !f.anon &&
        f.auth &&
        !t.auth &&
        t.triggers === 2,
      JSON.stringify({ f, t }),
    );
  }
} catch (e) {
  failedSetup = true;
  check("script error", false, code(e));
} finally {
  try {
    await sql.unsafe(dropIsolatedOrgsSql([...ORGS.map((o) => o.orgId), ...extraOrgs]));
    await sql.unsafe(
      `delete from public.user_roles where user_id = any(array[${Object.values(U)
        .map((u) => `'${u}'::uuid`)
        .join(",")}]);`,
    );
    await sql.unsafe(dropTestUsersSql(Object.values(U)));
    const [{ n }] = await sql.unsafe(
      `select * from (${countOrgRowsSql([...ORGS.map((o) => o.orgId), ...extraOrgs]).replace(/;\s*$/, "")}) x(n)`,
    );
    check("cleanup: nothing of the test organizations is left", Number(n) === 0, String(n));
  } catch (e) {
    check("cleanup", false, code(e));
  }
  await sql.end({ timeout: 5 });
}
const failed = results.filter((r) => !r.ok).length;
console.log(
  `${results.length - failed}/${results.length} checks passed${failedSetup ? " (aborted)" : ""}`,
);
process.exit(failed ? 1 : 0);
